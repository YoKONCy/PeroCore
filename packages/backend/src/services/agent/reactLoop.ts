/**
 * ReAct Loop — 推理-行动循环
 *
 * Agent 的核心推理引擎：
 * 1. 流式调用 LLM
 * 2. 收集 FC tool_calls
 * 3. 委托 ToolExecutor 执行（含 run_script 工具）
 * 4. 将结果注入上下文继续循环
 * 5. 熔断保护 (连续错误 ≥ 3 次)
 *
 * 工具调用架构 (统一 FC)：
 *   LLM → FC tool_calls → ToolExecutor → ToolRegistry
 *   复杂编排场景：LLM 调用 run_script 工具 → NitRuntime → ToolRegistry
 *   NIT 解释器作为 FC 工具存在，不再是独立的调用通道。
 *
 * @module packages/backend/src/services/agent/reactLoop
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ChatMessage } from '../pipeline/types'
import type { ToolCallRecord, ToolDefinition } from '../pipeline/types'
import type { ChatDelta } from '../llm/types'
import { ThinkingStreamFilter } from '../../nit/streamFilter'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ReActLoop')

/** 截断长文本用于日志输出 */
function truncate(text: string, maxLen = 4000): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + `... (共${text.length}字符)`
}

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

/** ReAct 配置 */
export interface ReActConfig {
  /** 最大轮次 */
  maxTurns: number
  /** 连续错误熔断阈值 */
  errorThreshold: number
  /** 单轮超时 (ms) */
  turnTimeoutMs: number
}

/** 模式对应的默认最大轮次 */
const MODE_MAX_TURNS: Record<string, number> = {
  desktop: 30,
  work: 30,
  ide: 30,
  social: 2,
  group_chat: 2,
  companion: 1,
  scheduler: 1,
}

// ─────────────────────────────────────────────
// SSE 事件
// ─────────────────────────────────────────────

/** ReAct 产出的 SSE 事件 (非文本) */
export interface SseEvent {
  event: 'tool_call' | 'tool_result' | 'status'
  data: unknown
}

/** ReAct 循环 yield 类型: 文本 or SSE 事件 */
export type ReActYield = string | SseEvent

// ─────────────────────────────────────────────
// Tool Executor 接口
// ─────────────────────────────────────────────

/** 工具执行器接口 */
export interface ToolExecutor {
  execute(name: string, args: Record<string, unknown>, source: string): Promise<ToolExecutionResult>
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  output: string
  durationMs: number
  isError: boolean
  /** finish_task 终止信号 */
  shouldTerminate: boolean
}

/** 取消检测器接口 (TaskManager 提供) */
export interface CancelChecker {
  isCancelled(sessionId: string): boolean
}

// ─────────────────────────────────────────────
// ReAct Loop
// ─────────────────────────────────────────────

/**
 * 执行 ReAct 循环
 *
 * @yields 流式文本片段 / SSE 事件 (Thinking 块已过滤)
 */
