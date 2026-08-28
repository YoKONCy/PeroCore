/**
 * ModelRoleResolver — 统一模型任务槽解析
 *
 * 设计理念：
 * 用户在 Dashboard 配置若干"模型实例"（如 GPT-4o、Claude），
 * 并指定其中一个为主模型。系统内所有需要 LLM 的任务通过"任务槽"
 * 指派使用哪个模型实例，未指派的回退到主模型。
 *
 * 任务槽（中粒度，按子系统+用途分组）:
 * ──────────────────────────────────────────────────────────────
 *   任务槽              config key                     职责
 * ──────────────────────────────────────────────────────────────
 *   main（主模型）      model.main                     角色未单独指派时的默认模型
 *   scorer             model.task.scorer              从对话中整理值得长期记住的内容
 *   reflection         model.task.reflection          整理记忆关系、修订和去重
 *   social_scorer      model.task.social_scorer       整理社交互动中的长期记忆
 *   butler             model.task.butler              理解据点管理请求并生成操作建议
 * ──────────────────────────────────────────────────────────────
 *
 * 社交回复与日记属于角色自身的表达，使用角色指派模型；
 * 社交调度已改为确定性规则，不再占用独立模型槽。
 *
 * 数据流:
 * Dashboard 模型配置页 → ai_model_configs 表（模型实例池）
 *                       → config KV: model.main = instanceId（主模型指定）
 *                       → config KV: model.task.{slot} = instanceId（任务指派）
 *                       → config KV: model.agent.{agentId} = instanceId（角色指派）
 *
 * 回退链: 角色专用模型/任务专用模型 → 主模型 → 环境变量 → null
 *
 * @module packages/backend/src/services/llm/modelRoles
 */

import type { ConfigRepository } from '../../repositories/config.repo'
import type { ModelRepository } from '../../repositories/model.repo'
import type { ModelConfig } from './llmService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ModelRoleResolver')

// ─────────────────────────────────────────────
// 任务槽定义
// ─────────────────────────────────────────────

/**
 * 任务槽枚举
 *
 * - main: 主模型（特殊，不是 task slot，是所有任务的回退默认值）
 * - 其他: 具体任务槽，未配置时回退到 main
 */
export type ModelTaskSlot = 'main' | 'scorer' | 'reflection' | 'social_scorer' | 'butler'

/** config KV 中的 key 映射 */
const TASK_CONFIG_KEYS: Record<ModelTaskSlot, string> = {
  main: 'model.main',
  scorer: 'model.task.scorer',
  reflection: 'model.task.reflection',
  social_scorer: 'model.task.social_scorer',
  butler: 'model.task.butler',
}

// ─────────────────────────────────────────────
// Resolver
// ─────────────────────────────────────────────

export class ModelRoleResolver {
  constructor(
    private configRepo: ConfigRepository,
    private modelRepo: ModelRepository,
  ) {}

  /**
   * 获取指定任务槽的模型配置
   *
   * 回退链: 任务槽专用模型 → 主模型 → 环境变量 → null
   */
  async resolve(task: ModelTaskSlot): Promise<ModelConfig | null> {
    // 1. 尝试获取任务槽专用模型（main 本身跳过此步）
    if (task !== 'main') {
      const taskConfig = await this.loadFromDb(TASK_CONFIG_KEYS[task])
      if (taskConfig) {
        logger.debug(`使用 ${task} 任务模型: ${taskConfig.modelId}`)
        return taskConfig
      }
    }

    // 2. 回退到主模型
    const mainConfig = await this.loadFromDb(TASK_CONFIG_KEYS.main)
    if (mainConfig) {
      if (task !== 'main') {
        logger.debug(`${task} 未配置专用模型, 回退到主模型: ${mainConfig.modelId}`)
      }
      return mainConfig
    }

    // 3. 环境变量兜底
    const envConfig = this.loadFromEnv()
    if (envConfig) {
      logger.debug(`${task} 从环境变量加载: ${envConfig.modelId}`)
      return envConfig
    }

    logger.warn(`${task} 无可用模型配置`)
    return null
  }

