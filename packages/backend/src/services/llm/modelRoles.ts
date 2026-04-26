/**
 * ModelRoleResolver — 统一模型角色解析
 *
 * 模型分工 (四角色):
 * ──────────────────────────────────────────────────────────────
 *   角色        config key                    职责
 * ──────────────────────────────────────────────────────────────
 *   主模型      model.role.main               Agent 对话、日记生成、台词更新
 *   书记员      model.role.secretary           Scorer 记忆提炼、图谱构建
 *   反思        model.role.reflection          Tagger / Consolidator / Auditor
 *   辅助        model.role.auxiliary           NIT 工具调用
 * ──────────────────────────────────────────────────────────────
 *
 * 数据流:
 * Dashboard ModelConfigTab  →  ai_model_configs 表 (ModelRepository)
 *                           →  config KV: model.role.main = modelId
 *
 * 本模块: 读 model.role.{role} → 查 ModelRepository → 组装 ModelConfig
 *
 * 回退规则: 角色未配置时回退到主模型 → 环境变量兜底。
 *
 * @module packages/backend/src/services/llm/modelRoles
 */

import type { ConfigRepository } from '../../repositories/config.repo'
import type { ModelRepository } from '../../repositories/model.repo'
import type { ModelConfig } from './llmService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ModelRoleResolver')

/** 模型角色枚举 */
export type ModelRole = 'main' | 'secretary' | 'reflection' | 'auxiliary'

/** config KV 中的角色 key */
const ROLE_CONFIG_KEYS: Record<ModelRole, string> = {
  main: 'model.role.main',
  secretary: 'model.role.secretary',
  reflection: 'model.role.reflection',
  auxiliary: 'model.role.aux',
}

/** 各角色的默认温度 */
const ROLE_DEFAULT_TEMPERATURE: Record<ModelRole, number> = {
  main: 0.7,
  secretary: 0.3,
  reflection: 0.2,
  auxiliary: 0.1,
}

export class ModelRoleResolver {
  constructor(
    private configRepo: ConfigRepository,
    private modelRepo: ModelRepository,
  ) {}

  /**
   * 获取指定角色的模型配置
   *
   * 回退链: 角色专用模型 → 主模型 → 环境变量 → null
   */
  async resolve(role: ModelRole): Promise<ModelConfig | null> {
    // 1. 尝试获取角色专用模型
    if (role !== 'main') {
      const roleConfig = await this.loadFromDb(ROLE_CONFIG_KEYS[role])
      if (roleConfig) {
        logger.debug(`使用 ${role} 专用模型: ${roleConfig.modelId}`)
        return {
          ...roleConfig,
          temperature: roleConfig.temperature ?? ROLE_DEFAULT_TEMPERATURE[role],
        }
      }
    }

    // 2. 回退到主模型
    const mainConfig = await this.loadFromDb(ROLE_CONFIG_KEYS.main)
    if (mainConfig) {
      if (role !== 'main') {
        logger.debug(`${role} 未配置专用模型, 回退到主模型: ${mainConfig.modelId}`)
      }
      return {
        ...mainConfig,
        temperature: mainConfig.temperature ?? ROLE_DEFAULT_TEMPERATURE[role],
      }
    }

    // 3. 环境变量兜底
    const envConfig = this.loadFromEnv()
    if (envConfig) {
      logger.debug(`${role} 从环境变量加载: ${envConfig.modelId}`)
      return {
        ...envConfig,
        temperature: ROLE_DEFAULT_TEMPERATURE[role],
      }
    }

    logger.warn(`${role} 无可用模型配置`)
    return null
  }

  /**
   * 创建绑定到特定角色的 getter (用于依赖注入)
   *
   * @example
   * const getMainModel = resolver.bind('main')
   * const config = await getMainModel()
   */
  bind(role: ModelRole): () => Promise<ModelConfig | null> {
    return () => this.resolve(role)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /**
   * 从 DB 加载模型配置
   *
   * 流程: config KV (model.role.main) → 获取 modelId
   *       → ModelRepository 查 ai_model_configs 表获取完整信息
   *       → 如果模型自身没有 apiKey，从全局供应商配置 fallback
   */
  private async loadFromDb(configKey: string): Promise<ModelConfig | null> {
    try {
      // 读 config KV 获取模型 ID
      const modelIdStr = await this.configRepo.get(configKey)
      if (!modelIdStr) return null

      // 查 ai_model_configs 表
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
        // 全局供应商 fallback: global.{provider}.apiKey
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
    }
  }
}
