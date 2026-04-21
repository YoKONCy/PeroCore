/**
 * ModelRoleResolver — 统一模型角色解析
 *
 * 模型分工 (四角色):
 * ──────────────────────────────────────────────────────────────
 *   角色        config key          职责
 * ──────────────────────────────────────────────────────────────
 *   主模型      llm.main            Agent 对话、日记生成、台词更新
 *   书记员      llm.secretary       Scorer 记忆提炼、图谱构建 (GraphGardener)
 *   反思        llm.reflection      Tagger / Consolidator / Auditor / DreamAssociator
 *   辅助        llm.auxiliary       NIT 工具调用 (文件搜索汇总、工具失败重试等)
 * ──────────────────────────────────────────────────────────────
 *
 * 注意: 社交模式的"秘书决策"(secretary_decision) 实为社交思考状态机,
 * 不是独立模型角色, 它使用书记员模型驱动。
 *
 * 回退规则: 任何角色未配置时回退到主模型配置。
 *
 * @module packages/backend/src/services/llm/modelRoles
 */

import type { ConfigRepository } from '../../repositories/config.repo'
import type { ModelConfig } from './llmService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ModelRoleResolver')

/** 模型角色枚举 */
export type ModelRole = 'main' | 'secretary' | 'reflection' | 'auxiliary'

/** 角色 → config key 映射 */
const ROLE_CONFIG_KEYS: Record<ModelRole, string> = {
  main: 'llm.main',
  secretary: 'llm.secretary',
  reflection: 'llm.reflection',
  auxiliary: 'llm.auxiliary',
}

/** 各角色的默认温度 */
const ROLE_DEFAULT_TEMPERATURE: Record<ModelRole, number> = {
  main: 0.7,
  secretary: 0.3,
  reflection: 0.2,
  auxiliary: 0.1,
}

export class ModelRoleResolver {
  constructor(private configRepo: ConfigRepository) {}

  /**
   * 获取指定角色的模型配置
   *
   * 回退链: 角色专用配置 → 主模型配置 → 旧版兼容 → null
   */
  async resolve(role: ModelRole): Promise<ModelConfig | null> {
    // 1. 尝试获取角色专用配置
    if (role !== 'main') {
      const roleConfig = await this.loadConfig(ROLE_CONFIG_KEYS[role])
      if (roleConfig) {
        logger.debug(`使用 ${role} 专用模型: ${roleConfig.modelId}`)
        return {
          ...roleConfig,
          temperature: roleConfig.temperature ?? ROLE_DEFAULT_TEMPERATURE[role],
        }
      }
    }

    // 2. 回退到主模型
    const mainConfig = await this.loadConfig(ROLE_CONFIG_KEYS.main)
    if (mainConfig) {
      if (role !== 'main') {
        logger.debug(`${role} 未配置专用模型, 回退到主模型: ${mainConfig.modelId}`)
      }
      return {
        ...mainConfig,
        temperature: mainConfig.temperature ?? ROLE_DEFAULT_TEMPERATURE[role],
      }
    }

    // 3. 兼容旧版 config key (平滑迁移)
    const legacyConfig = await this.loadLegacyConfig(role)
    if (legacyConfig) return legacyConfig

    return null
  }

  /**
   * 创建绑定到特定角色的 getter (用于依赖注入)
   *
   * @example
   * const getReflectionModel = resolver.bind('reflection')
   * const config = await getReflectionModel()
   */
  bind(role: ModelRole): () => Promise<ModelConfig | null> {
    return () => this.resolve(role)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /** 从 ConfigRepo 加载模型配置 JSON */
  private async loadConfig(key: string): Promise<ModelConfig | null> {
    try {
      const raw = await this.configRepo.getJson<Record<string, unknown>>(key)
      if (!raw) return null

      const apiKey = (raw.apiKey as string) ?? (await this.configRepo.get('global_llm_api_key'))
      if (!apiKey) return null

      const modelId = raw.modelId as string | undefined
      if (!modelId) return null

      return {
        provider: (raw.provider as string) ?? 'openai',
        modelId,
        apiKey,
        apiBase:
          (raw.apiBase as string) ??
          (await this.configRepo.get('global_llm_api_base')) ??
          undefined,
        temperature: raw.temperature as number | undefined,
        maxTokens: raw.maxTokens as number | undefined,
      }
    } catch {
      return null
    }
  }

  /**
   * 兼容旧版 config key
   *
   * 旧 key:
   * - scorer_model_id / secretary_model_id → secretary (同一角色)
   * - reflection_model_id → reflection
   * - llm.default → main
   */
  private async loadLegacyConfig(role: ModelRole): Promise<ModelConfig | null> {
    const apiKey = await this.configRepo.get('global_llm_api_key')
    if (!apiKey) return null

    const apiBase = await this.configRepo.get('global_llm_api_base')

    // 尝试 llm.default (旧版主模型)
    const defaultConfig = await this.configRepo.getJson<Record<string, unknown>>('llm.default')
    if (defaultConfig) {
      const modelId = (defaultConfig.modelId as string) ?? undefined
      if (!modelId) return null

      return {
        provider: (defaultConfig.provider as string) ?? 'openai',
        modelId,
        apiKey,
        apiBase: apiBase ?? undefined,
        temperature: ROLE_DEFAULT_TEMPERATURE[role],
      }
    }

    // 最终兜底: 旧版 key (scorer/secretary 是同一个角色)
    let modelId: string | undefined
    if (role === 'secretary') {
      modelId =
        (await this.configRepo.get('secretary_model_id')) ??
        (await this.configRepo.get('scorer_model_id'))
    } else if (role === 'reflection') {
      modelId = await this.configRepo.get('reflection_model_id')
    }

    if (modelId) {
      return {
        provider: 'openai',
        modelId,
        apiKey,
        apiBase: apiBase ?? undefined,
        temperature: ROLE_DEFAULT_TEMPERATURE[role],
      }
    }

    return null
  }
}
