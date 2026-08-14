/**
 * GrantRegistry — 资源授权注册表
 *
 * 管理主 Agent 对应用/会话的资源访问授权。
 * 授权的是"资源引用"，不是"编译后的上下文"。
 * 被授权方在编译时实时读取最新资源内容。
 *
 * 设计原则：
 * - 轻量：授权声明是三元组，不存储资源内容
 * - 活资源：底层资源变化，被授权方下次读取自动拿到最新
 * - 可撤销：支持随时撤销授权（cut 语义）
 * - 可过期：支持 TTL，超时自动失效
 *
 * 与 CapabilityGate 的区别：
 * - CapabilityGate 管"Agent 在某 channel 下能用哪些工具"（静态配置）
 * - GrantRegistry 管"主 Agent 授权应用访问哪些具体资源"（动态授权）
 *
 * @module packages/backend/src/applications/grantRegistry
 */

import { randomUUID } from 'node:crypto'
import { eq, and, isNull, or, lte, ne } from 'drizzle-orm'
import { appResourceGrants } from '../database/schema'
import type { DrizzleDb } from '../database'
import { createLogger } from '../lib/logger'
import type { Grant, GrantPermission, ResourceRef } from './types'

const logger = createLogger('GrantRegistry')

// ─────────────────────────────────────────────
// GrantRegistry 接口
// ─────────────────────────────────────────────

/**
 * GrantRegistry — 授权注册表接口
 *
 * 纯授权声明管理，不涉及资源内容读取。
 * 资源内容由各资源服务（MemoryProvider/ThreadService/WorkspaceService）提供。
 */
export interface GrantRegistry {
  /**
   * 创建授权
   *
   * @returns Grant ID
   */
  grant(params: {
    ownerAgentId: string
    holderId: string
    holderType: 'app' | 'app_session'
    resource: ResourceRef
    permissions: GrantPermission[]
    expiresAt?: string
    grantedBy?: 'host_agent' | 'user' | 'auto'
    note?: string
  }): Promise<string>

  /**
   * 撤销授权
   *
   * 对应"剪切"语义：撤销后，被授权方不再加载此资源。
   * 已被 LLM 读过的信息无法"遗忘"，但后续编译不再包含。
   *
   * @returns 是否撤销成功（false=授权不存在或已撤销）
   */
  revoke(grantId: string): Promise<boolean>

  /**
   * 撤销某 holder 的所有授权
   *
   * 应用卸载或会话结束时调用。
   *
   * @returns 撤销的授权数量
   */
  revokeByHolder(holderId: string): Promise<number>

  /**
   * 查询某 holder 的所有有效授权
   *
   * 应用编译时调用：获取该 holder 被授权的所有资源引用，
   * 然后从各资源服务读取实际内容。
   *
   * 编译时统一查询所有 grant，批量高效。
   */
  queryGrants(params: {
    holderId: string
    /** 资源类型过滤（可选） */
    resourceKind?: ResourceRef['kind']
    /** 仅返回未过期且未撤销的（默认 true） */
    activeOnly?: boolean
  }): Promise<Grant[]>

  /**
   * 检查某 holder 是否有特定资源的特定权限
   *
   * 运行时权限校验用。
   */
  checkPermission(params: {
    holderId: string
    resourceKind: ResourceRef['kind']
    permission: GrantPermission
  }): Promise<boolean>

  /**
   * 清理过期授权
   *
   * 定时任务调用。
   *
   * @returns 清理的授权数量
   */
  cleanupExpired(): Promise<number>
}

// ─────────────────────────────────────────────
// SQLite 实现
// ─────────────────────────────────────────────

/**
 * SqliteGrantRegistry — GrantRegistry 的 SQLite 实现
 *
 * 使用 Drizzle ORM 操作 app_resource_grants 表。
 */
export class SqliteGrantRegistry implements GrantRegistry {
  constructor(private db: DrizzleDb) {}

  async grant(params: {
    ownerAgentId: string
    holderId: string
    holderType: 'app' | 'app_session'
    resource: ResourceRef
    permissions: GrantPermission[]
    expiresAt?: string
    grantedBy?: 'host_agent' | 'user' | 'auto'
    note?: string
  }): Promise<string> {
    const grantId = randomUUID()
    const now = new Date().toISOString()

    await this.db.insert(appResourceGrants).values({
      id: grantId,
      ownerAgentId: params.ownerAgentId,
      holderId: params.holderId,
      holderType: params.holderType,
      resourceKind: params.resource.kind,
      resourceJson: JSON.stringify(params.resource),
      permissions: params.permissions.join(','),
      grantedBy: params.grantedBy ?? 'host_agent',
      note: params.note ?? null,
      createdAt: now,
      expiresAt: params.expiresAt ?? null,
      revoked: 0,
      revokedAt: null,
    })

    logger.debug(
      `授权已创建: holder=${params.holderId}, kind=${params.resource.kind}, perms=${params.permissions.join(',')}`,
    )
    return grantId
  }

  async revoke(grantId: string): Promise<boolean> {
    const now = new Date().toISOString()
    const result = await this.db
      .update(appResourceGrants)
      .set({ revoked: 1, revokedAt: now })
      .where(and(eq(appResourceGrants.id, grantId), eq(appResourceGrants.revoked, 0)))
      .returning({ id: appResourceGrants.id })

    if (result.length > 0) {
      logger.debug(`授权已撤销: grantId=${grantId}`)
      return true
    }
    return false
  }

