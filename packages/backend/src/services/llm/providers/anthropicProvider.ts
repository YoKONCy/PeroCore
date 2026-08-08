/**
 * Anthropic 原生 Provider
 *
 * 使用 Anthropic Messages API 直接调用，
 * 输出统一转换为 OpenAI 格式的 ChatCompletion / ChatDelta。
 *
 * 支持：
 * - 非流式 / 流式对话
 * - Function Calling (tool_use / tool_result 双向转换)
 * - 流式 Tool Use 增量拼接
 * - 统一 AppError 错误处理
 * - 思考模式 (extended thinking) 兼容
 *
 * @module packages/backend/src/services/llm/providers/anthropicProvider
 */

import type {
  LlmProvider,
  ChatMessage,
  ChatOptions,
  ChatCompletion,
  ChatDelta,
  ProviderConfig,
  ToolCall,
  UsageInfo,
} from '../types'
import { AppError } from '../../../lib/appError'
import { stripBase64DataUris } from '../sanitize'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('AnthropicProvider')

/** Anthropic 默认 API 基址 */
const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'

/** Anthropic SSE 事件类型 */
type AnthropicEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'ping'

export class AnthropicProvider implements LlmProvider {
  constructor(private config: ProviderConfig) {}

  /**
   * 非流式调用
   */
  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatCompletion> {
    const { systemPrompt, anthropicMessages } = this.convertMessages(messages)
    const url = `${this.getBase()}/v1/messages`
    const body = this.buildBody(systemPrompt, anthropicMessages, opts, false)

    const response = await this.fetchWithTimeout(url, body, opts.timeout ?? 300_000)

    if (!response.ok) {
      await this.handleError(response, 'chat')
    }

    const data = (await response.json()) as Record<string, unknown>
    return this.toCompletion(data)
  }

  /**
   * 流式调用
   *
   * Anthropic 流式使用自定义 SSE 事件格式：
   * - message_start → 消息元数据
   * - content_block_start → 新内容块 (text / tool_use)
   * - content_block_delta → 增量 (text_delta / input_json_delta)
   * - content_block_stop → 块结束
   * - message_delta → 停止原因、usage
   * - message_stop → 消息完成
   */
  async *chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncIterable<ChatDelta> {
    const { systemPrompt, anthropicMessages } = this.convertMessages(messages)
    const url = `${this.getBase()}/v1/messages`
    const body = this.buildBody(systemPrompt, anthropicMessages, opts, true)

    const response = await this.fetchWithTimeout(url, body, opts.timeout ?? 120_000)

    if (!response.ok) {
      await this.handleError(response, 'chatStream')
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new AppError('LLM_ERROR', {
        message: 'Anthropic 响应体为空',
        data: { provider: 'anthropic', model: this.config.modelId },
      })
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 跟踪当前活跃的 tool_use 块
    let currentToolIndex = 0
    let currentToolId = ''
    let currentToolName = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        // Anthropic 的 SSE 格式使用 event: 和 data: 两行
        let currentEvent = ''

        for (const line of lines) {
          const trimmed = line.trim()

          // 捕获 event 类型
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7)
            continue
          }

          if (!trimmed.startsWith('data: ')) continue
          const jsonStr = trimmed.slice(6)

          try {
            const data = JSON.parse(jsonStr) as Record<string, unknown>
            const eventType = (currentEvent || data.type) as AnthropicEventType

            switch (eventType) {
              case 'message_start': {
                // 提取初始 usage
                const message = data.message as Record<string, unknown> | undefined
                const rawUsage = message?.usage as Record<string, unknown> | undefined
                if (rawUsage) {
                  yield {
                    choices: [{ delta: { role: 'assistant' }, finishReason: null }],
                    usage: this.normalizeUsage(rawUsage),
                  }
                }
                break
              }

              case 'content_block_start': {
                const block = data.content_block as Record<string, unknown>
                if (block?.type === 'tool_use') {
                  currentToolId = (block.id as string) ?? ''
                  currentToolName = (block.name as string) ?? ''
                  currentToolIndex = (data.index as number) ?? 0

                  // 发出工具调用开始信号
                  yield {
                    choices: [
                      {
                        delta: {
                          toolCalls: [
                            {
                              index: currentToolIndex,
                              id: currentToolId,
                              type: 'function',
                              function: {
                                name: currentToolName,
                                arguments: '',
                              },
                            },
                          ],
                        },
                        finishReason: null,
                      },
                    ],
                  }
                }
                break
              }

              case 'content_block_delta': {
                const delta = data.delta as Record<string, unknown>
                if (!delta) break

                if (delta.type === 'text_delta' && delta.text) {
                  yield {
                    choices: [
                      {
                        delta: { content: delta.text as string },
                        finishReason: null,
                      },
                    ],
                  }
                } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                  // 工具调用参数增量
                  yield {
                    choices: [
                      {
                        delta: {
                          toolCalls: [
                            {
                              index: currentToolIndex,
                              function: {
                                arguments: delta.partial_json as string,
                              },
                            },
                          ],
                        },
                        finishReason: null,
                      },
                    ],
                  }
                }
                break
              }

              case 'message_delta': {
                // 消息结束，提取最终 usage 和 stop_reason
                const messageDelta = data.delta as Record<string, unknown> | undefined
                const rawUsage = data.usage as Record<string, unknown> | undefined
                const stopReason = messageDelta?.stop_reason as string | undefined

                yield {
                  choices: [
                    {
                      delta: {},
                      finishReason: this.mapStopReason(stopReason),
                    },
                  ],
                  usage: rawUsage ? this.normalizeUsage(rawUsage) : undefined,
                }
                break
              }

              // message_stop / content_block_stop / ping → 忽略
              default:
                break
            }
          } catch {
            // 跳过解析错误
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /** 列出可用模型 */
  async listModels(): Promise<string[]> {
    try {
      const url = `${this.getBase()}/v1/models`
      const response = await fetch(url, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return this.fallbackModels()

      const data = (await response.json()) as { data?: Array<{ id: string }> }
      return (data.data ?? []).map((m) => m.id).sort()
    } catch {
      return this.fallbackModels()
    }
  }

  // ── 内部方法: 请求构建 ──

  /** 获取 API 基址 */
  private getBase(): string {
    const base = this.config.apiBase?.trim().replace(/\/$/, '')
    if (!base || base === 'https://api.openai.com') {
      return ANTHROPIC_DEFAULT_BASE
    }
    return base
  }

  /** 构建请求头 */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
    }
  }

