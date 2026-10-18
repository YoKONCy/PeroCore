/**
 * LLM Service — 统一 LLM 调用门面
 *
 * 通过 Provider 模式支持 OpenAI / Gemini / Anthropic 三大协议。
 * 大多数厂商走 OpenAI 兼容协议。
 *
 * 功能：
 * - Provider 工厂 (按 provider 类型分发)
 * - 非流式 chat / 流式 chatStream
 * - 自动重试 (429 限流 / 5xx 临时故障)
 * - Token 用量追踪
 * - 统一 AppError 错误处理
 *
 * @module packages/backend/src/services/llm/llmService
 */

import { performanceLatencySeconds } from '../../lib/metrics'
import { prepareBuiltinTask } from '../prompt/taskPrompts'
import { canonicalTools, promptFingerprint } from './promptCache'
import type {
  LlmProvider,
  ChatMessage,
  ChatOptions,
  ChatCompletion,
  ChatDelta,
  UsageInfo,
  ReasoningEffort,
  LlmWireApi,
  ReasoningDialect,
} from './types'
import { OpenAiProvider } from './providers/openaiProvider'
import { OpenAiResponsesProvider } from './providers/openaiResponsesProvider'
import { GeminiProvider } from './providers/geminiProvider'
import { AnthropicProvider } from './providers/anthropicProvider'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'
import { finishLlmSpan, startLlmSpan } from '../../lib/telemetry'
import {
  consumeCurrentKernelExecution,
  currentKernelExecution,
} from '../../kernel/executionContext'
import { randomUUID } from 'node:crypto'
import type { TokenUsagePurpose } from '@infos/shared'
import type { LlmUsageAttempt } from './usage'
import { estimateInputPayloadTokens } from './inputTokens'
import { retryableLlmError, retryDelay, retryLimit, retryScope, waitForRetry } from './retryPolicy'
import type { ModelRetryInfo } from '@infos/shared'

const logger = createLogger('LlmService')

// ─────────────────────────────────────────────
// 默认 API 基址预设 (继承 v1)
// ─────────────────────────────────────────────

export const DEFAULT_API_BASES: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  groq: 'https://api.groq.com/openai/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  mistral: 'https://api.mistral.ai/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  xai: 'https://api.x.ai/v1',
  stepfun: 'https://api.stepfun.com/v1',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  ollama: 'http://localhost:11434/v1',
}

// ─────────────────────────────────────────────
// 模型配置
// ─────────────────────────────────────────────

export interface ModelConfig {
  /** 本地统计归属，不参与 Provider 协议。 */
  usagePurpose?: TokenUsagePurpose
  usageAgentId?: string
  /** Provider 类型 */
  provider: string
  /** 模型 ID */
  modelId: string
  /** API Key */
  apiKey: string
  /** API 基址 (为空时使用 provider 对应的默认值) */
  apiBase?: string
  /** 温度 */
  temperature?: number
  /** Top P */
  topP?: number
  /** 最大输出 token 数 */
  maxTokens?: number
  /** 桌面 ReAct 最大轮次，仅控制本地执行，不发送给 Provider。 */
  maxReActTurns?: number
  /** 模型完整上下文窗口，不等同于最大输出 token 数。 */
  contextWindowTokens?: number
  /** 推理强度；未配置时不向 Provider 发送 */
  reasoningEffort?: ReasoningEffort
  /** 是否请求并展示Provider原生思考摘要。 */
  returnNativeReasoning?: boolean
  wireApi?: LlmWireApi
  reasoningDialect?: ReasoningDialect
  /** 是否使用Provider流式接口；默认启用 */
  stream?: boolean
  /** 是否启用视觉能力 (多模态) */
  enableVision?: boolean
  /** 是否声明支持原生音频输入（不代表 Provider 已接入协议） */
  enableAudioInput?: boolean
}

// ─────────────────────────────────────────────
// 重试配置
// ─────────────────────────────────────────────

interface RetryConfig {
  /** 最大重试次数 (不含首次) */
  maxRetries: number
}

