/**
 * OpenAI 兼容 Provider
 *
 * 绝大多数 LLM 厂商 (DeepSeek / SiliconFlow / 火山 / Groq / DashScope 等)
 * 均走 OpenAI 兼容协议，本 Provider 统一处理。
 *
 * 支持：
 * - 非流式 / 流式对话
 * - Function Calling (工具调用)
 * - 流式 Tool Call 增量拼接
 * - 统一错误转 AppError
 *
 * @module packages/backend/src/services/llm/providers/openaiProvider
 */

import type {
  LlmProvider,
  ChatMessage,
  ChatOptions,
  ChatCompletion,
  ChatDelta,
  ProviderConfig,
  UsageInfo,
} from '../types'
import { AppError } from '../../../lib/appError'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('OpenAiProvider')

/** HTTP 状态码 → ResponseCode 映射 */
const STATUS_TO_CODE: Record<number, 'LLM_ERROR' | 'LLM_RATE_LIMITED' | 'LLM_TIMEOUT'> = {
  429: 'LLM_RATE_LIMITED',
  504: 'LLM_TIMEOUT',
}

export class OpenAiProvider implements LlmProvider {
  constructor(private config: ProviderConfig) {}

  /**
   * 非流式调用
   *
   * 发送完整请求，等待完整响应。
   * 适用于 Scorer / Reflection 等后台任务。
   */
  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatCompletion> {
    const url = this.buildUrl('/chat/completions')
    const payload = this.buildPayload(messages, opts, false)

    const response = await this.fetchWithTimeout(url, payload, opts.timeout ?? 300_000)

    if (!response.ok) {
      await this.handleError(response, 'chat')
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.normalizeCompletion(data)
  }

  /**
   * 流式调用
   *
   * 逐 chunk 流式返回增量内容。
   * 支持文本增量和 Tool Call 增量。
   */
  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatDelta> {
    const url = this.buildUrl('/chat/completions')
    const payload = this.buildPayload(messages, opts, true)

    const response = await this.fetchWithTimeout(url, payload, opts.timeout ?? 120_000)

    if (!response.ok) {
      await this.handleError(response, 'chatStream')
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new AppError('LLM_ERROR', {
        message: 'OpenAI 响应体为空',
        data: { provider: 'openai', model: this.config.modelId },
      })
    }

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || !trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') return

          try {
            const chunk = JSON.parse(data) as Record<string, unknown>
            yield this.normalizeDelta(chunk)
          } catch {
            // 跳过无法解析的行
            logger.debug(`跳过无法解析的 SSE 数据: ${data.slice(0, 100)}`)
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** 列出可用模型 */
  async listModels(): Promise<string[]> {
    const url = this.buildUrl('/models')

    try {
      const response = await fetch(url, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) return []

      const data = (await response.json()) as Record<string, unknown>
      const modelList = (data.data ?? data.models ?? []) as Array<Record<string, unknown>>

      return modelList
        .map((m) => (m.id ?? m.name ?? '') as string)
        .filter(Boolean)
        .sort()
    } catch (err) {
      logger.warn(`获取模型列表失败: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  // ── 内部方法: 请求构建 ──

  /** 构建 API URL */
  private buildUrl(endpoint: string): string {
    const base = this.config.apiBase.replace(/\/$/, '')
    // 如果 base 已带 /v1，直接拼接；否则加 /v1
    if (base.endsWith('/v1')) {
      return `${base}${endpoint}`
    }
    return `${base}/v1${endpoint}`
  }

  /** 构建请求头 */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return headers
  }

  /** 构建请求体 */
  private buildPayload(
    messages: ChatMessage[],
    opts: ChatOptions,
    stream: boolean,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: this.config.modelId,
      messages: this.serializeMessages(messages),
      temperature: opts.temperature ?? 0.7,
      stream,
    }

    if (opts.topP !== undefined) payload.top_p = opts.topP
    if (opts.maxTokens) payload.max_tokens = opts.maxTokens
    if (opts.tools?.length) payload.tools = opts.tools
    if (opts.toolChoice !== undefined) payload.tool_choice = opts.toolChoice
    if (opts.responseFormat) payload.response_format = opts.responseFormat
    if (opts.stop?.length) payload.stop = opts.stop

    // 流式模式下请求返回 usage (部分厂商支持)
    if (stream) {
      payload.stream_options = { include_usage: true }
    }

    return payload
  }

  /**
   * 序列化消息为 OpenAI 格式
   *
   * 将内部 camelCase 的 toolCalls / toolCallId 转为 snake_case。
   */
  private serializeMessages(messages: ChatMessage[]): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      const serialized: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      }

      if (msg.name) serialized.name = msg.name
      if (msg.toolCallId) serialized.tool_call_id = msg.toolCallId

      if (msg.toolCalls?.length) {
        serialized.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
        }))
      }

      return serialized
    })
  }

  // ── 内部方法: 响应规范化 ──

  /** 规范化非流式响应为统一格式 */
  private normalizeCompletion(data: Record<string, unknown>): ChatCompletion {
    const rawChoices = (data.choices ?? []) as Array<Record<string, unknown>>
    const rawUsage = data.usage as Record<string, unknown> | undefined

    return {
      choices: rawChoices.map((choice) => {
        const rawMsg = choice.message as Record<string, unknown>
        const rawToolCalls = rawMsg?.tool_calls as Array<Record<string, unknown>> | undefined

        return {
          message: {
            role: 'assistant' as const,
            content: (rawMsg?.content as string | null) ?? null,
            toolCalls: rawToolCalls?.map((tc) => ({
              id: tc.id as string,
              type: 'function' as const,
              function: tc.function as { name: string; arguments: string },
            })),
          },
          finishReason: (choice.finish_reason as string) ?? undefined,
        }
      }),
      usage: rawUsage ? this.normalizeUsage(rawUsage) : undefined,
    }
  }

  /** 规范化流式增量为统一格式 */
  private normalizeDelta(data: Record<string, unknown>): ChatDelta {
    const rawChoices = (data.choices ?? []) as Array<Record<string, unknown>>
    const rawUsage = data.usage as Record<string, unknown> | undefined

    return {
      choices: rawChoices.map((choice) => {
        const rawDelta = (choice.delta ?? {}) as Record<string, unknown>
        const rawToolCalls = rawDelta.tool_calls as Array<Record<string, unknown>> | undefined

        return {
          delta: {
            role: rawDelta.role as string | undefined,
            content: rawDelta.content as string | undefined,
            toolCalls: rawToolCalls?.map((tc) => ({
              index: (tc.index as number) ?? 0,
              id: tc.id as string | undefined,
              type: tc.type as 'function' | undefined,
              function: tc.function as { name?: string; arguments?: string } | undefined,
            })),
          },
          finishReason: (choice.finish_reason as string | null) ?? null,
        }
      }),
      usage: rawUsage ? this.normalizeUsage(rawUsage) : undefined,
    }
  }

  /** 规范化 Usage 信息 (snake_case → camelCase) */
  private normalizeUsage(raw: Record<string, unknown>): UsageInfo {
    return {
      promptTokens: (raw.prompt_tokens as number) ?? 0,
      completionTokens: (raw.completion_tokens as number) ?? 0,
      totalTokens: (raw.total_tokens as number) ?? 0,
    }
  }

  // ── 内部方法: 错误处理 ──

  /** 发送请求 (带超时) */
  private async fetchWithTimeout(
    url: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      // 超时或网络错误
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError('LLM_TIMEOUT', {
          message: `OpenAI 请求超时 (${Math.round(timeoutMs / 1000)}s)`,
          data: { provider: 'openai', model: this.config.modelId },
        })
      }
      throw new AppError('LLM_ERROR', {
        message: `OpenAI 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        data: { provider: 'openai', model: this.config.modelId },
      })
    }
  }

  /** 处理 HTTP 错误响应 → AppError */
  private async handleError(response: Response, method: string): Promise<never> {
    const text = await response.text().catch(() => '(无法读取响应体)')
    const code = STATUS_TO_CODE[response.status] ?? 'LLM_ERROR'

    // 尝试解析 retryAfter (429 场景)
    const retryAfter = response.headers.get('retry-after')
    const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined

    logger.error(`OpenAI ${method} 失败`, {
      status: response.status,
      body: text.slice(0, 300),
      model: this.config.modelId,
    })

    throw new AppError(code, {
      message: `OpenAI API 错误 (${response.status}): ${text.slice(0, 200)}`,
      data: {
        provider: 'openai',
        model: this.config.modelId,
        status: response.status,
        retryAfter: retryMs,
      },
    })
  }
}
