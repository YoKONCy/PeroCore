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

import type {
  LlmProvider,
  ChatMessage,
  ChatOptions,
  ChatCompletion,
  ChatDelta,
  UsageInfo,
} from './types'
import { OpenAiProvider } from './providers/openaiProvider'
import { GeminiProvider } from './providers/geminiProvider'
import { AnthropicProvider } from './providers/anthropicProvider'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'

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
  /** 最大 token 数 */
  maxTokens?: number
  /** 是否启用视觉能力 (多模态) */
  enableVision?: boolean
}

// ─────────────────────────────────────────────
// 重试配置
// ─────────────────────────────────────────────

interface RetryConfig {
  /** 最大重试次数 (不含首次) */
  maxRetries: number
  /** 基础延迟 (毫秒) */
  baseDelayMs: number
  /** 最大延迟 (毫秒) */
  maxDelayMs: number
}

/** 默认重试配置 */
const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
}

/** 可重试的错误码 */
const RETRYABLE_CODES = new Set(['LLM_RATE_LIMITED', 'LLM_TIMEOUT'])

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
          maxTokens: config.maxTokens ?? 4096,
        })

      default:
        // 所有 OpenAI 兼容的厂商统一走 OpenAiProvider
        return new OpenAiProvider({
          apiKey: config.apiKey,
          apiBase,
          modelId: config.modelId,
        })
    }
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
    const startTime = Date.now()
    const finalOpts = this.mergeOpts(config, opts)

    const result = await this.withRetry(async () => {
      const provider = this.createProvider(config)
      return provider.chat(messages, finalOpts)
    }, config)

    // 追踪 Token 用量
    this.trackUsage(result.usage)

    const durationMs = Date.now() - startTime
    logger.debug(`LLM chat 完成`, {
      model: config.modelId,
      durationMs,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    })

    return result
  }

  /**
   * 流式 LLM 调用
   *
   * 适用于前端对话。流式不做自动重试 (中断后无法续传)。
   * 使用方: for await (const delta of llmService.chatStream(...)) { ... }
   */
  async *chatStream(
    config: ModelConfig,
    messages: ChatMessage[],
    opts?: ChatOptions,
  ): AsyncIterable<ChatDelta> {
    const startTime = Date.now()
    const finalOpts = this.mergeOpts(config, opts)
    const provider = this.createProvider(config)

    let lastUsage: UsageInfo | undefined

    try {
      for await (const delta of provider.chatStream(messages, finalOpts)) {
        // 捕获最后一个含 usage 的 chunk
        if (delta.usage) lastUsage = delta.usage
        yield delta
      }
    } finally {
      // 追踪 Token 用量
      this.trackUsage(lastUsage)

      const durationMs = Date.now() - startTime
      logger.debug(`LLM chatStream 完成`, {
        model: config.modelId,
        durationMs,
        promptTokens: lastUsage?.promptTokens,
        completionTokens: lastUsage?.completionTokens,
      })
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
      temperature: opts?.temperature ?? config.temperature,
      topP: opts?.topP ?? config.topP,
      maxTokens: opts?.maxTokens ?? config.maxTokens,
      ...opts,
    }
  }

  /**
   * 自动重试
   *
   * 仅对 LLM_RATE_LIMITED / LLM_TIMEOUT 进行重试。
   * 使用指数退避 + 抖动：base * 2^attempt * (0.5~1.5)
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    config: ModelConfig,
    retry: RetryConfig = DEFAULT_RETRY,
  ): Promise<T> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // 判断是否可重试
        const isRetryable =
          err instanceof AppError && RETRYABLE_CODES.has(err.code) && attempt < retry.maxRetries

        if (!isRetryable) throw err

        // 计算延迟 (指数退避 + 抖动)
        const jitter = 0.5 + Math.random()
        const delayMs = Math.min(
          retry.baseDelayMs * Math.pow(2, attempt) * jitter,
          retry.maxDelayMs,
        )

        // 如果响应头有 retry-after，优先使用
        const retryAfter = (err as AppError).data as Record<string, unknown> | undefined
        const serverDelay = retryAfter?.retryAfter as number | undefined
        const actualDelay = serverDelay ? Math.min(serverDelay, retry.maxDelayMs) : delayMs

        logger.warn(`LLM 调用失败，${actualDelay}ms 后重试`, {
          attempt: attempt + 1,
          maxRetries: retry.maxRetries,
          model: config.modelId,
          code: (err as AppError).code,
          delay: Math.round(actualDelay),
        })

        await this.sleep(actualDelay)
      }
    }

    // 不应到达此处，但作为安全兜底
    throw lastError ?? new AppError('LLM_ERROR', { message: '未知 LLM 错误' })
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

  /** 延迟 */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