/** 默认重试配置 */
const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
}

// ─────────────────────────────────────────────
// Token 用量追踪
// ─────────────────────────────────────────────

/** 累计 Token 用量 (进程级) */
interface CumulativeUsage {
  totalPromptTokens: number
  totalCompletionTokens: number
  totalRequests: number
}

// ─────────────────────────────────────────────
// LlmService 类
// ─────────────────────────────────────────────

export class LlmService {
  private promptPreparer?: (messages: ChatMessage[], opts: ChatOptions) => ChatMessage[]

  setPromptPreparer(prepare: (messages: ChatMessage[], opts: ChatOptions) => ChatMessage[]): void {
    this.promptPreparer = prepare
  }

  /** 预算计算和真实请求共用已渲染消息；调用者可固定重试期间的提示词版本。 */
  preparePromptMessages(messages: ChatMessage[], opts: ChatOptions): ChatMessage[] {
    return this.promptPreparer?.(messages, opts) ?? prepareBuiltinTask(messages, opts)
  }
  constructor(private readonly recordAttempt?: (attempt: LlmUsageAttempt) => void) {}
  /** 进程级 Token 用量累计 */
  private usage: CumulativeUsage = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalRequests: 0,
  }

  /**
   * 创建 Provider 实例
   *
   * 根据 provider 名称分发到对应的协议实现。
   * 大多数厂商 (DeepSeek / SiliconFlow / 火山 / Groq 等) 走 OpenAI 兼容协议。
   */
  createProvider(config: ModelConfig): LlmProvider {
    // 解析基址：优先使用用户配置，否则使用 provider 默认值
    const apiBase = this.resolveApiBase(config.provider, config.apiBase)

    switch (config.provider) {
      case 'gemini':
        return new GeminiProvider({
          apiKey: config.apiKey,
          apiBase,
          modelId: config.modelId,
        })

      case 'claude':
      case 'anthropic':
        return new AnthropicProvider({
          apiKey: config.apiKey,
          apiBase,
          modelId: config.modelId,
          maxTokens: config.maxTokens,
        })

      default:
        if (config.wireApi === 'responses') {
          return new OpenAiResponsesProvider({
            apiKey: config.apiKey,
            apiBase,
            modelId: config.modelId,
            wireApi: config.wireApi,
            reasoningDialect: config.reasoningDialect,
          })
        }
        // 所有 OpenAI 兼容的厂商统一走Chat Completions协议
        return new OpenAiProvider({
          apiKey: config.apiKey,
          apiBase,
          modelId: config.modelId,
          wireApi: config.wireApi,
          reasoningDialect: config.reasoningDialect,
        })
    }
  }

  /** 与真实 Provider 共用请求序列化；内部审计字段和重复思考不进入输入预算。 */
  estimateInputTokens(config: ModelConfig, messages: ChatMessage[], opts?: ChatOptions): number {
    messages = this.preparePromptMessages(messages, opts ?? {})
    const provider = this.createProvider(config)
    return estimateInputPayloadTokens(
      provider.getInputTokenPayload(messages, this.mergeOpts(config, opts)),
    )
  }

  /**
   * 非流式 LLM 调用 (带自动重试)
   *
   * 适用于 Scorer / Reflection 等后台任务。
   * 429/超时自动重试，最多 2 次。
   */
  async chat(
    config: ModelConfig,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<ChatCompletion> {
    opts?.signal?.throwIfAborted()
    messages = this.preparePromptMessages(messages, opts ?? {})
    consumeCurrentKernelExecution({ llmCalls: 1 })
    const startTime = Date.now()
    const finalOpts = this.mergeOpts(config, opts)
    const scope = retryScope(
      opts?.signal,
      Math.max(opts?.timeout ?? 600_000, opts?.totalTimeout ?? 1_800_000),
    )
    finalOpts.signal = scope.signal
    const span = startLlmSpan({ config, messages, options: finalOpts, streaming: false })

    try {
      const result = await this.withRetry(
        async () => {
          const startedAt = Date.now()
          let result: ChatCompletion | undefined
          let status: LlmUsageAttempt['status'] = 'failed'
          try {
            const provider = this.createProvider(config)
            result = await provider.chat(messages, finalOpts)
            status = 'completed'
            return result
          } finally {
            this.recordCall(
              config,
              finalOpts,
              startedAt,
              result?.usage,
              status === 'failed' && finalOpts.signal?.aborted ? 'cancelled' : status,
              messages,
            )
          }
        },
        config,
        { ...DEFAULT_RETRY, maxRetries: retryLimit(opts?.maxRetries, 2) },
        scope.signal,
        opts?.onRetry,
      )

      // 追踪 Token 用量
      this.trackUsage(result.usage)
      this.consumeKernelTokens(result.usage)

      const durationMs = Date.now() - startTime
      performanceLatencySeconds.observe(
        { metric: 'llm_provider_total', provider: config.provider },
        durationMs / 1000,
      )
      logger.debug(`LLM chat 完成`, {
        model: config.modelId,
        durationMs,
        promptTokens: result.usage?.promptTokens,
        completionTokens: result.usage?.completionTokens,
      })
      finishLlmSpan(span, {
        usage: result.usage,
        finishReason: result.choices[0]?.finishReason,
        output: result.choices[0]?.message.content ?? '',
      })
      return result
    } catch (error) {
      finishLlmSpan(span, { error })
      throw error
    } finally {
      scope.dispose()
    }
  }

  /**
   * 流式 LLM 调用
   *
   * 临时故障有限退避重试；只有能清理草稿的 ReAct 调用方允许重放中断响应。
   * 使用方: for await (const delta of llmService.chatStream(...)) { ... }
   */
  async *chatStream(
    config: ModelConfig,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncIterable<ChatDelta> {
    messages = this.preparePromptMessages(messages, opts ?? {})
    const startTime = Date.now()
    const finalOpts = this.mergeOpts(config, opts)
    const scope = retryScope(
      opts?.signal,
      Math.max(opts?.timeout ?? 600_000, opts?.totalTimeout ?? 1_800_000),
    )
    finalOpts.signal = scope.signal
    const maxRetries = retryLimit(opts?.maxRetries, 2)
    const span = startLlmSpan({ config, messages, options: finalOpts, streaming: true })

    let lastUsage: UsageInfo | undefined
    let visibleDeltaProduced = false
    let output = ''
    let finishReason: string | null | undefined
    let firstTokenMs: number | undefined
    let streamError: unknown
    let recovery: ModelRetryInfo | undefined

    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        scope.signal.throwIfAborted()
        const attemptStartedAt = Date.now()
        let attemptStatus: LlmUsageAttempt['status'] = 'interrupted'
        let responseDeltaProduced = false
        let completed = false
        lastUsage = undefined
        finishReason = undefined
        output = ''
        try {
          consumeCurrentKernelExecution({ llmCalls: 1 })
          if (recovery) {
            recovery = { ...recovery, state: 'retrying', updatedAt: Date.now() }
            yield { choices: [], retry: recovery }
          }
          const provider = this.createProvider(config)
          for await (const delta of provider.chatStream(messages, finalOpts)) {
            scope.signal.throwIfAborted()
            if (delta.usage) lastUsage = delta.usage
            if (
              delta.choices.some(
                ({ delta: part }) =>
                  part.content ||
                  part.reasoningContent ||
                  part.nativeReasoning?.length ||
                  part.toolCalls?.length,
              )
            ) {
              responseDeltaProduced = true
              if (recovery && ['waiting', 'retrying'].includes(recovery.state)) {
                recovery = { ...recovery, state: 'recovered', updatedAt: Date.now() }
                yield { choices: [], retry: recovery }
              }
            }
            const content = delta.choices.map((choice) => choice.delta.content ?? '').join('')
            if (content) {
              if (!visibleDeltaProduced) {
                firstTokenMs = Date.now() - startTime
                performanceLatencySeconds.observe(
                  { metric: 'llm_first_token', provider: config.provider },
                  firstTokenMs / 1000,
                )
              }
              visibleDeltaProduced = true
              output += content
            }
            finishReason =
              delta.choices.find((choice) => choice.finishReason)?.finishReason ?? finishReason
            if (finishReason) completed = true
            yield delta
          }
          if (!completed)
            throw new AppError('LLM_ERROR', {
              message: '上游连接已结束，但未收到模型完成标记',
              data: { retryable: true },
            })
          if (recovery && ['waiting', 'retrying'].includes(recovery.state)) {
            recovery = { ...recovery, state: 'recovered', updatedAt: Date.now() }
            yield { choices: [], retry: recovery }
          }
          attemptStatus = 'completed'
          break
        } catch (err) {
          attemptStatus = finalOpts.signal?.aborted ? 'cancelled' : 'failed'
          scope.signal.throwIfAborted()
          if (
            retryableLlmError(err) &&
            attempt < maxRetries &&
            (!responseDeltaProduced || opts?.retryPartialResponse)
          ) {
            if (recovery)
              yield { choices: [], retry: { ...recovery, state: 'failed', updatedAt: Date.now() } }
            const now = Date.now()
            const delayMs = retryDelay(err, attempt)
            recovery = {
              retryId: randomUUID(),
              state: 'waiting',
              attempt: attempt + 1,
              maxRetries,
              delayMs,
              reason: err instanceof Error ? err.message.slice(0, 300) : '上游连接异常',
              startedAt: now,
              updatedAt: now,
              partialResponse: responseDeltaProduced,
            }
            logger.warn('模型请求异常，准备重试', {
              model: config.modelId,
              attempt: attempt + 1,
              maxRetries,
              delayMs,
            })
            yield { choices: [], retry: recovery }
            await waitForRetry(delayMs, scope.signal)
            continue
          }
          throw err
        } finally {
          this.trackUsage(lastUsage)
          this.consumeKernelTokens(lastUsage)
          this.recordCall(
            config,
            finalOpts,
            attemptStartedAt,
            lastUsage,
            finalOpts.signal?.aborted && attemptStatus !== 'completed'
              ? 'cancelled'
              : attemptStatus,
            messages,
          )
        }
      }
    } catch (error) {
      streamError = scope.signal.aborted ? scope.signal.reason : error
      if (recovery)
        yield {
          choices: [],
          retry: {
            ...recovery,
            state: opts?.signal?.aborted ? 'cancelled' : 'failed',
            updatedAt: Date.now(),
          },
        }
      throw streamError
    } finally {
      scope.dispose()

      const durationMs = Date.now() - startTime
      performanceLatencySeconds.observe(
        { metric: 'llm_provider_stream_total', provider: config.provider },
        durationMs / 1000,
      )
      logger.debug(`LLM chatStream 完成`, {
        model: config.modelId,
        durationMs,
        promptTokens: lastUsage?.promptTokens,
        completionTokens: lastUsage?.completionTokens,
      })
      finishLlmSpan(span, {
        usage: lastUsage,
        finishReason,
        output,
        firstTokenMs,
        error: streamError,
      })
    }
  }

  /** 按模型配置选择Provider流式或非流式调用，并统一输出Delta。 */
  async *chatConfigured(
    config: ModelConfig,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncIterable<ChatDelta> {
    if (config.stream !== false) {
      yield* this.chatStream(config, messages, opts)
      return
    }
    // 非流式请求也实时交付重试事件，不等最终响应返回后才补放动画。
    const controller = new AbortController()
    const signal = opts?.signal
      ? AbortSignal.any([opts.signal, controller.signal])
      : controller.signal
    const events: ModelRetryInfo[] = []
    let wake: (() => void) | undefined
    let settled = false
    let completion: ChatCompletion | undefined
    let failure: unknown
    const pending = this.chat(config, messages, {
      ...opts,
      signal,
      onRetry: (retry) => {
        events.push(retry)
        opts?.onRetry?.(retry)
        wake?.()
      },
    })
      .then(
        (value) => {
          completion = value
        },
        (error: unknown) => {
          failure = error
        },
      )
      .finally(() => {
        settled = true
        wake?.()
      })
    try {
      while (!settled || events.length) {
        if (events.length) yield { choices: [], retry: events.shift()! }
        else
          await new Promise<void>((resolve) => {
            wake = resolve
          })
      }
      if (failure !== undefined) throw failure
    } finally {
      if (!settled) controller.abort(new Error('模型读取已结束'))
      await pending
    }
    if (!completion) throw new AppError('LLM_ERROR', { message: '模型未返回有效响应' })
    yield {
      choices: completion.choices.map((choice) => ({
        delta: {
          role: choice.message.role,
          content: choice.message.content ?? undefined,
          reasoningContent: choice.message.reasoningContent,
          nativeReasoning: choice.message.nativeReasoning,
          toolCalls: choice.message.toolCalls?.map((call, index) => ({
            index,
            id: call.id,
            type: call.type,
            function: call.function,
          })),
        },
        finishReason: choice.finishReason,
      })),
      usage: completion.usage,
    }
  }

  /** 获取模型列表 */
  async listModels(config: ModelConfig): Promise<string[]> {
    const provider = this.createProvider(config)
    return provider.listModels()
  }

  /**
   * 快速提取文本内容
   *
   * 对非流式结果的便捷方法，适用于后台 LLM 调用。
   */
  async chatText(
    config: ModelConfig,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): Promise<string> {
    const result = await this.chat(config, messages, opts)
    return result.choices[0]?.message?.content ?? ''
  }

  /**
   * 获取累计 Token 用量
   *
   * 进程级统计，重启后清零。
   */
  getUsageStats(): CumulativeUsage {
    return { ...this.usage }
  }

  /** 重置 Token 统计 */
  resetUsageStats(): void {
    this.usage = { totalPromptTokens: 0, totalCompletionTokens: 0, totalRequests: 0 }
  }

  // ── 内部方法 ──

  /**
   * 合并调用选项
   *
   * ModelConfig 中的 temperature / topP / maxTokens 作为默认值，
   * ChatOptions 中的同名字段可覆盖。
   */
  private mergeOpts(config: ModelConfig, opts?: ChatOptions): ChatOptions {
    return {
      ...opts,
      tools: canonicalTools(opts?.tools),
      temperature: opts?.temperature ?? config.temperature,
      topP: opts?.topP ?? config.topP,
      maxTokens: opts?.maxTokens ?? config.maxTokens,
      reasoningEffort: opts?.reasoningEffort ?? config.reasoningEffort,
      returnNativeReasoning: opts?.returnNativeReasoning ?? config.returnNativeReasoning,
    }
  }

  private consumeKernelTokens(usage?: UsageInfo): void {
    if (!usage) return
    consumeCurrentKernelExecution({
      inputTokens: usage.promptTokens,
      outputTokens: Math.max(0, usage.completionTokens - (usage.reasoningTokens ?? 0)),
    })
  }

  /** 每个实际尝试只入账一次；账本异常不得打断已经完成的模型回复。 */
  private recordCall(
    config: ModelConfig,
    opts: ChatOptions,
    startedAt: number,
    usage: UsageInfo | undefined,
    status: LlmUsageAttempt['status'],
    messages: ChatMessage[],
  ): void {
    if (!this.recordAttempt) return
    const execution = currentKernelExecution()
    const purpose =
      opts.usageContext?.purpose ??
      config.usagePurpose ??
      (execution?.class === 'resident'
        ? 'companion'
        : execution?.taskId
          ? 'task'
          : execution?.class === 'maintenance'
            ? 'memory'
            : execution?.class === 'interactive' || execution?.class === 'foreground'
              ? 'conversation'
              : 'system')
    let diagnostics: Pick<LlmUsageAttempt, 'promptHash' | 'prefixHash' | 'toolsHash'> = {}
    try {
      diagnostics = {
        promptHash: promptFingerprint(
          this.createProvider(config).getInputTokenPayload(messages, opts),
        ),
        prefixHash: promptFingerprint(
          messages.filter((message) => message.role === 'system').map(({ content }) => content),
        ),
        toolsHash: promptFingerprint(opts.tools ?? []),
      }
    } catch {
      // 无法装配的失败请求仍入账，不让诊断指纹阻断用量记录。
    }
    try {
      this.recordAttempt({
        id: randomUUID(),
        startedAt,
        finishedAt: Date.now(),
        provider: config.provider,
        modelId: config.modelId,
        agentId: opts.usageContext?.agentId ?? config.usageAgentId ?? execution?.principalId,
        channel: opts.usageContext?.channel ?? execution?.channel,
        threadId: opts.usageContext?.threadId ?? execution?.threadId,
        applicationId: opts.usageContext?.applicationId,
        executionId: opts.usageContext?.executionId ?? execution?.executionId,
        step: opts.usageContext?.step,
        ...diagnostics,
        purpose,
        status,
        usage,
      })
    } catch (error) {
      logger.error('模型调用用量写入失败', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  /**
   * 自动重试
   *
   * 仅对临时 HTTP、网络和可恢复超时重试；统一退避支持取消与上游 Retry-After。
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    config: ModelConfig,
    retry: RetryConfig = DEFAULT_RETRY,
    signal?: AbortSignal,
    onRetry?: (retry: ModelRetryInfo) => void,
  ): Promise<T> {
    let recovery: ModelRetryInfo | undefined
    try {
      for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
        signal?.throwIfAborted()
        if (attempt > 0) consumeCurrentKernelExecution({ llmCalls: 1 })
        if (recovery) onRetry?.({ ...recovery, state: 'retrying', updatedAt: Date.now() })
        try {
          const result = await fn()
          if (recovery) onRetry?.({ ...recovery, state: 'recovered', updatedAt: Date.now() })
          return result
        } catch (error) {
          signal?.throwIfAborted()
          if (!retryableLlmError(error) || attempt >= retry.maxRetries) throw error
          if (recovery) onRetry?.({ ...recovery, state: 'failed', updatedAt: Date.now() })
          const now = Date.now()
          const delayMs = retryDelay(error, attempt)
          recovery = {
            retryId: randomUUID(),
            state: 'waiting',
            attempt: attempt + 1,
            maxRetries: retry.maxRetries,
            delayMs,
            reason: error instanceof Error ? error.message.slice(0, 300) : '上游连接异常',
            startedAt: now,
            updatedAt: now,
            partialResponse: false,
          }
          logger.warn('模型调用失败，等待重试', {
            model: config.modelId,
            attempt: attempt + 1,
            maxRetries: retry.maxRetries,
            delayMs,
          })
          onRetry?.(recovery)
          await waitForRetry(delayMs, signal)
        }
      }
    } catch (error) {
      if (recovery)
        onRetry?.({
          ...recovery,
          state: signal?.aborted && !(signal.reason instanceof AppError) ? 'cancelled' : 'failed',
          updatedAt: Date.now(),
        })
      throw error
    }
    throw new AppError('LLM_ERROR', { message: '模型重试未取得有效响应' })
  }

  /** 追踪 Token 用量 */
  private trackUsage(usage?: UsageInfo): void {
    this.usage.totalRequests++
    if (usage) {
      this.usage.totalPromptTokens += usage.promptTokens
      this.usage.totalCompletionTokens += usage.completionTokens
    }
  }

  /**
   * 解析 API 基址
   *
   * 优先级：用户配置 > provider 默认值 > OpenAI 默认
   */
  private resolveApiBase(provider: string, userBase?: string): string {
    if (userBase?.trim()) {
      return userBase.trim().replace(/\/$/, '')
    }
    return DEFAULT_API_BASES[provider] ?? DEFAULT_API_BASES.openai!
  }
}