  async revokeByHolder(holderId: string): Promise<number> {
    const now = new Date().toISOString()
    const result = await this.db
      .update(appResourceGrants)
      .set({ revoked: 1, revokedAt: now })
      .where(and(eq(appResourceGrants.holderId, holderId), eq(appResourceGrants.revoked, 0)))
      .returning({ id: appResourceGrants.id })

    const count = result.length
    if (count > 0) {
      logger.info(`批量撤销授权: holder=${holderId}, count=${count}`)
    }
    return count
  }

  async queryGrants(params: {
    holderId: string
    resourceKind?: ResourceRef['kind']
    activeOnly?: boolean
  }): Promise<Grant[]> {
    const activeOnly = params.activeOnly ?? true
    const now = new Date().toISOString()

    // 构建查询条件
    const conditions = [eq(appResourceGrants.holderId, params.holderId)]

    if (activeOnly) {
      // 未撤销
      conditions.push(eq(appResourceGrants.revoked, 0))
      // 未过期（expiresAt 为 NULL 或大于当前时间）
      conditions.push(
        or(isNull(appResourceGrants.expiresAt), lte(appResourceGrants.expiresAt, now))!,
      )
      // 注意：上面的 lte 写反了，应该是 expiresAt > now 才有效
      // 但 Drizzle 的 or + isNull + gt 组合更清晰，下面用 gt 重写
    }

    if (params.resourceKind) {
      conditions.push(eq(appResourceGrants.resourceKind, params.resourceKind))
    }

    // 重新构建 activeOnly 条件（修复过期判断逻辑）
    const finalConditions = [eq(appResourceGrants.holderId, params.holderId)]
    if (activeOnly) {
      finalConditions.push(eq(appResourceGrants.revoked, 0))
      // 过期条件：expiresAt IS NULL OR expiresAt > now
      // 用 SQL 原生表达式更清晰
    }
    if (params.resourceKind) {
      finalConditions.push(eq(appResourceGrants.resourceKind, params.resourceKind))
    }

    // 查询所有匹配的授权（含可能过期的）
    const rows = await this.db
      .select()
      .from(appResourceGrants)
      .where(and(...finalConditions))

    // 在应用层过滤过期授权（避免 Drizzle 的 or+gt 组合复杂度）
    const filtered = activeOnly ? rows.filter((r) => !r.expiresAt || r.expiresAt > now) : rows

    return filtered.map(rowToGrant)
  }

  async checkPermission(params: {
    holderId: string
    resourceKind: ResourceRef['kind']
    permission: GrantPermission
  }): Promise<boolean> {
    const grants = await this.queryGrants({
      holderId: params.holderId,
      resourceKind: params.resourceKind,
      activeOnly: true,
    })
    return grants.some((g) => g.permissions.includes(params.permission))
  }

  async cleanupExpired(): Promise<number> {
    const now = new Date().toISOString()
    // 查找已过期但未撤销的授权
    const expired = await this.db
      .select({ id: appResourceGrants.id })
      .from(appResourceGrants)
      .where(
        and(
          eq(appResourceGrants.revoked, 0),
          ne(appResourceGrants.expiresAt, ''),
          lte(appResourceGrants.expiresAt, now),
        ),
      )

    if (expired.length === 0) return 0

    // 批量撤销（标记 revoked=1，保留记录便于审计）
    const ids = expired.map((e) => e.id)
    for (const id of ids) {
      await this.db
        .update(appResourceGrants)
        .set({ revoked: 1, revokedAt: now })
        .where(eq(appResourceGrants.id, id))
    }

    logger.info(`清理过期授权: count=${ids.length}`)
    return ids.length
  }
}

// ─────────────────────────────────────────────
// 行 ↔ 领域对象 转换
// ─────────────────────────────────────────────

/** Drizzle 推导的行类型 */
type GrantRow = typeof appResourceGrants.$inferSelect

/** 将 DB 行反序列化为 Grant 领域对象 */
function rowToGrant(row: GrantRow): Grant {
  // 解析资源引用 JSON
  let resource: ResourceRef
  try {
    resource = JSON.parse(row.resourceJson) as ResourceRef
  } catch {
    // JSON 解析失败时构造一个空的 memory 引用作为兜底
    logger.warn(`资源引用 JSON 解析失败: grantId=${row.id}`)
    resource = { kind: 'memory', agentId: '' }
  }

  // 解析权限列表
  const permissions = row.permissions.split(',').filter(Boolean) as GrantPermission[]

  return {
    id: row.id,
    ownerAgentId: row.ownerAgentId,
    holderId: row.holderId,
    holderType: row.holderType as 'app' | 'app_session',
    resource,
    permissions,
    createdAt: row.createdAt ?? new Date().toISOString(),
    expiresAt: row.expiresAt ?? undefined,
    revoked: row.revoked === 1,
    revokedAt: row.revokedAt ?? undefined,
    grantedBy: (row.grantedBy ?? 'host_agent') as 'host_agent' | 'user' | 'auto',
    note: row.note ?? undefined,
  }
}
