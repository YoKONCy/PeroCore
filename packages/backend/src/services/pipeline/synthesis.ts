/**
 * Phase 4: Synthesis — LLM 流式合成 + Function Calling 循环
 *
 * 独立的 LLM 交互层，支持:
 * - 纯流式文本输出
 * - Function Calling (FC) 多轮工具调用
 * - SSE 事件分发 (delta / tool_call / tool_result / status)
 *
 * SSE 事件类型:
 * - delta: 文本增量
 * - tool_call: 工具开始调用
 * - tool_result: 工具执行结果
 * - status: 状态转换 (thinking/calling/generating)
 * - done: 对话完成
 * - error: 错误
 *
 * @module packages/backend/src/services/pipeline/synthesis
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ChatMessage as LlmChatMessage, ToolDefinition as LlmToolDef } from '../llm/types'
import type { ToolCallRecord } from './types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('Synthesis')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** SSE 事件类型 */
export interface SseEvent {
  event: 'delta' | 'tool_call' | 'tool_result' | 'status' | 'done' | 'error'
  data: Record<string, unknown>
}

/** 工具执行器接口 */
export interface SynthesisToolExecutor {
  execute(name: string, args: Record<string, unknown>): Promise<string>
}

/** Synthesis 配置 */
export interface SynthesisConfig {
  /** 最大工具调用轮次 (防止死循环) */
  maxToolRounds: number
  /** 工具执行超时 (毫秒) */
  toolTimeoutMs: number
}

const DEFAULT_CONFIG: SynthesisConfig = {
  maxToolRounds: 6,
  toolTimeoutMs: 30_000,
}

/** Synthesis 依赖 */
export interface SynthesisDeps {
  llmService: LlmService
  modelConfig: ModelConfig
  toolExecutor?: SynthesisToolExecutor
}

/** Synthesis 输入 */
export interface SynthesisInput {
  /** 组装好的消息列表 (LLM 格式) */
  messages: LlmChatMessage[]
  /** 可用的工具定义 (LLM 格式) */
  tools?: LlmToolDef[]
  /** 来源 (用于日志) */
  source: string
}

/** Synthesis 输出 (非流式) */
export interface SynthesisResult {
  /** 完整回复文本 */
  text: string
  /** 工具调用记录 */
  toolCalls: ToolCallRecord[]
  /** Token 使用统计 */
  usage: { promptTokens: number; completionTokens: number } | null
}

// ─────────────────────────────────────────────
// 核心函数
// ─────────────────────────────────────────────

/**
 * 非流式合成 — 收集全部文本后返回
 */
