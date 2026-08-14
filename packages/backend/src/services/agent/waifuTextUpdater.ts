/**
 * Waifu Text Updater — 看板娘台词动态更新服务
 *
 * 根据近期记忆生成/更新看板娘的动态台词（欢迎语、挂机闲聊等），
 * 使台词融入近期互动内容，体现"活人感"。
 *
 * 执行时机：
 * - 由 ReflectionOrchestrator 在 Reflection 维护周期末尾触发
 * - 前置条件：当日有足够新记忆积累
 *
 * 数据流：
 *   近期记忆 → LLM (waifu_text_updater.md) → JSON → ConfigRepository
 *   → 前端 PetView 通过 API 获取最新台词
 *
 * @module packages/backend/src/services/agent/waifuTextUpdater
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { AgentManager } from './agentManager'
import type { MemoryRepository } from '../../repositories/memory.repo'
import { parseLlmJson } from '../../shared/llmJsonParser'
import { createLogger } from '../../lib/logger'
import { readFileSync } from 'fs'

const logger = createLogger('WaifuTextUpdater')

// ─────────────────────────────────────────────
// 台词字段定义
// ─────────────────────────────────────────────

/** 需要生成的台词结构及说明；键名与 Agent.waifuTexts / Pet3D 消费结构完全一致。 */
const TARGET_FIELDS = `
- \`visibilityBack\`: 用户切回窗口时的欢迎语（字符串，简短可爱）
- \`idleMessages\`: 挂机时的随机闲聊（字符串数组，3-5 句）
- \`welcome\`: 分时段问候对象，可包含 morningEarly / morning / noon / afternoon / eveningSunset / night / midnight
- \`randTextures\`: 换装台词对象，可包含 noClothes / success
`.trim()

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface WaifuTextUpdaterDeps {
  llmService: LlmService
  getModelConfig: () => Promise<ModelConfig | null>
  mdpEngine: MdpEngine
  configRepo: ConfigRepository
  agentManager: AgentManager
  memoryRepo: MemoryRepository
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class WaifuTextUpdater {
  private deps: WaifuTextUpdaterDeps

  constructor(deps: WaifuTextUpdaterDeps) {
    this.deps = deps
  }

  /**
   * 更新指定 Agent 的看板娘台词
   *
   * @returns 更新的字段数 (0 = 跳过或失败)
   */
  async update(agentId: string): Promise<number> {
    const agent = this.deps.agentManager.getAgent(agentId)
    if (!agent) {
      logger.warn(`Agent 不存在: ${agentId}`)
      return 0
    }

    // 1. 获取近期记忆作为上下文
    const { data: recentMemories } = await this.deps.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: 20,
    })

    if (recentMemories.length === 0) {
      logger.info(`无近期记忆，跳过台词更新: agent=${agentId}`)
      return 0
    }

    const contextText = recentMemories.map((m) => `- ${m.content}`).join('\n')

    // 2. 读取当前台词 (从 ConfigRepository)
    const configKey = `waifu_dynamic_texts_${agentId}`
    const currentTexts =
      (await this.deps.configRepo.getJson<Record<string, unknown>>(configKey)) ?? {}

    // 3. 获取 LLM 配置
    const modelConfig = await this.deps.getModelConfig()
    if (!modelConfig) {
      logger.warn('未配置 LLM，跳过台词更新')
      return 0
    }

    // 4. 渲染提示词
    // AIOS: 人设统一从 system_prompt.md 读取（原 workPersona 已移除）
    let personaDefinition = ''
    try {
      personaDefinition = readFileSync(agent.promptPath, 'utf-8')
    } catch {
      logger.warn(`读取人设文件失败: ${agent.promptPath}`)
    }
    // 称呼/名字：称呼取该 Agent 的 agent.json owner_appellation（兜底"主人"），名字仍读全局 owner.name
    const ownerName = (await this.deps.configRepo.get('owner.name')) ?? '用户'
    const ownerAppellation = agent.ownerAppellation
    const systemPrompt = this.deps.mdpEngine.render('tasks/agent/waifu_text_updater', {
      agent_name: agent.name,
      owner_name: ownerName,
      owner_appellation: ownerAppellation,
      persona_definition: personaDefinition,
      context_text: contextText,
      current_texts: JSON.stringify(currentTexts, null, 2),
      target_fields: TARGET_FIELDS,
    })

    // 5. 调用 LLM 生成新台词
    try {
      const completion = await this.deps.llmService.chat(
        modelConfig,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '请根据上述记忆和要求，生成更新后的台词 JSON。' },
        ],
        {
          responseFormat: { type: 'json_object' },
        },
      )

      const rawContent = completion.choices[0]?.message?.content
      if (!rawContent) {
        logger.warn('LLM 返回空内容')
        return 0
      }

      const newTexts = parseLlmJson<Record<string, unknown>>(rawContent)
      if (!newTexts || typeof newTexts !== 'object') {
        logger.warn('LLM 返回的 JSON 解析失败')
        return 0
      }

      // 6. 合并并保存到 ConfigRepository
      const merged = { ...currentTexts, ...newTexts }
      await this.deps.configRepo.setJson(configKey, merged)

      const updatedCount = Object.keys(newTexts).length
      logger.info(`台词更新完成: agent=${agentId}, 更新 ${updatedCount} 个字段`)

      return updatedCount
    } catch (err) {
      logger.error(`台词更新失败: ${err}`)
      return 0
    }
  }
}
