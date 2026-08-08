/**
 * NodeCapabilityRegistration Repository
 *
 * node_capability_registrations 表的数据访问层（第七阶段 Daemon 独立）。
 * Daemon 维护的"谁能提供什么能力"注册表。
 *
 * 支持节点注册/注销/心跳/查询，CapabilityBridge 通过此 Repo 路由工具调用。
 *
 * @module packages/backend/src/repositories/nodeCapability.repo
 */

import { eq, and, sql } from 'drizzle-orm'
import { nodeCapabilityRegistrations } from '../database/schema'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 节点类型 */
export type NodeType = 'electron' | 'mobile' | 'cli' | 'remote-daemon'

/** 节点状态 */
export type NodeStatus = 'online' | 'offline'

/** 节点能力注册领域对象 */
export interface NodeCapabilityRegistration {
  /** 节点 ID（UUID，节点首次启动时生成并持久化） */
  nodeId: string
  /** 节点类型 */
  nodeType: NodeType
  /** 远程节点的连接地址（本地节点为 null） */
  url: string | null
  /** 该节点能提供的能力列表 */
  capabilities: string[]
  /** 节点状态 */
  status: NodeStatus
  /** 注册时间 */
  registeredAt: string
  /** 最后心跳时间 */
  lastHeartbeat: string
}

/** 注册/更新节点能力的输入 */
export interface UpsertNodeCapabilityInput {
  nodeId: string
  nodeType: NodeType
  url?: string | null
  capabilities: string[]
}

// Drizzle 推导的行类型
type NodeCapabilityRow = typeof nodeCapabilityRegistrations.$inferSelect

// ─────────────────────────────────────────────
// 行 ↔ 领域对象 转换
// ─────────────────────────────────────────────

/** 将 DB 行反序列化为领域对象（解析 JSON 字段） */
function rowToDomain(row: NodeCapabilityRow): NodeCapabilityRegistration {
  let capabilities: string[] = []
  try {
    capabilities = JSON.parse(row.capabilities) as string[]
  } catch {
    capabilities = []
  }
  return {
    nodeId: row.nodeId,
    nodeType: row.nodeType as NodeType,
    url: row.url,
    capabilities,
    status: row.status as NodeStatus,
    registeredAt: row.registeredAt ?? '',
    lastHeartbeat: row.lastHeartbeat ?? '',
  }
}

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class NodeCapabilityRepository {
  constructor(private db: DrizzleDb) {}

  /** 注册或更新节点（upsert） */
  async upsert(data: UpsertNodeCapabilityInput): Promise<NodeCapabilityRegistration> {
    const [row] = await this.db
      .insert(nodeCapabilityRegistrations)
      .values({
        nodeId: data.nodeId,
        nodeType: data.nodeType,
        url: data.url ?? null,
        capabilities: JSON.stringify(data.capabilities),
        status: 'online',
      })
      .onConflictDoUpdate({
        target: nodeCapabilityRegistrations.nodeId,
        set: {
          nodeType: data.nodeType,
          url: data.url ?? null,
          capabilities: JSON.stringify(data.capabilities),
          status: 'online',
          lastHeartbeat: sql`(datetime('now', 'localtime'))`,
        },
      })
      .returning()
    return rowToDomain(row!)
  }

  /** 按 ID 查询节点 */
  async findById(nodeId: string): Promise<NodeCapabilityRegistration | undefined> {
    const rows = await this.db
      .select()
      .from(nodeCapabilityRegistrations)
      .where(eq(nodeCapabilityRegistrations.nodeId, nodeId))
      .limit(1)
    return rows[0] ? rowToDomain(rows[0]) : undefined
  }

  /** 查询所有在线节点 */
  async findOnline(): Promise<NodeCapabilityRegistration[]> {
    const rows = await this.db
      .select()
      .from(nodeCapabilityRegistrations)
      .where(eq(nodeCapabilityRegistrations.status, 'online'))
    return rows.map(rowToDomain)
  }

  /** 查询能提供指定能力的在线节点 */
  async findByCapability(capability: string): Promise<NodeCapabilityRegistration[]> {
    // JSON 数组 LIKE 查询：capabilities 字段格式为 ["a","b"]
    const rows = await this.db
      .select()
      .from(nodeCapabilityRegistrations)
      .where(
        and(
          eq(nodeCapabilityRegistrations.status, 'online'),
          sql`capabilities LIKE ${'%"' + capability + '"%'} COLLATE NOCASE`,
        ),
      )
    return rows.map(rowToDomain)
  }

  /** 更新心跳时间 */
  async heartbeat(nodeId: string): Promise<void> {
    await this.db
      .update(nodeCapabilityRegistrations)
      .set({
        lastHeartbeat: sql`(datetime('now', 'localtime'))`,
        status: 'online',
      })
      .where(eq(nodeCapabilityRegistrations.nodeId, nodeId))
  }

  /** 标记节点离线 */
  async markOffline(nodeId: string): Promise<void> {
    await this.db
      .update(nodeCapabilityRegistrations)
      .set({ status: 'offline' })
      .where(eq(nodeCapabilityRegistrations.nodeId, nodeId))
  }

  /** 标记所有超时节点离线（心跳超过 timeoutSeconds 秒） */
  async markStaleOffline(timeoutSeconds: number): Promise<number> {
    const result = await this.db
      .update(nodeCapabilityRegistrations)
      .set({ status: 'offline' })
      .where(
        and(
          eq(nodeCapabilityRegistrations.status, 'online'),
          sql`last_heartbeat < datetime('now', 'localtime', ${'-' + timeoutSeconds + ' seconds'})`,
        ),
      )
    return result.changes ?? 0
  }

  /** 删除节点注册 */
  async delete(nodeId: string): Promise<void> {
    await this.db
      .delete(nodeCapabilityRegistrations)
      .where(eq(nodeCapabilityRegistrations.nodeId, nodeId))
  }
}
