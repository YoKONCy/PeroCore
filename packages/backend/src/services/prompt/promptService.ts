/**
 * Prompt Service — 系统提示词组装
 *
 * 混合模式：
 * - **对话模式**: 使用 SillyTavern 风格的槽位拼接 (buildPromptMessages)
 * - **后台任务**: 使用单模板渲染 (renderTemplate)
 *
 * @module packages/backend/src/services/prompt/promptService
 */

import type { MdpEngine, PromptSlot, PromptPreset, RenderedMessage } from './mdpEngine'
import type { PresetLoader } from './presetLoader'
import type { AgentManager, AgentProfile } from '../agent/agentManager'
import type { EnrichedContext } from '../pipeline/types'
import { AppError } from '../../lib/appError'

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
    private presetLoader: PresetLoader,
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
      throw new AppError('CONFIG_ERROR', {
        message: `Agent ${agentId} 未找到，无法组装提示词`,
      })
    }

    // 1. 构建默认槽位
    let slots = this.mdp.buildDefaultSlots(agentId)

    // 2. 应用内置模式 Preset (根据 source 自动选择)
    const builtinPreset = this.presetLoader.getPresetForSource(source)
    if (builtinPreset) {
      slots = this.mdp.applyPreset(slots, builtinPreset)
    }

    // 3. 应用用户自定义 Preset (优先级最高)
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
      throw new AppError('CONFIG_ERROR', {
        message: `Agent ${agentId} 未找到，无法组装提示词`,
      })
    }

    // 构建模板变量字典
    const vars = this.buildVars(agent, source, enriched, extraVars)

    // 检查是否有内置 Preset (社交/工作/群聊/轻量模式)
    const builtinPreset = this.presetLoader.getPresetForSource(source)
    if (builtinPreset) {
      // 有 Preset: 使用槽位拼接模式
      let slots = this.mdp.buildDefaultSlots(agentId)
      slots = this.mdp.applyPreset(slots, builtinPreset)
      const messages = this.mdp.renderSlots(slots, vars, {
        mergeAdjacentRoles: true,
        skipEmpty: true,
      })
      const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
      return {
        systemPrompt: systemParts.join('\n\n'),
        footer: '',
      }
    }

    // 默认桌面模式: 单模板渲染
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

      // 环境
      environment_info: enriched.environmentInfo,

      // 来源
      source,

      // 模式特定人设
      work_persona: agent.workPersona,
      social_persona: agent.socialPersona,

      // 社交上下文
      social_context: enriched.socialContext,

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