export async function* runReActLoop(params: {
  llmService: LlmService
  modelConfig: ModelConfig
  messages: ChatMessage[]
  tools: ToolDefinition[] | undefined
  toolExecutor: ToolExecutor | undefined
  source: string
  sessionId?: string
  cancelChecker?: CancelChecker
  config?: Partial<ReActConfig>
}): AsyncGenerator<ReActYield, ToolCallRecord[]> {
  const { llmService, modelConfig, messages, source, toolExecutor } = params
  const maxTurns = params.config?.maxTurns ?? MODE_MAX_TURNS[source] ?? 30
  const errorThreshold = params.config?.errorThreshold ?? 3
  const sessionId = params.sessionId ?? 'default'

  const allToolCalls: ToolCallRecord[] = []
  let consecutiveErrors = 0
  let currentTools = params.tools

  for (let turn = 0; turn < maxTurns; turn++) {
    // ── 取消检测 ──
    if (params.cancelChecker?.isCancelled(sessionId)) {
      logger.info('ReAct 循环被用户取消')
      break
    }

    logger.debug(
      `ReAct 第 ${turn + 1} 轮开始 (messages=${messages.length}, tools=${currentTools?.length ?? 0})`,
    )

    // 第 0 轮: 打印完整 system prompt
    if (turn === 0) {
      const systemMsg = messages.find((m) => m.role === 'system')
      if (systemMsg) {
        const content =
          typeof systemMsg.content === 'string'
            ? systemMsg.content
            : JSON.stringify(systemMsg.content)
        logger.debug(`[Prompt] System Prompt:\n${truncate(content, 16000)}`)
      }
      // 打印 user 消息
      const userMsgs = messages.filter((m) => m.role === 'user')
      for (const um of userMsgs) {
        const content = typeof um.content === 'string' ? um.content : JSON.stringify(um.content)
        logger.debug(`[Prompt] User 消息: ${truncate(content, 4000)}`)
      }
    } else {
      // 后续轮次: 打印最近追加的消息摘要
      const lastMsg = messages[messages.length - 1]
      if (lastMsg) {
        const content =
          typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content)
        logger.debug(`[Context] 最新消息 [${lastMsg.role}]: ${truncate(content, 4000)}`)
      }
    }

    // 推送状态: 思考中
    yield {
      event: 'status',
      data: { state: 'thinking', message: '正在思考...', turn: turn + 1 },
    }

    let turnText = ''
    const collectedCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = []
    let hasToolCalls = false

    // ── 流式过滤器 (仅 Thinking 块) ──
    const thinkingFilter = new ThinkingStreamFilter()

    // ── 流式 LLM 调用 ──
    const llmMessages = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }))

    for await (const delta of llmService.chatStream(modelConfig, llmMessages, {
      tools: currentTools
        ? currentTools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    }) as AsyncIterable<ChatDelta>) {
      const choice = delta.choices[0]
      if (!choice) continue

      // 收集文本
      const content = choice.delta.content
      if (content) {
        turnText += content

        // 流式过滤: Thinking 块 → 隐藏
        const filtered = thinkingFilter.filter(content)
        if (filtered) {
          yield filtered
        }
      }

      // ── 收集 FC tool_calls (多 tool_calls 增量组装) ──
      if (choice.delta.toolCalls) {
        hasToolCalls = true
        for (const tcDelta of choice.delta.toolCalls) {
          // 用 StreamToolCallDelta.index 定位正确的 slot
          const idx = tcDelta.index
          if (!collectedCalls[idx]) {
            collectedCalls[idx] = {
              id: tcDelta.id ?? '',
              type: 'function',
              function: { name: '', arguments: '' },
            }
          }
          const target = collectedCalls[idx]!
          if (tcDelta.id) target.id = tcDelta.id
          if (tcDelta.function?.name) target.function.name += tcDelta.function.name
          if (tcDelta.function?.arguments) target.function.arguments += tcDelta.function.arguments
        }
      }
    }

    // ── 流式过滤器刷新 ──
    const flushed = thinkingFilter.flush()
    if (flushed) yield flushed

    // 打印 LLM 原始回复文本
    if (turnText) {
      logger.debug(`[LLM回复] ${truncate(turnText, 4000)}`)
    }

    // ── 无工具调用 → 正常结束 ──
    if (!hasToolCalls) {
      if (!turnText.trim() && turn === 0) {
        yield '⚠️ AI 没有返回有效内容。请检查网络连接或 API Key 配置。'
      }
      break
    }

    // ── 需要执行工具但没有 Executor ──
    if (!toolExecutor) {
      logger.warn('有工具调用但未配置 ToolExecutor，跳过')
      break
    }

    // 追加 assistant 消息
    messages.push({
      role: 'assistant',
      content: turnText || (null as unknown as string),
    })

    let shouldTerminate = false

    // ── 执行 FC tool_calls ──
    for (const tc of collectedCalls) {
      if (!tc) continue

      // 取消检测
      if (params.cancelChecker?.isCancelled(sessionId)) {
        logger.info('工具执行阶段被取消')
        break
      }

      const fnName = tc.function.name
      let fnArgs: Record<string, unknown> = {}
      try {
        fnArgs = JSON.parse(tc.function.arguments || '{}')
      } catch {
        logger.warn(`工具参数解析失败: ${fnName}`)
      }

      // 推送 SSE: tool_call
      yield {
        event: 'tool_call',
        data: { name: fnName, args: fnArgs },
      }
      yield {
        event: 'status',
        data: { state: 'calling', message: `正在调用工具: ${fnName}`, turn: turn + 1 },
      }

      logger.info(`执行工具: ${fnName}`)
      logger.debug(`[工具调用] ${fnName} 参数: ${truncate(JSON.stringify(fnArgs), 4000)}`)
      const result = await toolExecutor.execute(fnName, fnArgs, source)
      logger.debug(
        `[工具返回] ${fnName} (${result.durationMs}ms, error=${result.isError}): ${truncate(result.output, 8000)}`,
      )

      allToolCalls.push({
        name: fnName,
        args: fnArgs,
        result: result.output,
        durationMs: result.durationMs,
      })

      // 推送 SSE: tool_result
      yield {
        event: 'tool_result',
        data: {
          name: fnName,
          result: result.output.slice(0, 2000),
          isError: result.isError,
          durationMs: result.durationMs,
        },
      }

      messages.push({
        role: 'tool',
        content: result.output,
        tool_call_id: tc.id,
      })

      if (result.isError) {
        consecutiveErrors++
        logger.warn(`工具执行错误 (连续 ${consecutiveErrors} 次): ${fnName}`)
      } else {
        consecutiveErrors = 0
      }

      if (result.shouldTerminate) {
        shouldTerminate = true
        break
      }
    }

    // 熔断保护
    if (consecutiveErrors >= errorThreshold) {
      logger.error(`连续错误达到 ${errorThreshold} 次，强制终止`)
      messages.push({
        role: 'system',
        content:
          '【系统紧急干预】监测到你已经连续操作失败多次。' +
          '请立即停止任何后续的思考与工具调用，放弃当前任务，并主动向主人汇报失败原因。',
      })
      currentTools = undefined // 禁用后续工具调用
    }

    if (shouldTerminate) {
      logger.info('ReAct 循环由 finish_task 终止')
      break
    }
  }

  return allToolCalls
}
