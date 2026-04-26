/**
 * Agent Service — 对话核心编排
 *
 * 整个系统的主编排器，串联 5 阶段管道：
 * Ingress → Enrichment → PromptAssembly → Synthesis → Egress
 *
 * 主要改进:
 * - Profile 门控
 * - Synthesis 独立 LLM 层 (替代 runReActLoop)
 * - ConfigRepo 模型解析 (替代硬编码 env)
 * - EgressService 自动触发 Scorer 攒批
 *
 * @module packages/backend/src/services/agent/agentService
 */

import type { PromptService } from '../prompt/promptService'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ScorerService } from '../memory/scorerService'
import type { ConversationLogService } from '../memory/conversationLog'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { AgentManager } from './agentManager'
import type { ToolExecutor, CancelChecker, ReActYield } from './reactLoop'
import type {
  ChatRequest,
  ChatMessage,
  Enricher,
  ToolCallRecord,
  ToolDefinition,
} from '../pipeline/types'
import type { DesktopProfile } from '../session/sessionService'
import type { CapabilityGate } from '../../capabilities/capabilityGate'
import { runIngress } from '../pipeline/ingress'
import { runEgress } from '../pipeline/egress'
import { runEnrichment } from '../pipeline/enrichers/enrichmentRunner'
import { runReActLoop } from './reactLoop'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'

