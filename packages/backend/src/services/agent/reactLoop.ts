/**
 * ReAct Loop — 推理-行动循环
 *
 * Agent 的核心推理引擎：
 * 1. 流式调用 LLM
 * 2. 收集 FC tool_calls 和 NIT 脚本块
 * 3. FC → 委托 ToolExecutor 执行
 * 4. NIT → 委托 NitRuntime 执行 (D57)
 * 5. 将结果注入上下文继续循环
 * 6. 熔断保护 (连续错误 ≥ 3 次)
 *
 * B6-2 升级:
 * - 多 tool_calls 增量组装 (使用 StreamToolCallDelta.index)
 * - NIT 执行超时保护 (默认 30s)
 * - SSE 事件推送 (tool_call / tool_result / status)
 * - TaskManager 取消检测
 * - finish_task 广播 Gateway
 *
 * 双轨工具调用：
 *   FC (原生): LLM tool_calls → ToolExecutor → ToolRegistry
 *   NIT v3:    LLM <nit>脚本</nit> → NitRuntime → ToolExecutor → ToolRegistry
 *   两条路径共享同一个 ToolRegistry，权限由 CapabilityGate 统一控制。
 *
 * @module packages/backend/src/services/agent/reactLoop
 */

import type { LlmService, ModelConfig } from '../llm/llmService'
import type { ChatMessage } from '../pipeline/types'
import type { ToolCallRecord, ToolDefinition } from '../pipeline/types'
import type { ChatDelta } from '../llm/types'
import { NitStreamFilter, ThinkingStreamFilter } from '../../nit/streamFilter'
import { executeNit } from '../../nit'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ReActLoop')

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
  /** 是否启用 NIT 脚本检测 (默认 true) */
  enableNit: boolean
  /** NIT 脚本执行超时 (ms, 默认 30s) */
  nitTimeoutMs: number
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

/** NIT 默认超时 (ms) */
const DEFAULT_NIT_TIMEOUT_MS = 30_000

// ─────────────────────────────────────────────
// SSE 事件 (02_API_RESPONSE_SPEC.md §9)
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
 * @yields 流式文本片段 / SSE 事件 (NIT 块和 Thinking 块已过滤)
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
  const enableNit = params.config?.enableNit ?? true
  const nitTimeoutMs = params.config?.nitTimeoutMs ?? DEFAULT_NIT_TIMEOUT_MS
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

    logger.debug(`ReAct 第 ${turn + 1} 轮开始`)

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

    // ── 流式过滤器 ──
    const nitFilter = enableNit ? new NitStreamFilter() : null
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

        // 流式过滤: NIT 块 → 隐藏, Thinking 块 → 隐藏
        let filtered = content
        if (nitFilter) {
          filtered = nitFilter.filter(filtered)
        }
        filtered = thinkingFilter.filter(filtered)
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
    let flushed = ''
    if (nitFilter) flushed += nitFilter.flush()
    flushed += thinkingFilter.flush()
    if (flushed) yield flushed

    // ── 检测 NIT v3 脚本 ──
    const hasNitScripts = nitFilter?.hasScripts() ?? false

    // ── 无工具调用也无 NIT 脚本 → 正常结束 ──
    if (!hasToolCalls && !hasNitScripts) {
      if (!turnText.trim() && turn === 0) {
        yield '⚠️ AI 没有返回有效内容。请检查网络连接或 API Key 配置。'
      }
      break
    }

    // ── 需要执行工具/脚本但没有 Executor ──
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

    // ── 执行 FC tool_calls (支持多个并行收集的调用) ──
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

      logger.info(`执行工具 (FC): ${fnName}`)
      const result = await toolExecutor.execute(fnName, fnArgs, source)

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

    // ── 执行 NIT v3 脚本 (带超时保护) ──
    if (!shouldTerminate && hasNitScripts) {
      const scripts = nitFilter!.getCollectedScripts()
      logger.info(`执行 ${scripts.length} 个 NIT v3 脚本`)

      // 推送状态: NIT 执行中
      yield {
        event: 'status',
        data: { state: 'calling', message: '正在执行 NIT 脚本...', turn: turn + 1 },
      }

      for (const script of scripts) {
        // 取消检测
        if (params.cancelChecker?.isCancelled(sessionId)) {
          logger.info('NIT 执行阶段被取消')
          break
        }

        const startTime = Date.now()
        try {
          // ── NIT 超时保护 ──
          const nitPromise = executeNit(script, async (name, args) => {
            const execResult = await toolExecutor.execute(name, args, source)
            return execResult.output
          })

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`NIT 脚本执行超时 (${nitTimeoutMs}ms)`)),
              nitTimeoutMs,
            )
          })

          const nitResult = await Promise.race([nitPromise, timeoutPromise])

          const durationMs = Date.now() - startTime
          const outputStr =
            typeof nitResult.value === 'string'
              ? nitResult.value
              : JSON.stringify(nitResult.value ?? null)

          // 记录 NIT 内部的所有工具调用
          for (const tc of nitResult.toolCalls) {
            allToolCalls.push({
              name: tc.name,
              args: tc.args as Record<string, unknown>,
              result: String(tc.result),
              durationMs: 0, // NIT 内部不单独记时
            })
          }

          // 将 NIT 执行结果注入上下文
          messages.push({
            role: 'tool',
            content: `[NIT 脚本执行结果 (${durationMs}ms)]\n${outputStr}`,
            tool_call_id: `nit-${turn}`,
          })

          // 推送 SSE: tool_result (NIT)
          yield {
            event: 'tool_result',
            data: {
              name: `nit-script-${turn}`,
              result: outputStr.slice(0, 2000),
              isError: false,
              durationMs,
              toolCallCount: nitResult.toolCalls.length,
            },
          }

          logger.info(
            `NIT 脚本执行完成 (${durationMs}ms, ${nitResult.toolCalls.length} 次工具调用)`,
          )
          consecutiveErrors = 0
        } catch (err) {
          consecutiveErrors++
          const errMsg = err instanceof Error ? err.message : String(err)
          logger.error(`NIT 脚本执行失败: ${errMsg}`)

          messages.push({
            role: 'tool',
            content: `[NIT 脚本执行失败] ${errMsg}`,
            tool_call_id: `nit-${turn}`,
          })

          // 推送 SSE: tool_result (NIT 失败)
          yield {
            event: 'tool_result',
            data: {
              name: `nit-script-${turn}`,
              result: errMsg,
              isError: true,
              durationMs: Date.now() - startTime,
            },
          }
        }
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
