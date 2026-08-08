/**
 * Agent Service — 对话核心编排（AIOS 版）
 *
 * 新版架构下的职责：
 * - 接收 ContextCompiler 编译后的消息，执行 ReAct Loop
 * - 支持流式/非流式两种模式
 * - 持久化由调用方（chat.router）负责写入 Thread
 * - 触发 Scorer 攒批（异步，不阻塞回复）
 *
 * 旧版 5 阶段管道（Ingress → Enrichment → PromptAssembly → Synthesis → Egress）
 * 已废弃，由 ContextCompiler 统一负责上下文编译。
 *
 * @module packages/backend/src/services/agent/agentService
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ScorerService } from '../memory/scorerService'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { AgentManager } from './agentManager'
import type { ToolExecutor, CancelChecker, ReActYield } from './reactLoop'
import type {
  ChatMessage,
  ToolCallRecord,
  ToolDefinition,
} from '../pipeline/types'
import { runReActLoop } from './reactLoop'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'

const logger = createLogger('AgentService')

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface AgentServiceDeps {
  llmService: LlmService
  configRepo: ConfigRepository
  agentManager: AgentManager
  scorerService?: ScorerService
  /** 工具执行器（可选，无则跳过 ReAct） */
  toolExecutor?: ToolExecutor
  /** 工具定义获取（从 ToolRegistry） */
  getToolDefinitions?: (source: string) => ToolDefinition[]
  /** 取消检测器（RuntimeStateService） */
  cancelChecker?: CancelChecker
  /** Gateway 广播（finish_task 通知） */
  gatewayBroadcast?: (action: string, payload: Record<string, unknown>) => Promise<void>
  /** 主模型配置获取器（ModelRoleResolver.bind('main')） */
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
   * 非流式对话（使用 ContextCompiler 编译后的消息）
   *
   * 跳过 Ingress/Enrichment/PromptAssembly，直接用编译好的消息执行 ReAct Loop。
   * 持久化由调用方（chat.router）负责写入 Thread。
   *
   * @param messages  ContextCompiler 编译后的消息列表
   * @param agentId   Agent ID
   * @param threadId  Thread ID（用于取消检测和日志）
   */
  async chatWithCompiledMessages(params: {
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>
    agentId: string
    threadId: string
    /**
     * 第七阶段修复（批次 B2）：对话通道（desktop/companion/social/group）。
     * 原实现硬编码 'desktop'，导致非 desktop 通道拿到桌面工具集与桌面轮次上限。
     * 未传时仍默认 desktop，向后兼容。
     */
    channel?: string
  }): Promise<string> {
    const { messages, agentId, threadId, channel = 'desktop' } = params
    const startMs = Date.now()
    logger.info(`开始对话(编译消息): agent=${agentId}, thread=${threadId}, channel=${channel}`)

    // 转换为 ChatMessage 格式
    const llmMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // 获取模型配置
    const modelConfig = await this.resolveModelConfig(agentId)

    // 执行 ReAct Loop
    // 第七阶段修复（批次 B1/B2）：透传 channel 与 agentId/threadId，
    // 让工具集过滤、轮次上限、工具权限校验都按真实通道与 Agent 身份生效
    const { text, toolCalls, rawText } = await this.runChat(llmMessages, modelConfig, channel, {
      agentId,
      threadId,
      channel,
    })

    // 触发 Scorer（异步，不阻塞回复）
    // TODO: 后续改为基于 Thread 的 Scorer 触发
    this.deps.scorerService?.processBatch(agentId).catch((err) => {
      logger.warn('Scorer 触发失败', { error: err })
    })

    const elapsed = Date.now() - startMs
    logger.info(
      `对话完成(编译消息): 回复 ${text.length} 字, 工具 ${toolCalls.length} 次, 耗时 ${elapsed}ms`,
    )

    // 保留 rawText 引用避免 lint 警告（后续 Scorer 可能需要）
    void rawText

    return text
  }

  /**
   * 流式对话（使用 ContextCompiler 编译后的消息）
   *
   * 跳过 Ingress/Enrichment/PromptAssembly，直接用编译好的消息执行 ReAct Loop。
   * 持久化由调用方（chat.router）负责写入 Thread。
   *
   * @param messages  ContextCompiler 编译后的消息列表
   * @param agentId   Agent ID
   * @param threadId  Thread ID（用于取消检测和日志）
   */
  async *chatStreamWithCompiledMessages(params: {
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>
    agentId: string
    threadId: string
    /**
     * AIOS: 对话通道（desktop/companion/social/group）。
     * 未传时默认 desktop，向后兼容。
     */
    channel?: string
    /**
     * 原始转写回调：循环结束后回调，传入含 Thinking/Monologue/NIT 等调试块的完整原始文本。
     * 调用方（如 startup.ts）可借此把 rawContent 写入 Thread 消息，供「对话调试详情」查看。
     */
    onRawText?: (rawText: string) => void
  }): AsyncGenerator<ReActYield> {
    const { messages, agentId, threadId, channel = 'desktop', onRawText } = params
    const startMs = Date.now()
    logger.info(`开始流式对话(编译消息): agent=${agentId}, thread=${threadId}, channel=${channel}`)

    // 转换为 ChatMessage 格式
    const llmMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    // AIOS: 按 channel 获取工具定义（CapabilityGate 过滤）
    const tools = this.deps.getToolDefinitions?.(channel)
    const modelConfig = await this.resolveModelConfig(agentId)

    // 执行 ReAct Loop（流式）
    const reactGen = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages: llmMessages,
      tools,
      toolExecutor: this.deps.toolExecutor,
      source: channel,
      sessionId: threadId,
      // 第七阶段修复（批次 B1）：透传 agentId 供工具权限校验
      agentId,
      // AIOS: 透传 Thread 上下文给工具执行器
      threadContext: { threadId, channel },
      cancelChecker: this.deps.cancelChecker,
    })

    let fullText = ''
    let result = await reactGen.next()
    while (!result.done) {
      const chunk = result.value
      if (typeof chunk === 'string') {
        fullText += chunk
      }
      yield chunk
      result = await reactGen.next()
    }
    // ReAct 循环返回值含 rawText（含 Thinking 块的完整原始转写），供调试视图查看
    const { toolCalls, rawText } = result.value ?? { toolCalls: [], rawText: '' }

    // 通过回调把原始转写传给调用方（如 startup.ts 写入 Thread rawContent）
    if (onRawText && rawText) {
      onRawText(rawText)
    }

    // 触发 Scorer（异步）
    this.deps.scorerService?.processBatch(agentId).catch((err) => {
      logger.warn('Scorer 触发失败', { error: err })
    })

    // finish_task 广播
    if (this.deps.gatewayBroadcast && toolCalls.some((tc) => tc.name === 'finish_task')) {
      this.deps.gatewayBroadcast('stream_end', { sessionId: threadId }).catch(() => {})
    }

    const elapsed = Date.now() - startMs
    logger.info(
      `流式对话完成(编译消息): ${fullText.length} 字, 工具 ${toolCalls.length} 次, 耗时 ${elapsed}ms`,
    )
  }

  // ─────────────────────────────────────────
  // 旧版兼容方法（deprecated）
  // ─────────────────────────────────────────

  /**
   * 旧版非流式对话（兼容层）
   *
   * @deprecated 请使用 chatWithCompiledMessages() + ContextCompiler 替代。
   * 此方法仅保留供 socialBridge/stronghold/realtimeSession/companion 等旧代码过渡使用。
   * 内部直接用传入的 messages 调用 LLM，不走 5 阶段管道。
   */
  async chat(request: {
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>
    agentId: string
    source?: string
    sessionId?: string
    isVoiceMode?: boolean
  }): Promise<string> {
    // 第七阶段修复（批次 B2）：必须取出并使用 source
    // 原实现解构时丢掉 source 并硬编码 'desktop'，导致：
    // - socialBridge 传 source:'social' 被忽略 → 社交场景拿到完整桌面工具集（含 terminal_execute）
    // - stronghold 传 source:'group_chat' 被忽略 → 群聊同样越权
    // - MODE_MAX_TURNS 按 desktop 的 30 轮执行，而社交本应只有 2 轮
    const { messages, agentId, sessionId, source = 'desktop' } = request
    logger.warn(
      `旧版 chat() 调用（兼容层）: agent=${agentId}, session=${sessionId}, source=${source}. ` +
        '请迁移到 chatWithCompiledMessages()。',
    )

    const llmMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const modelConfig = await this.resolveModelConfig(agentId)
    const { text } = await this.runChat(llmMessages, modelConfig, source, {
      agentId,
      threadId: sessionId,
      channel: source,
    })
    return text
  }

  /**
   * 旧版流式对话（兼容层）
   *
   * @deprecated 请使用 chatStreamWithCompiledMessages() + ContextCompiler 替代。
   * 此方法仅保留供 startup.ts 等旧代码过渡使用。
   */
  async *chatStream(request: {
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>
    agentId: string
    source?: string
    sessionId?: string
  }): AsyncGenerator<ReActYield> {
    // 第七阶段修复（批次 B2）：同 chat()，必须使用传入的 source 而非硬编码 desktop
    const { messages, agentId, sessionId, source = 'desktop' } = request
    logger.warn(
      `旧版 chatStream() 调用（兼容层）: agent=${agentId}, session=${sessionId}, source=${source}. ` +
        '请迁移到 chatStreamWithCompiledMessages()。',
    )

    const llmMessages: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    const tools = this.deps.getToolDefinitions?.(source)
    const modelConfig = await this.resolveModelConfig(agentId)

    const reactGen = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages: llmMessages,
      tools,
      toolExecutor: this.deps.toolExecutor,
      source,
      sessionId: sessionId ?? 'legacy',
      // 第七阶段修复（批次 B1）：透传 agentId 与通道，供工具权限校验
      agentId,
      threadContext: { threadId: sessionId ?? 'legacy', channel: source },
      cancelChecker: this.deps.cancelChecker,
    })

    let result = await reactGen.next()
    while (!result.done) {
      yield result.value
      result = await reactGen.next()
    }
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /**
   * 非流式 ReAct 执行
   *
   * 第七阶段修复（批次 B1/B2）：新增 runtimeContext 参数。
   * 原实现不透传 agentId/threadId，导致 ToolExecutor 无法拿到正确的 Agent 身份，
   * 工具权限校验退回硬编码兜底值。
   */
  private async runChat(
    messages: ChatMessage[],
    modelConfig: ModelConfig,
    source: string,
    runtimeContext?: { agentId?: string; threadId?: string; channel?: string },
  ): Promise<{ text: string; toolCalls: ToolCallRecord[]; rawText: string }> {
    const gen = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages,
      tools: this.deps.getToolDefinitions?.(source),
      toolExecutor: this.deps.toolExecutor,
      source,
      sessionId: runtimeContext?.threadId,
      agentId: runtimeContext?.agentId,
      threadContext: runtimeContext?.threadId
        ? { threadId: runtimeContext.threadId, channel: runtimeContext.channel ?? source }
        : undefined,
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
    // rawText 为完整原始转写（含 Thinking 块），供持久化为 assistantRawContent；
    // 兜底回退到可见文本 text，避免历史 provider 未返回 rawText 时丢失原文。
    return {
      text,
      toolCalls: result.value?.toolCalls ?? [],
      rawText: result.value?.rawText || text,
    }
  }

  /**
   * 解析 LLM 模型配置
   *
   * 统一使用 ModelRoleResolver（和 DiaryEngine/ScorerService 等保持一致）。
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
}