  /** 构建请求体 */
  private buildBody(
    systemPrompt: string,
    messages: Array<Record<string, unknown>>,
    opts: ChatOptions,
    stream: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.config.modelId,
      messages,
      max_tokens: this.config.maxTokens ?? opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      stream,
    }

    if (systemPrompt) body.system = systemPrompt
    if (opts.topP !== undefined) body.top_p = opts.topP
    if (opts.stop?.length) body.stop_sequences = opts.stop

    // 工具定义 → Anthropic tools 格式
    if (opts.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }))

      // 工具选择策略映射
      if (opts.toolChoice) {
        if (opts.toolChoice === 'auto') body.tool_choice = { type: 'auto' }
        else if (opts.toolChoice === 'none') body.tool_choice = { type: 'none' }
        else if (opts.toolChoice === 'required') body.tool_choice = { type: 'any' }
        else if (typeof opts.toolChoice === 'object') {
          body.tool_choice = { type: 'tool', name: opts.toolChoice.function.name }
        }
      }
    }

    return body
  }

  // ── 内部方法: 消息转换 ──

  /**
   * 将 OpenAI 消息格式转为 Anthropic 格式
   *
   * - system → 提取到顶层 system 参数
   * - tool → 转为 tool_result content block
   * - assistant with tool_calls → 转为 tool_use content blocks
   * - 合并相邻同角色消息 (Anthropic 要求交替)
   */
  private convertMessages(messages: ChatMessage[]): {
    systemPrompt: string
    anthropicMessages: Array<Record<string, unknown>>
  } {
    let systemPrompt = ''
    const rawMessages: Array<Record<string, unknown>> = []

    for (const msg of messages) {
      // system → 顶层
      if (msg.role === 'system') {
        systemPrompt += (typeof msg.content === 'string' ? msg.content : '') + '\n'
        continue
      }

      // tool → tool_result (user 角色)
      if (msg.role === 'tool') {
        rawMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              // 兜底防御：剥离 tool 返回里可能混入的 base64 data URI，避免爆 token / 污染上下文。
              content: typeof msg.content === 'string' ? stripBase64DataUris(msg.content) : '',
            },
          ],
        })
        continue
      }

      // assistant + toolCalls → tool_use blocks
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const blocks: Array<Record<string, unknown>> = []
        if (msg.content) {
          blocks.push({ type: 'text', text: String(msg.content) })
        }
        for (const tc of msg.toolCalls) {
          let input: Record<string, unknown>
          try {
            input = JSON.parse(tc.function.arguments) as Record<string, unknown>
          } catch {
            input = {}
          }
          blocks.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          })
        }
        rawMessages.push({ role: 'assistant', content: blocks })
        continue
      }

      // 普通消息
      rawMessages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : '',
      })
    }

    // 合并相邻同角色消息 (Anthropic 不允许连续同角色)
    const merged = this.mergeAdjacentRoles(rawMessages)

    return { systemPrompt: systemPrompt.trim(), anthropicMessages: merged }
  }

  /**
   * 合并相邻同角色消息
   *
   * Anthropic 要求消息列表严格交替 user/assistant。
   * 连续的同角色消息合并为一条。
   */
  private mergeAdjacentRoles(
    messages: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    if (messages.length <= 1) return messages

    const merged: Array<Record<string, unknown>> = []

    for (const msg of messages) {
      const prev = merged[merged.length - 1]
      if (prev && prev.role === msg.role) {
        // 合并内容
        const prevContent = prev.content
        const currContent = msg.content

        if (typeof prevContent === 'string' && typeof currContent === 'string') {
          prev.content = prevContent + '\n' + currContent
        } else if (Array.isArray(prevContent) && Array.isArray(currContent)) {
          prev.content = [...prevContent, ...currContent]
        } else if (Array.isArray(prevContent) && typeof currContent === 'string') {
          ;(prevContent as Array<Record<string, unknown>>).push({ type: 'text', text: currContent })
        } else if (typeof prevContent === 'string' && Array.isArray(currContent)) {
          prev.content = [
            { type: 'text', text: prevContent },
            ...(currContent as Array<Record<string, unknown>>),
          ]
        }
      } else {
        merged.push({ ...msg })
      }
    }

    return merged
  }

  // ── 内部方法: 响应规范化 ──

  /** 将 Anthropic 非流式响应转为 OpenAI ChatCompletion */
  private toCompletion(data: Record<string, unknown>): ChatCompletion {
    const contentBlocks = (data.content ?? []) as Array<Record<string, unknown>>
    let textContent = ''
    const toolCalls: ToolCall[] = []

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += (block.text as string) ?? ''
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: (block.id as string) ?? '',
          type: 'function',
          function: {
            name: (block.name as string) ?? '',
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
      }
    }

    const message: ChatCompletion['choices'][0]['message'] = {
      role: 'assistant',
      content: textContent || null,
    }
    if (toolCalls.length) message.toolCalls = toolCalls

    // 提取 usage
    const rawUsage = data.usage as Record<string, unknown> | undefined

    return {
      choices: [
        {
          message,
          finishReason: this.mapStopReason(data.stop_reason as string | undefined),
        },
      ],
      usage: rawUsage ? this.normalizeUsage(rawUsage) : undefined,
    }
  }

  /** 规范化 Anthropic Usage → UsageInfo */
  private normalizeUsage(raw: Record<string, unknown>): UsageInfo {
    const input = (raw.input_tokens as number) ?? 0
    const output = (raw.output_tokens as number) ?? 0
    return {
      promptTokens: input,
      completionTokens: output,
      totalTokens: input + output,
    }
  }

  /** 映射 Anthropic 停止原因 → OpenAI 格式 */
  private mapStopReason(reason?: string): string {
    if (!reason) return 'stop'
    const mapping: Record<string, string> = {
      end_turn: 'stop',
      stop_sequence: 'stop',
      max_tokens: 'length',
      tool_use: 'tool_calls',
    }
    return mapping[reason] ?? reason
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
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError('LLM_TIMEOUT', {
          message: `Anthropic 请求超时 (${Math.round(timeoutMs / 1000)}s)`,
          data: { provider: 'anthropic', model: this.config.modelId },
        })
      }
      throw new AppError('LLM_ERROR', {
        message: `Anthropic 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        data: { provider: 'anthropic', model: this.config.modelId },
      })
    }
  }

  /** 处理 HTTP 错误响应 → AppError */
  private async handleError(response: Response, method: string): Promise<never> {
    const text = await response.text().catch(() => '(无法读取响应体)')
    const code = response.status === 429 ? 'LLM_RATE_LIMITED' : 'LLM_ERROR'

    // 尝试解析 retry-after
    const retryAfter = response.headers.get('retry-after')
    const retryMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : undefined

    logger.error(`Anthropic ${method} 失败`, {
      status: response.status,
      body: text.slice(0, 300),
      model: this.config.modelId,
    })

    throw new AppError(code, {
      message: `Anthropic API 错误 (${response.status}): ${text.slice(0, 200)}`,
      data: {
        provider: 'anthropic',
        model: this.config.modelId,
        status: response.status,
        retryAfter: retryMs,
      },
    })
  }

  /** 回退模型列表 */
  private fallbackModels(): string[] {
    return ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229']
  }
}
