/**
 * InboundRoute Repository — 入站路由表数据访问层
 *
 * inbound_routes 表存储"外部消息来源 → Agent/Channel"的路由规则。
 * 第七阶段：替代旧的全局活跃 Agent 对外部消息的决定作用。
 *
 * 核心查询：当外部消息（QQ/Discord/Webhook 等）进来时，
 * 根据 (source, identifier) 查询此表决定归属 Agent 和 Thread 通道。
 * 未命中路由时，调用方回退到 defaultAgentId。
 *
 * 设计见 .aios/10-node-architecture.md §7
 *
 * @module packages/backend/src/repositories/inboundRoute.repo
 */

import { eq, and } from 'drizzle-orm'
import { inboundRoutes } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 消息来源类型 */
export type InboundSource = 'qq_private' | 'qq_group' | 'discord' | 'webhook' | 'monitor'

/** Thread 通道类型（决定 ContextCompiler 行为） */
export type InboundChannel = 'desktop' | 'social' | 'group' | 'companion'

/** 入站路由领域对象 */
export interface InboundRoute {
  /** 主键（UUID） */
  id: string
  /** 消息来源 */
  source: InboundSource
  /** 来源标识（QQ号、群号、webhook path 等） */
  identifier: string
  /** 归属 Agent ID */
  agentId: string
  /** 创建什么类型的 Thread */
  channel: InboundChannel
  /** 固定到特定 Thread（可选） */
  threadId: string | null
  /** 额外配置（已解析的对象） */
  config: Record<string, unknown>
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 创建入站路由的输入 */
export interface CreateInboundRouteInput {
  source: InboundSource
  identifier: string
  agentId: string
  channel?: InboundChannel
  threadId?: string | null
  config?: Record<string, unknown>
}

/** 更新入站路由的输入（所有字段可选） */
export interface UpdateInboundRouteInput {
  agentId?: string
  channel?: InboundChannel
  threadId?: string | null
  config?: Record<string, unknown>
}

/** 路由查询结果（供外部消息入口调用） */
export interface ResolvedInboundRoute {
  /** 归属 Agent ID */
  agentId: string
  /** Thread 通道 */
  channel: InboundChannel
  /** 固定 Thread ID（可选） */
  threadId: string | null
  /** 额外配置 */
  config: Record<string, unknown>
}

// Drizzle 推导的行类型
type InboundRouteRow = typeof inboundRoutes.$inferSelect

// ─────────────────────────────────────────────
// 行 ↔ 领域对象 转换
// ─────────────────────────────────────────────

/** 将 DB 行反序列化为领域对象（解析 JSON 字段） */
function rowToDomain(row: InboundRouteRow): InboundRoute {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(row.config ?? '{}') as Record<string, unknown>
  } catch {
    config = {}
  }
  return {
    id: row.id,
    source: row.source as InboundSource,
    identifier: row.identifier,
    agentId: row.agentId,
    channel: row.channel as InboundChannel,
    threadId: row.threadId ?? null,
    config,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  }
}

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class InboundRouteRepository {
  constructor(private db: DrizzleDb) {}

  /**
   * 按来源和标识查询路由（核心查询）
   *
   * 外部消息入口（SocialBridge / NapCat Adapter 等）收到消息后调用此方法，
   * 根据 (source, identifier) 决定归属 Agent 和 Thread 通道。
   * 唯一索引 uq_inbound_routes_source_identifier 保证最多一条命中。
   */
  async findBySourceAndIdentifier(
    source: string,
    identifier: string,
  ): Promise<InboundRoute | undefined> {
    const rows = await this.db
      .select()
      .from(inboundRoutes)
      .where(
        and(
          eq(inboundRoutes.source, source),
          eq(inboundRoutes.identifier, identifier),
        ),
      )
      .limit(1)
    return rows[0] ? rowToDomain(rows[0]) : undefined
  }

  /** 按 ID 查询路由 */
  async findById(id: string): Promise<InboundRoute | undefined> {
    const rows = await this.db
      .select()
      .from(inboundRoutes)
      .where(eq(inboundRoutes.id, id))
      .limit(1)
    return rows[0] ? rowToDomain(rows[0]) : undefined
  }

  /** 查询某 Agent 的所有路由 */
  async findByAgent(agentId: string): Promise<InboundRoute[]> {
    const rows = await this.db
      .select()
      .from(inboundRoutes)
      .where(eq(inboundRoutes.agentId, agentId))
    return rows.map(rowToDomain)
  }

  /** 查询某来源的所有路由 */
  async findBySource(source: string): Promise<InboundRoute[]> {
    const rows = await this.db
      .select()
      .from(inboundRoutes)
      .where(eq(inboundRoutes.source, source))
    return rows.map(rowToDomain)
  }

  /** 列出所有路由 */
  async list(): Promise<InboundRoute[]> {
    const rows = await this.db.select().from(inboundRoutes)
    return rows.map(rowToDomain)
  }

  /** 创建路由 */
  async create(data: CreateInboundRouteInput): Promise<InboundRoute> {
    const id = generateUuid()
    const [row] = await this.db
      .insert(inboundRoutes)
      .values({
        id,
        source: data.source,
        identifier: data.identifier,
        agentId: data.agentId,
        channel: data.channel ?? 'social',
        threadId: data.threadId ?? null,
        config: JSON.stringify(data.config ?? {}),
      })
      .returning()
    return rowToDomain(row!)
  }

  /** 更新路由（部分字段） */
  async update(id: string, data: UpdateInboundRouteInput): Promise<InboundRoute | undefined> {
    const set: Record<string, unknown> = {}
    if (data.agentId !== undefined) set.agentId = data.agentId
    if (data.channel !== undefined) set.channel = data.channel
    if (data.threadId !== undefined) set.threadId = data.threadId
    if (data.config !== undefined) set.config = JSON.stringify(data.config)

    if (Object.keys(set).length === 0) {
      // 无字段需要更新，直接返回现有记录
      return this.findById(id)
    }

    const [row] = await this.db
      .update(inboundRoutes)
      .set(set)
      .where(eq(inboundRoutes.id, id))
      .returning()
    return row ? rowToDomain(row) : undefined
  }

  /** 删除路由 */
  async delete(id: string): Promise<void> {
    await this.db.delete(inboundRoutes).where(eq(inboundRoutes.id, id))
  }

  /**
   * 解析外部消息的路由（便捷方法）
   *
   * 查询 (source, identifier) 对应的路由，未命中时返回 null。
   * 调用方应在返回 null 时回退到 defaultAgentId。
   */
  async resolve(
    source: string,
    identifier: string,
  ): Promise<ResolvedInboundRoute | null> {
    const route = await this.findBySourceAndIdentifier(source, identifier)
    if (!route) return null
    return {
      agentId: route.agentId,
      channel: route.channel,
      threadId: route.threadId,
      config: route.config,
    }
  }
}

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

/**
 * 生成 UUID v4（不依赖外部库，使用 crypto.randomUUID）
 *
 * Node.js >= 19 有 crypto.randomUUID；旧版本回退到手动拼接。
 */
function generateUuid(): string {
  // 优先使用 Node.js 内置 crypto.randomUUID（同步、零依赖）
  try {
    return globalThis.crypto.randomUUID()
  } catch {
    // 回退方案：基于时间戳和随机数的简易 UUID（非标准 v4，但满足唯一性需求）
    const hex = '0123456789abcdef'
    let uuid = ''
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-'
      } else if (i === 14) {
        uuid += '4'
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8]
      } else {
        uuid += hex[(Math.random() * 16) | 0]
      }
    }
    return uuid
  }
}