const logger = createLogger('AgentService')

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface AgentServiceDeps {
  promptService: PromptService
  llmService: LlmService
  logService: ConversationLogService
  configRepo: ConfigRepository
  agentManager: AgentManager
  scorerService?: ScorerService
  /** 注册的 Enricher 列表 (并行执行) */
  enrichers: Enricher[]
  /** 工具执行器 (可选，无则跳过 ReAct) */
  toolExecutor?: ToolExecutor
  /** 工具定义获取 (从 ToolRegistry) */
  getToolDefinitions?: (source: string) => ToolDefinition[]
  /** 能力门控 (工具描述 + 技能菜单注入 System Prompt) */
  capabilityGate?: CapabilityGate
  /** 取消检测器 (TaskManager) */
  cancelChecker?: CancelChecker
  /** Gateway 广播 (finish_task 通知) */
  gatewayBroadcast?: (action: string, payload: Record<string, unknown>) => Promise<void>
  /** 主模型配置获取器 (ModelRoleResolver.bind('main')) */
  getModelConfig: () => Promise<ModelConfig | null>
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class AgentService {
  private deps: AgentServiceDeps

  constructor(deps: AgentServiceDeps) {
    this.deps = deps
  }

  /**
   * 主对话入口 (非流式)
   *
   * 完整 5 阶段管道：
   * 1. Ingress: 提取用户文本
   * 2. Enrichment: 并行注入记忆/历史/配置 (受 Profile 门控)
   * 3. PromptAssembly: 组装 System Prompt
   * 4. Synthesis / ReActLoop: LLM + 工具调用
   * 5. Egress: 后处理 + 持久化 + Scorer 攒批
   */
  async chat(request: ChatRequest): Promise<string> {
    const { agentId, source, sessionId, messages } = request
    const startMs = Date.now()
    logger.info(`开始对话: agent=${agentId}, source=${source}, session=${sessionId}`)

    // 获取当前 Profile (决定 Enricher 门控)
    const profile = await this.resolveProfile(agentId)

    // ── Phase 1: Ingress ──
    const ingress = runIngress(messages, source)
    if (!ingress.userText) {
      logger.warn('Ingress: 未提取到用户文本')
      return ''
    }
    logger.debug(`Ingress: "${ingress.userText.slice(0, 50)}..."`)

    // ── Phase 2: Enrichment (并行, 受 Profile 门控) ──
    const activeEnrichers = this.filterEnrichersByProfile(this.deps.enrichers, profile)
    const enriched = await runEnrichment(activeEnrichers, {
      userText: ingress.userText,
      agentId,
      source,
      sessionId,
    })

    // ── Phase 3: Prompt Assembly (含 CapabilityGate 能力注入) ──
    const capabilityVars = this.resolveCapabilityVars(agentId, source, sessionId)
    const mergedExtraVars = { ...capabilityVars, ...request.extraVars }
    const { systemPrompt, footer } = this.deps.promptService.assemble(
      agentId,
      source,
      enriched,
      mergedExtraVars,
    )
    const llmMessages = this.assembleLlmMessages(systemPrompt, messages, footer)

    // ── Phase 4: ReAct Loop ──
    const modelConfig = await this.resolveModelConfig(agentId)
    const { text, toolCalls } = await this.runChat(llmMessages, modelConfig, source)

    // ── Phase 5: Egress ──
    const egress = runEgress({
      rawReply: text,
      toolCalls,
      request,
    })

    // 异步持久化 + Scorer 攒批
    this.persistAndScore(request, ingress.userText, egress.reply, text).catch((err) => {
      logger.warn('持久化失败', { error: err })
    })

    const elapsed = Date.now() - startMs
    logger.info(
      `对话完成: 回复 ${egress.reply.length} 字, 工具 ${toolCalls.length} 次, ` +
        `耗时 ${elapsed}ms, profile=${profile}`,
    )
    return egress.reply
  }

  /**
   * 流式对话入口 (SSE)
   *
   * 同样走 5 阶段，但 Phase 4 流式输出。
   * B6-2: yield 类型升级为 ReActYield (string | SseEvent)
   */
  async *chatStream(request: ChatRequest): AsyncGenerator<ReActYield> {
    const { agentId, source, sessionId, messages } = request
    const startMs = Date.now()
    logger.info(`开始流式对话: agent=${agentId}, source=${source}, session=${sessionId}`)

    const profile = await this.resolveProfile(agentId)

    // Phase 1: Ingress
    const ingress = runIngress(messages, source)
    if (!ingress.userText) {
      yield ''
      return
    }

    // Phase 2: Enrichment (受 Profile 门控)
    const activeEnrichers = this.filterEnrichersByProfile(this.deps.enrichers, profile)
    const enriched = await runEnrichment(activeEnrichers, {
      userText: ingress.userText,
      agentId,
      source,
      sessionId,
    })

    // Phase 3: Prompt Assembly (含 CapabilityGate 能力注入)
    const capabilityVars = this.resolveCapabilityVars(agentId, source, sessionId)
    const mergedExtraVars = { ...capabilityVars, ...request.extraVars }
    const { systemPrompt, footer } = this.deps.promptService.assemble(
      agentId,
      source,
      enriched,
      mergedExtraVars,
    )
    const llmMessages = this.assembleLlmMessages(systemPrompt, messages, footer)

    // Phase 4: ReAct Loop (流式)
    // B6-2: 从 ToolRegistry 获取可用工具定义
    const tools = this.deps.getToolDefinitions?.(source)
    const modelConfig = await this.resolveModelConfig(agentId)
    const reactGen = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages: llmMessages,
      tools,
      toolExecutor: this.deps.toolExecutor,
      source,
      sessionId,
      cancelChecker: this.deps.cancelChecker,
    })

    let fullText = ''
    let result = await reactGen.next()
    while (!result.done) {
      const chunk = result.value
      // 只计入文本内容
      if (typeof chunk === 'string') {
        fullText += chunk
      }
      yield chunk
      result = await reactGen.next()
    }
    const toolCalls = result.value ?? []

    // Phase 5: Egress (异步)
    this.persistAndScore(request, ingress.userText, fullText, fullText).catch((err) => {
      logger.warn('持久化失败', { error: err })
    })

    // B6-2: finish_task 广播 Gateway
    if (this.deps.gatewayBroadcast && toolCalls.some((tc) => tc.name === 'finish_task')) {
      this.deps.gatewayBroadcast('stream_end', { sessionId }).catch(() => {})
    }

    const elapsed = Date.now() - startMs
    logger.info(
      `流式对话完成: ${fullText.length} 字, 工具 ${toolCalls.length} 次, ` +
        `耗时 ${elapsed}ms, profile=${profile}`,
    )
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /** 非流式 ReAct 执行 */
  private async runChat(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    source: string,
  ): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
    const gen = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages,
      tools: this.deps.getToolDefinitions?.(source),
      toolExecutor: this.deps.toolExecutor,
      source,
      cancelChecker: this.deps.cancelChecker,
    })

    let text = ''
    let result = await gen.next()
    while (!result.done) {
      if (typeof result.value === 'string') {
        text += result.value
      }
      result = await gen.next()
    }
    return { text, toolCalls: result.value ?? [] }
  }

  /** 组装 LLM 消息列表 */
  private assembleLlmMessages(
    systemPrompt: string,
    userMessages: ChatMessage[],
    footer: string,
  ): ChatMessage[] {
    const result: ChatMessage[] = [{ role: 'system', content: systemPrompt }]

    // 添加用户消息 (排除已有的 system 消息)
    for (const msg of userMessages) {
      if (msg.role === 'system') continue
      result.push(msg)
    }

    // 如果有 footer，注入到最后一条 user 消息之前
    if (footer) {
      let lastUserIdx = -1
      for (let i = result.length - 1; i >= 0; i--) {
        if (result[i]?.role === 'user') {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx >= 0) {
        result.splice(lastUserIdx, 0, { role: 'system', content: footer })
      }
    }

    return result
  }

  /**
   * 从 CapabilityGate 解析工具描述 + 技能菜单变量
   *
   * 注入到模板变量中，填充 300_tools.md 的 {{ tools_description }} 和 {{ skill_menu }}。
   */
  private resolveCapabilityVars(
    agentId: string,
    source: string,
    sessionId?: string,
  ): Record<string, string> {
    if (!this.deps.capabilityGate) {
      return {}
    }

    const resolved = this.deps.capabilityGate.resolve(agentId, source, sessionId)
    return {
      tools_description: resolved.toolsDescription,
      skill_menu: resolved.skillMenuText,
    }
  }

  /**
   * 解析 Profile
   *
   * 优先级: ConfigRepo > 默认
   */
  private async resolveProfile(agentId: string): Promise<DesktopProfile> {
    const stored = await this.deps.configRepo.get(`session.${agentId}.profile`)
    return (stored as DesktopProfile) ?? 'default'
  }

  /**
   * Profile 门控 — 过滤 Enricher
   *
   * - default: 全部启用
   * - lightweight: 跳过 MemoryEnricher、ToolEnricher (省 Token)
   * - companion: 全部启用
   * - work: 全部启用
   */
  private filterEnrichersByProfile(enrichers: Enricher[], profile: DesktopProfile): Enricher[] {
    if (profile === 'lightweight') {
      return enrichers.filter((e) => {
        const name = e.name.toLowerCase()
        return !name.includes('memory') && !name.includes('tool')
      })
    }
    return enrichers
  }

  /**
   * 解析 LLM 模型配置
   *
   * 统一使用 ModelRoleResolver (和 DiaryEngine/ScorerService 等保持一致)。
   * 回退链: ModelRoleResolver(DB) → 环境变量兜底
   */
  private async resolveModelConfig(_agentId: string): Promise<ModelConfig> {
    // 通过 ModelRoleResolver 获取主模型配置
    const config = await this.deps.getModelConfig()
    if (config) return config

    // 环境变量兜底
    const envApiKey = process.env.PERO_LLM_API_KEY
    const envModel = process.env.PERO_LLM_MODEL
    if (!envApiKey || !envModel) {
      throw new AppError('CONFIG_ERROR', {
        message:
          'LLM 未配置: 请在 Dashboard 模型配置中设置主模型，或设置环境变量 PERO_LLM_API_KEY / PERO_LLM_MODEL',
      })
    }

    return {
      provider: process.env.PERO_LLM_PROVIDER ?? 'openai',
      modelId: envModel,
      apiKey: envApiKey,
      apiBase: process.env.PERO_LLM_API_BASE,
    }
  }

  /**
   * 异步持久化 + Scorer 攒批
   */
  private async persistAndScore(
    request: ChatRequest,
    userText: string,
    reply: string,
    rawReply?: string,
  ): Promise<void> {
    const { agentId, source, sessionId } = request

    // 保存对话日志 (rawReply 保留原始 LLM 输出，含 Thinking/Monologue 块)
    await this.deps.logService.savePair({
      sessionId,
      source,
      agentId,
      userContent: userText,
      assistantContent: reply,
      assistantRawContent: rawReply,
    })

    // 触发 Scorer 攒批
    if (this.deps.scorerService) {
      try {
        await this.deps.scorerService.checkAndProcess(agentId)
      } catch (err) {
        logger.warn(`Scorer 攒批触发失败: ${err}`)
      }
    }
  }
}
