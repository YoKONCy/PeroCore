/**
 * Prompt Service — 系统提示词组装
 *
 * 混合模式：
 * - **对话模式**: 使用 SillyTavern 风格的槽位拼接 (buildPromptMessages)
 * - **后台任务**: 使用单模板渲染 (renderTemplate)
 *
 * 替代 v1 的 prompt_service.py (692行 → ~180行)。
 *
 * @module packages/backend/src/services/prompt/promptService
 */

import type { MdpEngine, PromptSlot, PromptPreset, RenderedMessage } from './mdpEngine'
import type { AgentManager, AgentProfile } from '../agent/agentManager'
import type { EnrichedContext } from '../pipeline/types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('PromptService')

/** Prompt 组装结果 (单模板模式, 向后兼容) */
export interface PromptResult {
  /** System Prompt (header 部分) */
  systemPrompt: string
  /** Footer (注入到最后一条 user 消息之前) */
  footer: string
}

/** 提示词消息组装结果 (槽位拼接模式) */
export interface PromptMessagesResult {
  /** 渲染后的消息列表 (可直接送 LLM) */
  messages: RenderedMessage[]
  /** 使用的槽位快照 (调试/前端展示用) */
  slots: PromptSlot[]
}

export class PromptService {
  constructor(
    private mdp: MdpEngine,
    private agentManager: AgentManager,
  ) {}

  // ─────────────────────────────────────────
  // 模式 A: 槽位拼接 (SillyTavern 风格)
  // ─────────────────────────────────────────

  /**
   * 基于槽位拼接的提示词组装
   *
   * 流程：
   * 1. 从 MDP 引擎构建默认槽位列表
   * 2. 如有用户预设，应用覆盖
   * 3. 构建变量字典
   * 4. 渲染所有启用的槽位 → 消息列表
   */
  buildPromptMessages(
    agentId: string,
    source: string,
    enriched: EnrichedContext,
    preset?: PromptPreset,
    extraVars: Record<string, string> = {},
  ): PromptMessagesResult {
    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      logger.warn(`Agent ${agentId} 未找到，返回空消息列表`)
      return {
        messages: [{ role: 'system', content: '你是一个 AI 助手。', slotId: 'fallback' }],
        slots: [],
      }
    }

    // 1. 构建默认槽位
    let slots = this.mdp.buildDefaultSlots(agentId)

    // 2. 应用预设覆盖
    if (preset) {
      slots = this.mdp.applyPreset(slots, preset)
    }

    // 3. 构建变量字典
    const vars = this.buildVars(agent, source, enriched, extraVars)

    // 4. 渲染槽位 → 消息列表
    const messages = this.mdp.renderSlots(slots, vars, {
      mergeAdjacentRoles: true,
      skipEmpty: true,
    })

    return { messages, slots }
  }

  /**
   * 获取默认槽位列表 (给前端展示用)
   */
  getDefaultSlots(agentId: string): PromptSlot[] {
    return this.mdp.buildDefaultSlots(agentId)
  }

  // ─────────────────────────────────────────
  // 模式 B: 单模板渲染 (向后兼容)
  // ─────────────────────────────────────────

  /**
   * 组装 System Prompt (向后兼容 API)
   *
   * 使用旧的 "header + footer" 模式。
   * 适用于不需要槽位拼接的简单场景。
   */
  assemble(
    agentId: string,
    source: string,
    enriched: EnrichedContext,
    extraVars: Record<string, string> = {},
  ): PromptResult {
    const agent = this.agentManager.getAgent(agentId)
    if (!agent) {
      logger.warn(`Agent ${agentId} 未找到，使用默认 Prompt`)
      return { systemPrompt: '你是一个 AI 助手。', footer: '' }
    }

    // 构建模板变量字典
    const vars = this.buildVars(agent, source, enriched, extraVars)

    // 渲染系统提示词
    const systemPrompt = this.mdp.render('system_prompt', vars)

    // 注入模式特定人设
    let finalPrompt = systemPrompt
    const persona = this.getPersonaForSource(agent, source)
    if (persona) {
      finalPrompt += `\n\n${persona}`
    }

    // 渲染 footer (如果有)
    const footer = this.mdp.render('footer', vars)

    return {
      systemPrompt: finalPrompt,
      footer: footer.startsWith('{{Missing') ? '' : footer,
    }
  }

  /** 渲染任意 MDP 模板 (给 ScorerService / ReflectionOrchestrator 等调用) */
  renderTemplate(templateKey: string, vars: Record<string, unknown> = {}): string {
    return this.mdp.render(templateKey, vars)
  }

  /** 渲染任意模板字符串 */
  renderString(template: string, vars: Record<string, unknown> = {}): string {
    return this.mdp.renderString(template, vars)
  }

  // ─────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────

  /** 从 EnrichedContext 构建变量字典 */
  private buildVars(
    agent: AgentProfile,
    source: string,
    enriched: EnrichedContext,
    extraVars: Record<string, string>,
  ): Record<string, string> {
    return {
      // Agent 信息
      agent_name: agent.name,
      agent_id: agent.id,
      agent_description: agent.description,

      // 时间
      current_time: enriched.currentTime,

      // 历史
      flattened_desktop_history: enriched.flattenedDesktopHistory,
      flattened_group_history: enriched.flattenedGroupHistory,

      // 记忆
      memory_context: enriched.memoryContext,
      graph_context: enriched.graphContext,
      weekly_report_context: enriched.weeklyReportContext,

      // 状态
      mood: enriched.mood,
      vibe: enriched.vibe,
      mind: enriched.mind,
      owner_name: enriched.ownerName,
      user_persona: enriched.userPersona,

      // 来源
      source,

      // 模式特定人设
      work_persona: agent.workPersona,
      social_persona: agent.socialPersona,

      // 调用方覆盖
      ...extraVars,
    }
  }

  /** 根据来源选择人设 */
  private getPersonaForSource(agent: AgentProfile, source: string): string {
    switch (source) {
      case 'work':
      case 'ide':
        return agent.workPersona
      case 'social':
      case 'group_chat':
        return agent.socialPersona
      default:
        return ''
    }
  }
}
