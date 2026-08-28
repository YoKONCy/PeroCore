/**
 * 模型配置 Repository
 *
 * ai_model_configs 表的数据访问层。
 * 将 model.router 中的直接 DB 操作下沉至此。
 *
 * @module packages/backend/src/repositories/model.repo
 */

import { eq } from 'drizzle-orm'
import { aiModelConfigs } from '../database/schema'
import type { ReasoningEffort } from '../services/llm/types'
import type { DrizzleDb } from '../database'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 创建模型配置输入 */
export interface CreateModelInput {
  name: string
  provider: string
  modelId: string
  apiKey: string
  apiBase?: string
  temperature?: number | null
  topP?: number | null
  maxTokens?: number | null
  contextWindowTokens?: number | null
  reasoningEffort?: ReasoningEffort | null
  returnNativeReasoning?: boolean
  wireApi?: import('../services/llm/types').LlmWireApi
  reasoningDialect?: import('../services/llm/types').ReasoningDialect
  stream?: boolean
  providerType?: string
  enableVision?: boolean
  enableAudioInput?: boolean
}

/** 更新模型配置输入 (所有字段可选) */
export interface UpdateModelInput {
  name?: string
  provider?: string
  modelId?: string
  apiKey?: string
  apiBase?: string
  temperature?: number | null
  topP?: number | null
  maxTokens?: number | null
  contextWindowTokens?: number | null
  reasoningEffort?: ReasoningEffort | null
  returnNativeReasoning?: boolean
  wireApi?: import('../services/llm/types').LlmWireApi
  reasoningDialect?: import('../services/llm/types').ReasoningDialect
  stream?: boolean
  providerType?: string
  enableVision?: boolean
}

// Drizzle 推导行类型
type ModelConfigRow = typeof aiModelConfigs.$inferSelect

// ─────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────

export class ModelRepository {
  constructor(private db: DrizzleDb) {}

  /** 列出所有模型配置 */
  async findAll(): Promise<ModelConfigRow[]> {
    return this.db.select().from(aiModelConfigs).all()
  }

  /** 根据 ID 查找 */
  async findById(id: number): Promise<ModelConfigRow | undefined> {
    return this.db.select().from(aiModelConfigs).where(eq(aiModelConfigs.id, id)).get()
  }

  /** 创建模型配置 */
  async create(data: CreateModelInput): Promise<ModelConfigRow> {
    const now = new Date().toISOString()
    const rows = await this.db
      .insert(aiModelConfigs)
      .values({
        name: data.name,
        provider: data.provider,
        modelId: data.modelId,
        apiKey: data.apiKey,
        apiBase: data.apiBase,
        temperature: data.temperature ?? null,
        topP: data.topP ?? null,
        maxTokens: data.maxTokens ?? null,
        contextWindowTokens: data.contextWindowTokens ?? null,
        reasoningEffort: data.reasoningEffort ?? null,
        returnNativeReasoning: data.returnNativeReasoning ?? false,
        wireApi: data.wireApi ?? 'chat_completions',
        reasoningDialect: data.reasoningDialect ?? 'auto',
        stream: data.stream ?? true,
        providerType: data.providerType ?? 'global',
        enableVision: data.enableVision ?? false,
        enableAudioInput: data.enableAudioInput ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return rows[0]!
  }

  /** 更新模型配置 */
  async update(id: number, data: UpdateModelInput): Promise<ModelConfigRow | undefined> {
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    }
    if (data.name !== undefined) updates.name = data.name
    if (data.provider !== undefined) updates.provider = data.provider
    if (data.modelId !== undefined) updates.modelId = data.modelId
    if (data.apiKey !== undefined) updates.apiKey = data.apiKey
    if (data.apiBase !== undefined) updates.apiBase = data.apiBase
    if (data.temperature !== undefined) updates.temperature = data.temperature
    if (data.topP !== undefined) updates.topP = data.topP
    if (data.maxTokens !== undefined) updates.maxTokens = data.maxTokens
    if (data.contextWindowTokens !== undefined)
      updates.contextWindowTokens = data.contextWindowTokens
    if (data.reasoningEffort !== undefined) updates.reasoningEffort = data.reasoningEffort
    if (data.returnNativeReasoning !== undefined)
      updates.returnNativeReasoning = data.returnNativeReasoning
    if (data.wireApi !== undefined) updates.wireApi = data.wireApi
    if (data.reasoningDialect !== undefined) updates.reasoningDialect = data.reasoningDialect
    if (data.stream !== undefined) updates.stream = data.stream
    if (data.providerType !== undefined) updates.providerType = data.providerType
    if (data.enableVision !== undefined) updates.enableVision = data.enableVision

    await this.db.update(aiModelConfigs).set(updates).where(eq(aiModelConfigs.id, id))

    return this.findById(id)
  }

  /** 删除模型配置 */
  async deleteById(id: number): Promise<boolean> {
    const result = await this.db.delete(aiModelConfigs).where(eq(aiModelConfigs.id, id))
    return (result as unknown as { changes: number }).changes > 0
  }
}
