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
 *   main（主模型）      model.main                     Agent 对话、日记生成
 *   scorer             model.task.scorer              记忆提炼（Scorer、Importer）
 *   reflection         model.task.reflection          记忆反思（Tagger/Consolidator/Auditor/Gardener/Dreamer/WaifuUpdater）
 *   social_reply       model.task.social_reply        社交回复生成（需人格表现力）
 *   social_scheduler   model.task.social_scheduler    社交决策（思考状态机）
 *   social_scorer      model.task.social_scorer       社交记忆炼化
 * ──────────────────────────────────────────────────────────────
 *
 * ⚠️ 特例说明（社交应用任务槽统一配置）：
 * 按 AIOS 资源隔离原则，subagent 应独立管理自己的模型配置。
 * 但社交应用极为特殊（由用户在 Dashboard 直接启动、跟随主 Agent 生命周期），
 * 因此社交相关的 3 个任务槽（social_reply/social_scheduler/social_scorer）
 * 统一在主配置页指派。**其他 subagent 应用绝对不能这样做**，
 * 必须在应用自己的 manifest/config 中声明模型需求。
 *
 * 数据流:
 * Dashboard 模型配置页 → ai_model_configs 表（模型实例池）
 *                       → config KV: model.main = instanceId（主模型指定）
 *                       → config KV: model.task.{slot} = instanceId（任务指派）
 *
 * 回退链: task 专用模型 → 主模型 → 环境变量 → null
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
export type ModelTaskSlot =
  | 'main'
  | 'scorer'
  | 'reflection'
  | 'social_reply'
  | 'social_scheduler'
  | 'social_scorer'

/** config KV 中的 key 映射 */
const TASK_CONFIG_KEYS: Record<ModelTaskSlot, string> = {
  main: 'model.main',
  scorer: 'model.task.scorer',
  reflection: 'model.task.reflection',
  social_reply: 'model.task.social_reply',
  social_scheduler: 'model.task.social_scheduler',
  social_scorer: 'model.task.social_scorer',
}

/**
 * 各任务槽的默认温度
 *
 * main/social_reply 需要创意表现力 → 较高温度
 * scorer/social_scorer/social_scheduler 需要结构化输出/决策 → 较低温度
 * reflection 需要稳定分析 → 最低温度
 */
const TASK_DEFAULT_TEMPERATURE: Record<ModelTaskSlot, number> = {
  main: 0.7,
  scorer: 0.3,
  reflection: 0.2,
  social_reply: 0.7, // 社交回复是对外人格表现，需要创意
  social_scheduler: 0.3, // 决策类，低温
  social_scorer: 0.3, // 结构化输出，低温
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
        return {
          ...taskConfig,
          temperature: taskConfig.temperature ?? TASK_DEFAULT_TEMPERATURE[task],
        }
      }
    }

    // 2. 回退到主模型
    const mainConfig = await this.loadFromDb(TASK_CONFIG_KEYS.main)
    if (mainConfig) {
      if (task !== 'main') {
        logger.debug(`${task} 未配置专用模型, 回退到主模型: ${mainConfig.modelId}`)
      }
      return {
        ...mainConfig,
        temperature: mainConfig.temperature ?? TASK_DEFAULT_TEMPERATURE[task],
      }
    }

    // 3. 环境变量兜底
    const envConfig = this.loadFromEnv()
    if (envConfig) {
      logger.debug(`${task} 从环境变量加载: ${envConfig.modelId}`)
      return {
        ...envConfig,
        temperature: TASK_DEFAULT_TEMPERATURE[task],
      }
    }

    logger.warn(`${task} 无可用模型配置`)
    return null
  }

  /**
   * 创建绑定到特定任务槽的 getter（用于依赖注入）
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

      // 如果模型自身有 apiKey，直接用；否则从全局供应商配置 fallback
      let apiKey: string | undefined = row.apiKey ?? undefined
      let apiBase: string | undefined = row.apiBase ?? undefined

      if (!apiKey) {
        const provider = row.provider
        const globalApiKey = await this.configRepo.get(`global.${provider}.apiKey`)
        const globalApiBase = await this.configRepo.get(`global.${provider}.apiBase`)
        if (globalApiKey) {
          apiKey = globalApiKey
          if (!apiBase && globalApiBase) apiBase = globalApiBase
        }
      }

      if (!apiKey) {
        logger.warn(`模型 ${row.name} 无 API Key (自身和全局供应商 ${row.provider} 均未配置)`)
        return null
      }

      return {
        provider: row.provider ?? 'openai',
        modelId: row.modelId,
        apiKey,
        apiBase,
        temperature: row.temperature ?? undefined,
        maxTokens: row.maxTokens ?? undefined,
        enableVision: row.enableVision ?? false,
      }
    } catch (err) {
      logger.warn(`加载模型配置失败 (key=${configKey}): ${err}`)
      return null
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
    }
  }
}
