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
import type { ChatMessage, ToolCallRecord, ToolDefinition } from '../pipeline/types'
import type { ContentPart } from '../llm/types'
import type { ImageUnderstandingService } from '../attachment/imageUnderstandingService'
import type { ThreadService } from '../thread/threadService'
import { runReActLoop } from './reactLoop'
import type { CapabilityScope } from '../../capabilities/types'
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
  imageUnderstandingService?: ImageUnderstandingService
  threadService?: ThreadService
  /** 工具执行器（可选，无则跳过 ReAct） */
  toolExecutor?: ToolExecutor
  /** 按当前 Agent 与通道获取工具定义 */
  getToolDefinitions?: (
    agentId: string,
    channel: string,
    disabledTools?: string[],
    capabilityScope?: CapabilityScope,
  ) => ToolDefinition[]
  /** 取消检测器（RuntimeStateService） */
  cancelChecker?: CancelChecker
  /** Gateway 广播（finish_task 通知） */
  gatewayBroadcast?: (action: string, payload: Record<string, unknown>) => Promise<void>
  /** 主模型配置获取器（ModelRoleResolver.bind('main')） */
  getModelConfig: () => Promise<ModelConfig | null>
}

export interface CompiledRunParams {
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string | ContentPart[] | null
  }>
  agentId: string
  threadId: string
  channel?: string
  onRawText?: (rawText: string) => void
  onToolCalls?: (toolCalls: ToolCallRecord[]) => void
  signal?: AbortSignal
  taskId?: string
  onCheckpoint?: (checkpoint: {
    messages: ChatMessage[]
    toolCalls: ToolCallRecord[]
    turn: number
  }) => Promise<void>
  disabledTools?: string[]
  capabilityScope?: CapabilityScope
  pairId?: string
}

type CompiledRunResult = { toolCalls: ToolCallRecord[]; messages: ChatMessage[]; rawText: string }

interface CompiledRun {
  params: CompiledRunParams
  channel: string
  startedAt: number
  events: AsyncGenerator<ReActYield, CompiledRunResult>
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
   */
  async chatWithCompiledMessages(params: CompiledRunParams): Promise<string> {
    const run = await this.createCompiledRun(params)
    let text = ''
    let next = await run.events.next()

    while (!next.done) {
      if (typeof next.value === 'string') {
        text += next.value
      }
      next = await run.events.next()
    }

    await this.finalizeCompiledRun(run, next.value, text)
    return text
  }

  /**
   * 流式对话（使用 ContextCompiler 编译后的消息）
   *
   * 跳过 Ingress/Enrichment/PromptAssembly，直接用编译好的消息执行 ReAct Loop。
   * 持久化由调用方（chat.router）负责写入 Thread。
   */
  async *chatStreamWithCompiledMessages(params: CompiledRunParams): AsyncGenerator<ReActYield> {
    const run = await this.createCompiledRun(params)
    let text = ''
    let next = await run.events.next()

    while (!next.done) {
      if (typeof next.value === 'string') {
        text += next.value
      }
      yield next.value
      next = await run.events.next()
    }

    await this.finalizeCompiledRun(run, next.value, text)
  }

  // ─────────────────────────────────────────
  // 内部方法
  // ─────────────────────────────────────────

  /** 创建编译消息的统一 ReAct 运行。 */
  private async createCompiledRun(params: CompiledRunParams): Promise<CompiledRun> {
    const channel = params.channel ?? 'desktop'
    const startedAt = Date.now()
    logger.info(
      `开始对话(编译消息): agent=${params.agentId}, thread=${params.threadId}, channel=${channel}`,
    )

    const messages: ChatMessage[] = params.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))
    const modelConfig = await this.resolveModelConfig(params.agentId)
    this.ensureVisionSupport(messages, modelConfig)
    const tools = this.deps.getToolDefinitions?.(
      params.agentId,
      channel,
      params.disabledTools,
      params.capabilityScope,
    )

    const events = runReActLoop({
      llmService: this.deps.llmService,
      modelConfig,
      messages,
      tools,
      toolExecutor: this.deps.toolExecutor,
      source: channel,
      sessionId: params.threadId,
      agentId: params.agentId,
      threadContext: {
        threadId: params.threadId,
        channel,
        taskId: params.taskId,
        pairId: params.pairId,
        disabledTools: params.disabledTools,
        capabilityScope: params.capabilityScope,
      },
      cancelChecker: this.deps.cancelChecker,
      signal: params.signal,
      onCheckpoint: params.onCheckpoint,
      transcribeScreenshots: this.deps.imageUnderstandingService
        ? (dataUris) => this.transcribeScreenshots(dataUris)
        : undefined,
      onScreenshotTranscription: this.deps.threadService
        ? async (summary, modelId) => {
            await this.deps.threadService!.appendSystemMessage({
              threadId: params.threadId,
              content: `【屏幕截图内容转述】\n${summary}`,
              metadataJson: JSON.stringify({
                kind: 'image_transcription',
                source: 'screen_capture',
                mode: modelConfig.enableVision ? 'native' : 'relay',
                modelId,
              }),
            })
          }
        : undefined,
    })

    return { params, channel, startedAt, events }
  }

  /** 统一处理编译消息运行结束后的回调与通知。 */
  private async finalizeCompiledRun(
    run: CompiledRun,
    result: CompiledRunResult,
    text: string,
  ): Promise<void> {
    const { params, channel, startedAt } = run
    const rawText = result.rawText || text

    if (params.onRawText && rawText) {
      params.onRawText(rawText)
    }
    params.onToolCalls?.(result.toolCalls)

    this.deps.scorerService
      ?.checkAndProcess(params.agentId, params.threadId, channel)
      .catch((err) => {
        logger.warn('Scorer 触发失败', { error: err })
      })

    if (
      this.deps.gatewayBroadcast &&
      result.toolCalls.some((toolCall) => toolCall.name === 'finish_task')
    ) {
      this.deps.gatewayBroadcast('stream_end', { sessionId: params.threadId }).catch(() => {})
    }

    const elapsed = Date.now() - startedAt
    logger.info(
      `对话完成(编译消息): 回复 ${text.length} 字, 工具 ${result.toolCalls.length} 次, 耗时 ${elapsed}ms`,
    )
  }

  /** 将截图 data URI 交给专用视觉模型转述，不保存原始截图。 */
  private async transcribeScreenshots(
    dataUris: string[],
  ): Promise<{ summary: string; modelId: string } | null> {
    const images = dataUris.flatMap((dataUri) => {
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri)
      return match ? [{ mimeType: match[1]!, bytes: Buffer.from(match[2]!, 'base64') }] : []
    })
    return this.deps.imageUnderstandingService?.transcribe(images) ?? null
  }

  private ensureVisionSupport(messages: ChatMessage[], modelConfig: ModelConfig): void {
    const hasImage = messages.some(
      (message) =>
        Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'),
    )
    if (hasImage && !modelConfig.enableVision) {
      throw new AppError('BAD_REQUEST', {
        message: '当前主模型未启用视觉能力，无法发送图片附件；请启用 enableVision 或移除图片',
      })
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
