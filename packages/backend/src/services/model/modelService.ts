/**
 * 模型配置 Service
 *
 * AI 模型配置的业务编排层。
 * 封装 CRUD + API Key 遮蔽 + 连通性测试 + 缓存失效。
 *
 * @module packages/backend/src/services/model/modelService
 */

import type {
  ModelRepository,
  CreateModelInput,
  UpdateModelInput,
} from '../../repositories/model.repo'
import type { LlmService } from '../llm/llmService'
import type { ModelRegistry } from '../llm/modelRegistry'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ModelService')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 模型配置 DTO (API Key 已遮蔽) */
export interface ModelConfigDto {
  id: number
  name: string
  modelId: string
  provider: string | null
  providerType: string | null
  apiKey: string
  apiBase: string | null
  temperature: number | null
  topP: number | null
  maxTokens: number | null
  createdAt: string | null
  updatedAt: string | null
  [key: string]: unknown
}

/** 连通性测试结果 */
export interface TestResult {
  success: boolean
  durationMs: number
  response?: string
  error?: string
}

// ─────────────────────────────────────────────
// 辅助
// ─────────────────────────────────────────────

/** 遮蔽 API Key (保留前4后4) */
function maskKey(key: string | null): string {
  if (!key) return ''
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '****' + key.slice(-4)
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ModelService {
  constructor(
    private modelRepo: ModelRepository,
    private llmService: LlmService,
    private modelRegistry: ModelRegistry,
  ) {}

  /** 列出所有模型配置 (API Key 遮蔽) */
  async list(): Promise<ModelConfigDto[]> {
    const models = await this.modelRepo.findAll()
    return models.map((m) => ({ ...m, apiKey: maskKey(m.apiKey) }))
  }

  /** 获取单个模型配置 */
  async getById(id: number): Promise<ModelConfigDto> {
    const model = await this.modelRepo.findById(id)
    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }
    return { ...model, apiKey: maskKey(model.apiKey) }
  }

  /** 创建模型配置 */
  async create(data: CreateModelInput): Promise<ModelConfigDto> {
    const model = await this.modelRepo.create(data)
    this.modelRegistry.invalidateCache()
    logger.info(`模型配置已创建: ${model.name} (${model.id})`)
    return { ...model, apiKey: maskKey(model.apiKey) }
  }

  /** 更新模型配置 */
  async update(id: number, data: UpdateModelInput): Promise<ModelConfigDto> {
    // 检查是否存在
    const existing = await this.modelRepo.findById(id)
    if (!existing) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    const updated = await this.modelRepo.update(id, data)
    this.modelRegistry.invalidateCache()
    logger.info(`模型配置已更新: ${id}`)
    return { ...updated!, apiKey: maskKey(updated!.apiKey) }
  }

  /** 删除模型配置 */
  async delete(id: number): Promise<void> {
    const existing = await this.modelRepo.findById(id)
    if (!existing) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }
    await this.modelRepo.deleteById(id)
    this.modelRegistry.invalidateCache()
    logger.info(`模型配置已删除: ${existing.name} (${id})`)
  }

  /**
   * 获取远程模型列表
   *
   * 通过 provider + apiKey + apiBase 向远程 API 查询可用模型 ID 列表。
   */
  async listRemoteModels(params: {
    provider: string
    apiKey: string
    apiBase?: string
  }): Promise<string[]> {
    const results = await this.llmService.listModels({
      provider: params.provider,
      modelId: '', // listModels 不需要具体 modelId
      apiKey: params.apiKey,
      apiBase: params.apiBase,
    })
    return results
  }

  /** 测试模型连通性 */
  async test(id: number): Promise<TestResult> {
    const model = await this.modelRepo.findById(id)
    if (!model) {
      throw new AppError('MODEL_NOT_FOUND', {
        message: `未找到 ID 为 ${id} 的模型配置`,
        data: { modelId: id },
      })
    }

    try {
      const startTime = Date.now()
      const response = await this.llmService.chat(
        {
          provider: model.provider ?? 'openai',
          modelId: model.modelId,
          apiKey: model.apiKey ?? '',
          apiBase: model.apiBase ?? undefined,
          temperature: 0,
          maxTokens: 10,
        },
        [{ role: 'user', content: 'Hello, respond with OK.' }],
      )
      const durationMs = Date.now() - startTime

      return {
        success: true,
        durationMs,
        response: response.choices[0]?.message?.content?.slice(0, 50),
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      throw new AppError('LLM_ERROR', {
        message: `模型测试失败: ${errMsg}`,
        data: { success: false, error: errMsg },
      })
    }
  }
}