export async function runSynthesis(
  deps: SynthesisDeps,
  input: SynthesisInput,
  config?: Partial<SynthesisConfig>,
): Promise<SynthesisResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const allToolCalls: ToolCallRecord[] = []
  const messages: LlmChatMessage[] = [...input.messages]
  let fullText = ''

  for (let round = 0; round <= cfg.maxToolRounds; round++) {
    const completion = await deps.llmService.chat(deps.modelConfig, messages, {
      tools: input.tools,
    })

    const choice = completion.choices[0]
    if (!choice) break

    const assistantMessage = choice.message
    fullText = assistantMessage?.content ?? ''

    // 检查是否有工具调用
    const toolCallsInResponse = assistantMessage?.toolCalls ?? []
    if (toolCallsInResponse.length === 0 || !deps.toolExecutor) {
      break
    }

    // 将 assistant 消息加入上下文
    messages.push({
      role: 'assistant',
      content: assistantMessage?.content ?? '',
      toolCalls: toolCallsInResponse,
    })

    // 执行工具
    for (const tc of toolCallsInResponse) {
      const startMs = Date.now()
      let result: string

      try {
        result = await Promise.race([
          deps.toolExecutor.execute(tc.function.name, JSON.parse(tc.function.arguments || '{}')),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('工具执行超时')), cfg.toolTimeoutMs),
          ),
        ])
      } catch (err) {
        result = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`
        logger.warn(`工具 ${tc.function.name} 执行失败: ${result}`)
      }

      const durationMs = Date.now() - startMs
      allToolCalls.push({
        name: tc.function.name,
        args: JSON.parse(tc.function.arguments || '{}'),
        result,
        durationMs,
      })

      // 将工具结果注入上下文
      messages.push({
        role: 'tool',
        content: result,
        toolCallId: tc.id,
      })
    }

    logger.debug(`工具调用轮次 ${round + 1}: ${toolCallsInResponse.length} 个工具`)
  }

  return {
    text: fullText,
    toolCalls: allToolCalls,
    usage: null,
  }
}

/**
 * 流式合成 — SSE 事件生成器
 *
 * yield SseEvent 对象，调用方负责写入 SSE 流。
 * 支持 FC 多轮: 工具调用时暂停文本流，执行工具后继续。
 */
export async function* runSynthesisStream(
  deps: SynthesisDeps,
  input: SynthesisInput,
  config?: Partial<SynthesisConfig>,
): AsyncGenerator<SseEvent, SynthesisResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const allToolCalls: ToolCallRecord[] = []
  const messages: LlmChatMessage[] = [...input.messages]
  let fullText = ''
  let round = 0

  while (round <= cfg.maxToolRounds) {
    // 发送状态事件
    yield {
      event: 'status',
      data: {
        state: round === 0 ? 'generating' : 'generating',
        message: round === 0 ? '正在生成...' : `继续生成 (工具调用轮次 ${round})...`,
        turn: round + 1,
      },
    }

    // 调用 LLM 流式接口
    const stream = deps.llmService.chatStream(deps.modelConfig, messages, { tools: input.tools })

    let currentText = ''
    let pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = []

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta

      // 文本增量
      if (delta?.content) {
        currentText += delta.content
        fullText += delta.content
        yield { event: 'delta', data: { content: delta.content } }
      }

      // FC 增量 (累积 tool_calls)
      if (delta?.toolCalls?.length) {
        for (const tc of delta.toolCalls) {
          // 查找或创建 pending tool call
          let pending = pendingToolCalls.find((p) => p.id === (tc.id ?? ''))
          if (!pending && tc.id) {
            pending = { id: tc.id, name: tc.function?.name ?? '', arguments: '' }
            pendingToolCalls.push(pending)
          }
          if (pending) {
            if (tc.function?.name) pending.name = tc.function.name
            if (tc.function?.arguments) pending.arguments += tc.function.arguments
          }
        }
      }
    }

    // 如果没有工具调用，结束
    if (pendingToolCalls.length === 0 || !deps.toolExecutor) {
      break
    }

    // 将 assistant 消息加入上下文
    messages.push({ role: 'assistant', content: currentText })

    // 执行工具
    for (const tc of pendingToolCalls) {
      let parsedArgs: Record<string, unknown> = {}
      try {
        parsedArgs = JSON.parse(tc.arguments || '{}')
      } catch {
        parsedArgs = { raw: tc.arguments }
      }

      // 发送 tool_call 事件
      yield {
        event: 'tool_call',
        data: { name: tc.name, args: parsedArgs },
      }

      yield {
        event: 'status',
        data: { state: 'calling', message: `正在调用 ${tc.name}...`, turn: round + 1 },
      }

      // 执行
      const startMs = Date.now()
      let result: string

      try {
        result = await Promise.race([
          deps.toolExecutor.execute(tc.name, parsedArgs),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('工具执行超时')), cfg.toolTimeoutMs),
          ),
        ])
      } catch (err) {
        result = `工具执行失败: ${err instanceof Error ? err.message : String(err)}`
      }

      const durationMs = Date.now() - startMs
      allToolCalls.push({ name: tc.name, args: parsedArgs, result, durationMs })

      // 发送 tool_result 事件
      yield {
        event: 'tool_result',
        data: { name: tc.name, result: result.slice(0, 2000), durationMs },
      }

      // 注入上下文
      messages.push({ role: 'tool', content: result, toolCallId: tc.id })
    }

    pendingToolCalls = []
    round++
  }

  return {
    text: fullText,
    toolCalls: allToolCalls,
    usage: null,
  }
}
