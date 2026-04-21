/**
 * MCP 配置 Repository
 *
 * 对 mcpConfigs 表的 CRUD 操作。
 * 每条记录对应一个外部 MCP Server 配置 (如 filesystem-server, brave-search 等)。
 *
 * @module packages/backend/src/repositories/mcp.repo
 */

import { eq } from 'drizzle-orm'
import { mcpConfigs } from '../database/schema'
import type { DrizzleDb } from '../database'

// ── 类型 ──

type McpConfigRow = typeof mcpConfigs.$inferSelect

/** 创建 MCP 配置的输入 */
export interface CreateMcpConfigInput {
  name: string
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
}

/** 更新 MCP 配置的输入 */
export interface UpdateMcpConfigInput {
  name?: string
  type?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
}

// ── Repository ──

export class McpConfigRepository {
  constructor(private db: DrizzleDb) {}

  /** 获取所有配置 */
  async findAll(): Promise<McpConfigRow[]> {
    return this.db.select().from(mcpConfigs).all()
  }

  /** 获取所有已启用的配置 */
  async findEnabled(): Promise<McpConfigRow[]> {
    return this.db.select().from(mcpConfigs).where(eq(mcpConfigs.enabled, true)).all()
  }

  /** 按 ID 查询 */
  async findById(id: number): Promise<McpConfigRow | undefined> {
    return this.db.select().from(mcpConfigs).where(eq(mcpConfigs.id, id)).get()
  }

  /** 按名称查询 */
  async findByName(name: string): Promise<McpConfigRow | undefined> {
    return this.db.select().from(mcpConfigs).where(eq(mcpConfigs.name, name)).get()
  }

  /** 创建配置 */
  async create(input: CreateMcpConfigInput): Promise<McpConfigRow> {
    const rows = await this.db
      .insert(mcpConfigs)
      .values({
        name: input.name,
        type: input.type ?? 'stdio',
        command: input.command,
        args: JSON.stringify(input.args ?? []),
        env: JSON.stringify(input.env ?? {}),
        url: input.url,
        enabled: input.enabled ?? true,
      })
      .returning()

    return rows[0]!
  }

  /** 更新配置 */
  async update(id: number, input: UpdateMcpConfigInput): Promise<McpConfigRow | undefined> {
    const updateData: Record<string, unknown> = {}

    if (input.name !== undefined) updateData.name = input.name
    if (input.type !== undefined) updateData.type = input.type
    if (input.command !== undefined) updateData.command = input.command
    if (input.args !== undefined) updateData.args = JSON.stringify(input.args)
    if (input.env !== undefined) updateData.env = JSON.stringify(input.env)
    if (input.url !== undefined) updateData.url = input.url
    if (input.enabled !== undefined) updateData.enabled = input.enabled

    const rows = await this.db
      .update(mcpConfigs)
      .set(updateData)
      .where(eq(mcpConfigs.id, id))
      .returning()

    return rows[0]
  }

  /** 删除配置 */
  async delete(id: number): Promise<boolean> {
    const rows = await this.db.delete(mcpConfigs).where(eq(mcpConfigs.id, id)).returning()

    return rows.length > 0
  }

  /** 切换启用状态 */
  async toggleEnabled(id: number): Promise<McpConfigRow | undefined> {
    const existing = await this.findById(id)
    if (!existing) return undefined

    return this.update(id, { enabled: !existing.enabled })
  }
}