  /**
   * 获取指定角色的对话模型。
   *
   * 回退链: 角色专用模型 → 主模型 → 环境变量 → null
   */
  async resolveAgent(agentId: string): Promise<ModelConfig | null> {
    const normalizedAgentId = agentId.trim().toLowerCase()
    if (normalizedAgentId) {
      const agentConfig = await this.loadFromDb(`model.agent.${normalizedAgentId}`)
      if (agentConfig) {
        logger.debug(`角色 ${normalizedAgentId} 使用专用模型: ${agentConfig.modelId}`)
        return agentConfig
      }
    }
    return this.resolve('main')
  }

  /** 创建绑定到指定角色的模型 getter。 */
  bindAgent(): (agentId: string) => Promise<ModelConfig | null> {
    return (agentId) => this.resolveAgent(agentId)
  }

  async resolveById(modelConfigId: number): Promise<ModelConfig | null> {
    try {
      const row = await this.modelRepo.findById(modelConfigId)
      return row ? this.resolveRow(row) : null
    } catch (err) {
      logger.warn(`按ID加载模型配置失败 (id=${modelConfigId}): ${err}`)
      return null
    }
  }

  /**
   *创建绑定到特定任务槽的getter（用于依赖注入）
   *
   * @example
   * const getMainModel = resolver.bind('main')
   * const getScorerModel = resolver.bind('scorer')
   * const config = await getScorerModel()
   */
  bind(task: ModelTaskSlot): () => Promise<ModelConfig | null> {
    return () => this.resolve(task)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /**
   * 从 DB 加载模型配置
   *
   * 流程: config KV (model.main / model.task.{slot}) → 获取 instanceId
   *       → ModelRepository 查 ai_model_configs 表获取完整信息
   *       → 如果模型自身没有 apiKey，从全局供应商配置 fallback
   */
  private async loadFromDb(configKey: string): Promise<ModelConfig | null> {
    try {
      const modelIdStr = await this.configRepo.get(configKey)
      if (!modelIdStr) return null

      const modelId = Number(modelIdStr)
      if (isNaN(modelId)) return null

      const row = await this.modelRepo.findById(modelId)
      if (!row) {
        logger.warn(`模型 ID ${modelId} 在数据库中不存在 (configKey=${configKey})`)
        return null
      }

      return this.resolveRow(row)
    } catch (err) {
      logger.warn(`加载模型配置失败 (key=${configKey}): ${err}`)
      return null
    }
  }

  private async resolveRow(
    row: NonNullable<Awaited<ReturnType<ModelRepository['findById']>>>,
  ): Promise<ModelConfig | null> {
    let apiKey: string | undefined = row.apiKey ?? undefined
    let apiBase: string | undefined = row.apiBase ?? undefined
    if (!apiKey) {
      const globalApiKey = await this.configRepo.get(`global.${row.provider}.apiKey`)
      const globalApiBase = await this.configRepo.get(`global.${row.provider}.apiBase`)
      if (globalApiKey) {
        apiKey = globalApiKey
        if (!apiBase && globalApiBase) apiBase = globalApiBase
      }
    }
    if (!apiKey) {
      logger.warn(`模型${row.name}无API Key（自身和全局供应商${row.provider}均未配置）`)
      return null
    }
    return {
      provider: row.provider ?? 'openai',
      modelId: row.modelId,
      apiKey,
      apiBase,
      temperature: row.temperature ?? undefined,
      topP: row.topP ?? undefined,
      maxTokens: row.maxTokens ?? undefined,
      contextWindowTokens: row.contextWindowTokens ?? undefined,
      reasoningEffort: (row.reasoningEffort as ModelConfig['reasoningEffort']) ?? undefined,
      returnNativeReasoning: row.returnNativeReasoning ?? false,
      wireApi: (row.wireApi as ModelConfig['wireApi']) ?? 'chat_completions',
      reasoningDialect: (row.reasoningDialect as ModelConfig['reasoningDialect']) ?? 'auto',
      enableVision: row.enableVision ?? false,
      enableAudioInput: row.enableAudioInput ?? false,
    }
  }

  /** 环境变量兜底 */
  private loadFromEnv(): ModelConfig | null {
    const apiKey = process.env.PERO_LLM_API_KEY
    const modelId = process.env.PERO_LLM_MODEL
    if (!apiKey || !modelId) return null

    return {
      provider: process.env.PERO_LLM_PROVIDER ?? 'openai',
      modelId,
      apiKey,
      apiBase: process.env.PERO_LLM_API_BASE,
      enableVision: false,
      enableAudioInput: false,
    }
  }
}
