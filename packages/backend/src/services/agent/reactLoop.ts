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
import type { ChatMessage, ToolCallRecord, ToolDefinition } from '../pipeline/types'
import { SYSTEM_PROTOCOL_TOOLS } from '../../tools/systemProtocolTools'
import { EXPAND_ADVANCED_TOOLS, isAdvancedTool } from '../../tools/advancedTools'
import type { CapabilityScope } from '../../capabilities/types'
import type { ChatDelta } from '../llm/types'
import { ThinkingStreamFilter } from '../../nit/streamFilter'
import { createLogger } from '../../lib/logger'
import { currentKernelExecution } from '../../kernel/executionContext'

const logger = createLogger('ReActLoop')

/** 完整结果仅用于当前 ReAct 的读取类工具；持久化时必须替换为无正文审计摘要。 */
const EPHEMERAL_READ_TOOLS = new Set(['read_file', 'read_file_range'])
const TOOL_ARGUMENT_STREAM_PREVIEW_LIMIT = 2048

/**
 * 将工具结果转换为可长期保存的审计结果。
 * 读取正文只活在当前 ReAct 内存；数据库与 raw transcript 仅记录路径、范围、哈希和规模。
 */
export function toolResultForPersistence(
  name: string,
  args: Record<string, unknown>,
  output: string,
  isError: boolean,
): string {
  if (!EPHEMERAL_READ_TOOLS.has(name) || isError) return output

  const filePath = String(args.path ?? args.file_path ?? '')
  if (name === 'read_file_range') {
    try {
      const result = JSON.parse(output) as Record<string, unknown>
      return JSON.stringify({
        ephemeral: true,
        kind: 'file_read_audit',
        path: filePath,
        hash: result.hash,
        totalBytes: result.totalBytes,
        totalLines: result.totalLines,
        lineStart: result.lineStart ?? args.line_start,
        lineEnd: result.lineEnd ?? args.line_end,
        nextOffset: result.nextOffset,
        truncated: result.truncated,
        returnedCharacters: typeof result.content === 'string' ? result.content.length : 0,
      })
    } catch {
      // 非标准返回仍只记录规模，绝不把正文写入审计数据。
    }
  }

  return JSON.stringify({
    ephemeral: true,
    kind: 'file_read_audit',
    path: filePath,
    maxLength: args.max_length,
    returnedCharacters: output.length,
  })
}

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

/** 模式对应的默认最大轮次（AIOS 第八阶段：清理 work 残留） */
const MODE_MAX_TURNS: Record<string, number> = {
  desktop: 30,
  ide: 30,
  social: 2,
  group: 2,
  scheduler: 1,
}

// ─────────────────────────────────────────────
// SSE 事件
// ─────────────────────────────────────────────

import type { ConversationContentBlock } from '@infos/shared'

/** ReAct产出的结构化事件。 */
export type SseEvent =
  | {
      event: 'thinking_start'
      data: { blockId: string; turn: number }
    }
  | {
      event: 'thinking_delta'
      data: { blockId: string; turn: number; delta: string }
    }
  | {
      event: 'thinking_end'
      data: { blockId: string; turn: number; durationMs: number }
    }
  | {
      event: 'native_reasoning_start'
      data: { blockId: string; turn: number; mode: 'stream' | 'non_stream' }
    }
  | {
      event: 'native_reasoning_delta'
      data: { blockId: string; turn: number; delta: string }
    }
  | {
      event: 'native_reasoning_end'
      data: { blockId: string; turn: number; durationMs: number }
    }
  | {
      event: 'narration_start'
      data: { blockId: string; turn: number }
    }
  | {
      event: 'narration_delta'
      data: { blockId: string; turn: number; delta: string }
    }
  | {
      event: 'narration_end'
      data: { blockId: string; turn: number; phase: 'progress' | 'final' }
    }
  | {
      event: 'tool_call_start'
      data: { draftId: string; turn: number; index: number }
    }
  | {
      event: 'tool_call_delta'
      data: {
        draftId: string
        turn: number
        nameDelta?: string
        argumentsDelta?: string
        receivedChars: number
      }
    }
  | {
      event: 'tool_call_ready'
      data: { draftId: string; callId: string; turn: number; name: string; args: unknown }
    }
  | {
      event: 'tool_call' | 'tool_result' | 'status'
      data: unknown
    }

/** ReAct循环只产出结构化Timeline事件。 */
export type ReActYield = SseEvent

// ─────────────────────────────────────────────
// Tool Executor 接口
// ─────────────────────────────────────────────

/**
 * 工具执行器接口
 *
 * AIOS: execute 新增 threadId + channel 参数，工具执行可感知 Thread 上下文。
 * - source 保留向后兼容（等价于 channel）
 * - 新代码应优先使用 threadId + channel
 */
export interface ToolExecutor {
  execute(
    name: string,
    args: Record<string, unknown>,
    source: string,
    context?: {
      threadId?: string
      channel?: string
      /**
       * 第七阶段修复（批次 B1）：工具权限校验依赖的 Agent 身份。
       * 必须透传，否则 ToolExecutor 会退回硬编码兜底值，导致多 Agent 权限隔离失效。
       */
      agentId?: string
      /** 会话 ID（Skill 解锁状态按会话隔离） */
      sessionId?: string
      signal?: AbortSignal
      taskId?: string
      executionId?: import('@infos/shared').KernelExecutionId
      processId?: import('@infos/shared').KernelProcessId
      deadline?: string
      pairId?: string
      toolCallId?: string
      disabledTools?: string[]
      autoExecuteTools?: boolean
    },
  ): Promise<ToolExecutionResult>
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  output: string
  durationMs: number
  isError: boolean
  /** finish_task 终止信号 */
  shouldTerminate: boolean
  /** 用户批准后写给 Agent 的附言；与工具原始输出分离，避免破坏 JSON 工具协议。 */
  approvalObservation?: string
}

/** 取消检测器接口 (TaskManager 提供) */
export interface CancelChecker {
  isCancelled(sessionId: string): boolean
  checkPause?(sessionId: string): Promise<void>
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
  refreshToolDefinitions?: () => ToolDefinition[]
  clearDynamicCapabilities?: () => void
  source: string
  sessionId?: string
  /**
   * 第七阶段修复（批次 B1）：当前对话归属的 Agent ID。
   * 透传给 ToolExecutor 用于工具权限校验，缺失时权限会退回默认 Agent 配置。
   */
  agentId?: string
  /**
   * AIOS: Thread 上下文，透传给 ToolExecutor。
   * - threadId: 当前对话 Thread ID
   * - channel: 当前对话通道（desktop/social/group）
   */
  threadContext?: {
    threadId?: string
    channel?: string
    taskId?: string
    realmId?: string
    executionId?: import('@infos/shared').KernelExecutionId
    processId?: import('@infos/shared').KernelProcessId
    deadline?: string
    pairId?: string
    disabledTools?: string[]
    autoExecuteTools?: boolean
    capabilityScope?: CapabilityScope
  }
  cancelChecker?: CancelChecker
  signal?: AbortSignal
  /** 截图转述回调：原始截图仅在内存中传递，不负责持久化。 */
  transcribeScreenshots?: (
    dataUris: string[],
  ) => Promise<{ summary: string; modelId: string } | null>
  /** 截图文字档案持久化回调。 */
  onScreenshotTranscription?: (summary: string, modelId: string) => Promise<void>
  /** 每次工具调用完成后的可恢复检查点；调用方负责持久化。 */
  onCheckpoint?: (checkpoint: {
    messages: ChatMessage[]
    toolCalls: ToolCallRecord[]
    turn: number
  }) => Promise<void>
  /** 向统一Scheduler报告LLM、Token与Tool增量。 */
  onUsage?: (usage: {
    llmCalls?: number
    inputTokens?: number
    outputTokens?: number
    toolCalls?: number
  }) => void
  /** 工具I/O开始时获取结束回调，用于并发预算。 */
  beginIo?: () => () => void
  config?: Partial<ReActConfig>
}): AsyncGenerator<
  ReActYield,
  {
    toolCalls: ToolCallRecord[]
    messages: ChatMessage[]
    rawText: string
    contentBlocks: ConversationContentBlock[]
  }
> {
  const { llmService, modelConfig, messages, source, toolExecutor } = params
  const maxTurns = params.config?.maxTurns ?? MODE_MAX_TURNS[source] ?? 30
  const errorThreshold = params.config?.errorThreshold ?? 3
  const sessionId = params.threadContext?.executionId ?? params.sessionId ?? 'default'

  // 第七阶段修复（批次 B1）：构造透传给 ToolExecutor 的完整运行时上下文
  // 把 agentId / sessionId 与 threadContext 合并，确保工具权限校验拿到正确的 Agent 身份
  const toolRuntimeContext = {
    ...params.threadContext,
    agentId: params.agentId,
    sessionId,
    signal: params.signal,
  }

  logger.debug(
    `ReAct modelConfig: modelId=${modelConfig.modelId} enableVision=${modelConfig.enableVision}`,
  )

  const allToolCalls: ToolCallRecord[] = []
  const contentBlocks: ConversationContentBlock[] = []
  let blockSequence = 0
  let consecutiveErrors = 0
  const allAvailableTools = params.tools ?? []
  const finishTaskTool = allAvailableTools.find((tool) => tool.name === 'finish_task')
  const advancedTools = allAvailableTools.filter((tool) => isAdvancedTool(tool.name))
  let currentTools = allAvailableTools.filter(
    (tool) => !isAdvancedTool(tool.name) && tool.name !== 'finish_task',
  )
  let finishTaskAvailable = false
  let advancedToolsExpanded = false
  /** 是否已经向用户流式输出过可见正文（Thinking 不计入）。 */
  let hasVisibleReply = false
  // 完整原始转写：保留每一轮未过滤的 LLM 输出 (含 Thinking 块) + 工具调用/返回摘要，
  // 供「对话调试详情」查看内部构造 (区别于给用户看的、已剥离 Thinking 的可见回复)。
  let rawTranscript = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    await params.cancelChecker?.checkPause?.(sessionId)
    // 每轮开始前检测取消
    if (params.signal?.aborted || params.cancelChecker?.isCancelled(sessionId)) {
      logger.info('ReAct 循环被用户取消')
      break
    }

    logger.debug(
      `ReAct 第 ${turn + 1} 轮开始 (messages=${messages.length}, tools=${currentTools?.length ?? 0})`,
    )
    // 调试：检查 messages 末尾几条的类型
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
        let contentStr: string
        if (typeof lastMsg.content === 'string') {
          contentStr = lastMsg.content
        } else if (Array.isArray(lastMsg.content)) {
          // 多模态内容块：把 image_url 替换为占位符，避免日志里打印超长 base64
          contentStr = JSON.stringify(
            lastMsg.content.map((block) => {
              if (block.type === 'image_url') {
                return {
                  type: 'image_url',
                  image_url: { url: '[BASE64_IMAGE_DATA]', detail: block.image_url.detail },
                }
              }
              return block
            }),
          )
        } else {
          contentStr = JSON.stringify(lastMsg.content)
        }
        logger.debug(`[Context] 最新消息 [${lastMsg.role}]: ${truncate(contentStr, 4000)}`)
      }
    }

    // 推送状态: 思考中
    yield {
      event: 'status',
      data: { state: 'thinking', message: '正在思考...', turn: turn + 1 },
    }

    let turnText = ''
    let visibleTurnText = ''
    const narrationBlockId = `narration-${turn + 1}`
    let narrationStarted = false
    let turnReasoningContent = ''
    const turnNativeReasoning: import('../llm/types').NativeReasoningPayload[] = []
    const reasoningBlockId = `native-reasoning-${turn + 1}`
    const reasoningStartedAt = Date.now()
    let reasoningStarted = false
    const collectedCalls: Array<{
      id: string
      draftId: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = []
    let hasToolCalls = false

    // 是否已剥离开头杂质：部分模型 (如 gemini 系列经代理) 会在正文开头吐出孤立的
    // `}` / `]` 等闭合符 (内部推理/FC JSON 泄漏)，需在首个可见字符前清掉，避免污染前端显示与 TTS。
    let leadingStripped = false

    // ── 流式过滤器 (仅 Thinking 块) ──
    const thinkingFilter = new ThinkingStreamFilter()
    let thinkingSequence = 0
    let activeThinking:
      | { blockId: string; content: string; startedAt: number; ended: boolean }
      | undefined
    const completedThinking: Array<{
      blockId: string
      content: string
      durationMs: number
    }> = []

    // ── 流式 LLM 调用 ──
    // 注意: tool 消息的 content 必须是字符串；user/assistant 消息可以包含 image_url 块
    const llmMessages = messages.map((m) => ({
      role: m.role,
      content:
        m.role === 'tool'
          ? typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content)
          : m.content,
      toolCallId: m.toolCallId,
      toolCalls: m.toolCalls,
      reasoningContent: m.reasoningContent,
      nativeReasoning: m.nativeReasoning,
    }))

    if (!currentKernelExecution()) params.onUsage?.({ llmCalls: 1 })
    let reportedInputTokens = 0
    let reportedOutputTokens = 0
    const modelDeltas =
      modelConfig.stream === false
        ? llmService.chatConfigured(modelConfig, llmMessages, {
            signal: params.signal,
            tools: currentTools
              ? currentTools.map((t) => ({
                  type: 'function' as const,
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                }))
              : undefined,
          })
        : llmService.chatStream(modelConfig, llmMessages, {
            signal: params.signal,
            tools: currentTools
              ? currentTools.map((t) => ({
                  type: 'function' as const,
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                }))
              : undefined,
          })
    for await (const delta of modelDeltas as AsyncIterable<ChatDelta>) {
      if (delta.usage) {
        const inputTokens = Math.max(0, delta.usage.promptTokens - reportedInputTokens)
        const outputTokens = Math.max(0, delta.usage.completionTokens - reportedOutputTokens)
        if (!currentKernelExecution() && (inputTokens || outputTokens)) {
          params.onUsage?.({ inputTokens, outputTokens })
        }
        reportedInputTokens = Math.max(reportedInputTokens, delta.usage.promptTokens)
        reportedOutputTokens = Math.max(reportedOutputTokens, delta.usage.completionTokens)
      }
      const choice = delta.choices[0]
      if (!choice) continue

      const reasoningContent = choice.delta.reasoningContent
      if (choice.delta.nativeReasoning) turnNativeReasoning.push(...choice.delta.nativeReasoning)
      if (reasoningContent) {
        turnReasoningContent += reasoningContent
        if (modelConfig.returnNativeReasoning) {
          if (!reasoningStarted) {
            reasoningStarted = true
            yield {
              event: 'native_reasoning_start',
              data: {
                blockId: reasoningBlockId,
                turn: turn + 1,
                mode: modelConfig.stream === false ? 'non_stream' : 'stream',
              },
            }
          }
          yield {
            event: 'native_reasoning_delta',
            data: { blockId: reasoningBlockId, turn: turn + 1, delta: reasoningContent },
          }
        }
      }

      // 收集文本
      const content = choice.delta.content
      if (content) {
        turnText += content

        // 流式过滤并按原始顺序发布正文与<think>碎碎念块。
        thinkingFilter.filter(content)
        for (const event of thinkingFilter.drainEvents()) {
          if (event.type === 'text') {
            let text = event.text
            if (text && !leadingStripped) {
              text = text.replace(/^[\s}\])）】]+/, '')
              if (text) leadingStripped = true
            }
            if (text) {
              if (!narrationStarted) {
                narrationStarted = true
                yield {
                  event: 'narration_start',
                  data: { blockId: narrationBlockId, turn: turn + 1 },
                }
              }
              visibleTurnText += text
              hasVisibleReply = true
              yield {
                event: 'narration_delta',
                data: { blockId: narrationBlockId, turn: turn + 1, delta: text },
              }
            }
          } else if (event.type === 'start') {
            const blockId = `thinking-${turn + 1}-${++thinkingSequence}`
            activeThinking = { blockId, content: '', startedAt: Date.now(), ended: false }
            yield { event: 'thinking_start', data: { blockId, turn: turn + 1 } }
          } else if (event.type === 'delta' && activeThinking) {
            activeThinking.content += event.delta
            yield {
              event: 'thinking_delta',
              data: { blockId: activeThinking.blockId, turn: turn + 1, delta: event.delta },
            }
          } else if (event.type === 'end' && activeThinking && !activeThinking.ended) {
            activeThinking.ended = true
            const durationMs = Date.now() - activeThinking.startedAt
            completedThinking.push({
              blockId: activeThinking.blockId,
              content: activeThinking.content,
              durationMs,
            })
            yield {
              event: 'thinking_end',
              data: { blockId: activeThinking.blockId, turn: turn + 1, durationMs },
            }
            activeThinking = undefined
          }
        }
      }

      // ── 收集 FC tool_calls (多 tool_calls 增量组装) ──
      if (choice.delta.toolCalls) {
        hasToolCalls = true
        for (const tcDelta of choice.delta.toolCalls) {
          // 用 StreamToolCallDelta.index 定位正确的 slot
          const idx = tcDelta.index
          if (!collectedCalls[idx]) {
            const id = tcDelta.id || `tc-${Date.now()}-${idx}`
            const draftId = `tool-draft-${turn + 1}-${idx}`
            collectedCalls[idx] = {
              id,
              draftId,
              type: 'function',
              function: { name: '', arguments: '' },
            }
            yield { event: 'tool_call_start', data: { draftId, turn: turn + 1, index: idx } }
          }
          const target = collectedCalls[idx]!
          const nameDelta = tcDelta.function?.name ?? ''
          const argumentsDelta = tcDelta.function?.arguments ?? ''
          if (tcDelta.id) target.id = tcDelta.id
          if (nameDelta) target.function.name += nameDelta
          if (argumentsDelta) target.function.arguments += argumentsDelta
          const nextReceivedChars = target.function.arguments.length
          const previousReceivedChars = nextReceivedChars - argumentsDelta.length
          const withinPreview = previousReceivedChars < TOOL_ARGUMENT_STREAM_PREVIEW_LIMIT
          const crossedProgressBoundary =
            Math.floor(previousReceivedChars / 4096) !== Math.floor(nextReceivedChars / 4096)
          if (nameDelta || withinPreview || crossedProgressBoundary) {
            yield {
              event: 'tool_call_delta',
              data: {
                draftId: target.draftId,
                turn: turn + 1,
                nameDelta: nameDelta || undefined,
                argumentsDelta: withinPreview
                  ? argumentsDelta.slice(
                      0,
                      TOOL_ARGUMENT_STREAM_PREVIEW_LIMIT - previousReceivedChars,
                    ) || undefined
                  : undefined,
                receivedChars: nextReceivedChars,
              },
            }
          }
        }
      }
    }

    // ── 流式过滤器刷新 ──
    thinkingFilter.flush()
    for (const event of thinkingFilter.drainEvents()) {
      if (event.type === 'text') {
        let text = event.text
        if (text && !leadingStripped) {
          text = text.replace(/^[\s}\])）】]+/, '')
          if (text) leadingStripped = true
        }
        if (text) {
          if (!narrationStarted) {
            narrationStarted = true
            yield { event: 'narration_start', data: { blockId: narrationBlockId, turn: turn + 1 } }
          }
          visibleTurnText += text
          hasVisibleReply = true
          yield {
            event: 'narration_delta',
            data: { blockId: narrationBlockId, turn: turn + 1, delta: text },
          }
        }
      } else if (event.type === 'delta' && activeThinking) {
        activeThinking.content += event.delta
        yield {
          event: 'thinking_delta',
          data: { blockId: activeThinking.blockId, turn: turn + 1, delta: event.delta },
        }
      } else if (event.type === 'end' && activeThinking && !activeThinking.ended) {
        activeThinking.ended = true
        const durationMs = Date.now() - activeThinking.startedAt
        completedThinking.push({
          blockId: activeThinking.blockId,
          content: activeThinking.content,
          durationMs,
        })
        yield {
          event: 'thinking_end',
          data: { blockId: activeThinking.blockId, turn: turn + 1, durationMs },
        }
        activeThinking = undefined
      }
    }
    for (const thinking of completedThinking) {
      contentBlocks.push({
        blockId: thinking.blockId,
        sequence: ++blockSequence,
        kind: 'thinking',
        turn: turn + 1,
        content: thinking.content,
        durationMs: thinking.durationMs,
      })
    }
    if (reasoningStarted) {
      const durationMs = Date.now() - reasoningStartedAt
      contentBlocks.push({
        blockId: reasoningBlockId,
        sequence: ++blockSequence,
        kind: 'native_reasoning',
        turn: turn + 1,
        content: turnReasoningContent,
        mode: modelConfig.stream === false ? 'non_stream' : 'stream',
        durationMs,
      })
      yield {
        event: 'native_reasoning_end',
        data: { blockId: reasoningBlockId, turn: turn + 1, durationMs },
      }
    }
    if (narrationStarted) {
      const phase = hasToolCalls ? 'progress' : 'final'
      contentBlocks.push({
        blockId: narrationBlockId,
        sequence: ++blockSequence,
        kind: 'narration',
        turn: turn + 1,
        phase,
        content: visibleTurnText,
      })
      yield { event: 'narration_end', data: { blockId: narrationBlockId, turn: turn + 1, phase } }
    }

    // 打印 LLM 原始回复文本（含 <think> 思考块，供终端调试查看内部思考过程）
    // 注意：yield 给前端的内容已被 ThinkingStreamFilter 过滤，这里打印的是未过滤的原始文本
    // 使用 info 级别：debug 级别在生产环境 (PERO_LOG_LEVEL=3) 会被过滤，导致终端看不到思考内容
    if (turnText) {
      logger.info(`[LLM原始回复] ${truncate(turnText, 4000)}`)
      // 累积到原始转写 (保留 Thinking 块，供调试视图查看)
      // 剥离前导空白，避免 Debug View 显示缩进异常
      const cleanText = turnText.replace(/^[\s}\])）】]+/, '')
      rawTranscript += (rawTranscript ? '\n' : '') + cleanText
    }

    // ── 无工具调用 → 正常结束 ──
    if (!hasToolCalls) {
      if (!turnText.trim() && turn === 0) {
        const fallback = '⚠️ AI 没有返回有效内容。请检查网络连接或 API Key 配置。'
        const blockId = `narration-${turn + 1}-fallback`
        contentBlocks.push({
          blockId,
          sequence: ++blockSequence,
          kind: 'narration',
          turn: turn + 1,
          phase: 'final',
          content: fallback,
        })
        yield { event: 'narration_start', data: { blockId, turn: turn + 1 } }
        yield { event: 'narration_delta', data: { blockId, turn: turn + 1, delta: fallback } }
        yield { event: 'narration_end', data: { blockId, turn: turn + 1, phase: 'final' } }
      }
      break
    }

    // ── 需要执行工具但没有 Executor ──
    if (!toolExecutor) {
      logger.warn('有工具调用但未配置 ToolExecutor，跳过')
      break
    }

    // 追加 assistant 消息
    // 必须携带 toolCalls！否则后续 role:'tool' 工具结果 / 截图 user 消息会成为「孤儿消息」，
    // 被厂商 API 报错丢弃或忽略，导致多模态模型读不到截图。
    messages.push({
      role: 'assistant',
      content: turnText || null,
      // 工具续轮一律保留reasoning_content键；部分思考模型即使本轮未返回内容也要求显式空串。
      reasoningContent: turnReasoningContent,
      ...(turnNativeReasoning.length ? { nativeReasoning: turnNativeReasoning } : {}),
      toolCalls: collectedCalls
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.function.name, arguments: c.function.arguments },
        })),
    })

    let shouldTerminate = false

    // ── 执行 FC tool_calls ──
    for (const tc of collectedCalls) {
      if (!tc) continue
      params.onUsage?.({ toolCalls: 1 })

      await params.cancelChecker?.checkPause?.(sessionId)
      // 取消检测
      if (params.cancelChecker?.isCancelled(sessionId)) {
        logger.info('工具执行阶段被取消')
        break
      }

      const fnName = tc.function.name
      if (fnName === 'finish_task' && !finishTaskAvailable) {
        const errorMsg =
          'finish_task当前尚未开放。请直接流式输出自然语言回复；只有执行真实业务工具后才可使用该工具。'
        yield {
          event: 'tool_result',
          data: { name: fnName, callId: tc.id, result: errorMsg, isError: true, durationMs: 0 },
        }
        messages.push({ role: 'tool', content: errorMsg, toolCallId: tc.id })
        allToolCalls.push({
          name: fnName,
          args: {},
          result: errorMsg,
          durationMs: 0,
          isError: true,
          callId: tc.id,
        })
        consecutiveErrors++
        continue
      }
      let fnArgs: Record<string, unknown> = {}
      let parseError: string | null = null
      try {
        fnArgs = JSON.parse(tc.function.arguments || '{}')
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err)
        logger.warn(`工具参数解析失败: ${fnName} - ${parseError}`)
      }

      yield {
        event: 'tool_call_ready',
        data: {
          draftId: tc.draftId,
          callId: tc.id,
          turn: turn + 1,
          name: fnName,
          args: fnArgs,
        },
      }

      const toolBlock: Extract<ConversationContentBlock, { kind: 'tool' }> = {
        blockId: `tool-${tc.id}`,
        sequence: ++blockSequence,
        kind: 'tool',
        turn: turn + 1,
        callId: tc.id,
        name: fnName,
        args: JSON.stringify(fnArgs),
      }
      contentBlocks.push(toolBlock)

      // 第七阶段 #8: 参数解析失败时，把错误作为 tool_result 反馈给 LLM
      // 而非吞掉错误以空参数调用工具（会导致工具执行异常或无意义结果）
      if (parseError) {
        const errorMsg = `工具 "${fnName}" 参数解析失败：${parseError}\n原始参数: ${truncate(tc.function.arguments || '', 500)}\n请检查参数是否为合法 JSON 格式后重试。`
        yield { event: 'tool_call', data: { name: fnName, args: {}, callId: tc.id } }
        yield {
          event: 'tool_result',
          data: { name: fnName, callId: tc.id, result: errorMsg, isError: true, durationMs: 0 },
        }
        toolBlock.result = errorMsg
        toolBlock.isError = true
        toolBlock.durationMs = 0
        rawTranscript +=
          (rawTranscript ? '\n' : '') +
          `⟦TOOL⟧${fnName}\n参数: (解析失败)\n返回 (0ms, error): ${truncate(errorMsg, 4000)}\n⟦/TOOL⟧`
        messages.push({
          role: 'tool',
          content: errorMsg,
          toolCallId: tc.id,
        })
        allToolCalls.push({
          name: fnName,
          args: {},
          result: errorMsg,
          durationMs: 0,
          isError: true,
          callId: tc.id,
        })
        consecutiveErrors++
        await params.onCheckpoint?.({
          messages: structuredClone(messages),
          toolCalls: [...allToolCalls],
          turn: turn + 1,
        })
        continue
      }

      // 推送 SSE: tool_call
      yield {
        event: 'tool_call',
        data: { name: fnName, args: fnArgs, callId: tc.id },
      }
      yield {
        event: 'status',
        data: { state: 'calling', message: `正在调用工具: ${fnName}`, turn: turn + 1 },
      }

      logger.info(`执行工具: ${fnName}`)
      logger.debug(`[工具调用] ${fnName} 参数: ${truncate(JSON.stringify(fnArgs), 4000)}`)
      // AIOS: 透传 Thread 上下文给工具执行器
      // 第七阶段修复（批次 B1）：使用合并了 agentId/sessionId 的完整运行时上下文
      let result: Awaited<ReturnType<ToolExecutor['execute']>>
      if (isAdvancedTool(fnName) && !advancedToolsExpanded) {
        result = {
          output: '高级工具尚未展开。请先调用 expand_advanced_tools，再执行此工具。',
          durationMs: 0,
          isError: true,
          shouldTerminate: false,
        }
      } else {
        const endIo = params.beginIo?.()
        try {
          result = await toolExecutor.execute(fnName, fnArgs, source, {
            ...toolRuntimeContext,
            toolCallId: tc.id,
          })
        } finally {
          endIo?.()
        }
      }
      const persistentToolResult = toolResultForPersistence(
        fnName,
        fnArgs,
        result.output,
        result.isError,
      )
      logger.debug(
        `[工具返回] ${fnName} (${result.durationMs}ms, error=${result.isError}): ${truncate(persistentToolResult, 8000)}`,
      )

      allToolCalls.push({
        name: fnName,
        args: fnArgs,
        result: persistentToolResult,
        durationMs: result.durationMs,
        isError: result.isError,
        callId: tc.id,
      })

      if (fnName === 'load_skill' && !result.isError && params.refreshToolDefinitions) {
        const refreshed = params.refreshToolDefinitions()
        const refreshedAdvanced = refreshed.filter((tool) => isAdvancedTool(tool.name))
        currentTools = refreshed.filter(
          (tool) =>
            !isAdvancedTool(tool.name) &&
            tool.name !== 'finish_task' &&
            !currentTools.some((current) => current.name === tool.name),
        )
        currentTools = [
          ...new Map(
            [
              ...allAvailableTools.filter(
                (tool) => !isAdvancedTool(tool.name) && tool.name !== 'finish_task',
              ),
              ...currentTools,
              ...(advancedToolsExpanded ? refreshedAdvanced : []),
              ...(finishTaskAvailable && finishTaskTool ? [finishTaskTool] : []),
            ].map((tool) => [tool.name, tool]),
          ).values(),
        ]
        logger.info(`Skill加载后已刷新工具定义，当前可见 ${currentTools.length} 个工具`)
      }

      if (!finishTaskAvailable && finishTaskTool && !SYSTEM_PROTOCOL_TOOLS.has(fnName)) {
        finishTaskAvailable = true
        currentTools = [...currentTools, finishTaskTool]
        logger.debug(`真实工具 ${fnName} 已执行，下一轮开放 finish_task`)
      }

      if (fnName === EXPAND_ADVANCED_TOOLS && !result.isError && !advancedToolsExpanded) {
        advancedToolsExpanded = true
        currentTools = [...currentTools, ...advancedTools]
        logger.info(`高级工具列表已展开，本次ReAct新增 ${advancedTools.length} 个工具定义`)
      }

      // ── 截图工具特殊处理：把 base64 从工具文本里剥离，转为 image_url 内容块 ──
      // 多模态模型无法从 role:'tool' 的纯文本里"看到"图片，必须以 image_url 块形式放进 user 消息。
      // 注意：base64 绝不能塞回 tool 文本 / SSE，否则既污染上下文、爆 token，模型也只会看到一堆乱码。
      let screenshotImages: Array<{
        type: 'image_url'
        image_url: { url: string; detail: string }
      }> = []
      let toolResultText = result.output

      if (
        fnName === 'take_screenshot' ||
        fnName === 'browser_screenshot' ||
        fnName === 'browser_page_image'
      ) {
        try {
          const parsed = JSON.parse(result.output)
          const screenshots: Array<{
            index: number
            dataUri: string
            coordinateContext?: {
              displayId: string
              coordinateSpace: 'screenshot'
              screenshotWidth: number
              screenshotHeight: number
              scaleFactor: number
            }
          }> = parsed?.screenshots
          if (Array.isArray(screenshots) && screenshots.length > 0) {
            const coordinateGuidance = screenshots
              .map((s) => s.coordinateContext)
              .filter((context) => context != null)
              .map(
                (context) =>
                  `截图坐标上下文：coordinateSpace=${context.coordinateSpace}, ` +
                  `displayId=${context.displayId}, screenshotWidth=${context.screenshotWidth}, ` +
                  `screenshotHeight=${context.screenshotHeight}, scaleFactor=${context.scaleFactor}`,
              )
              .join('\n')
            const transcription = params.transcribeScreenshots
              ? await params.transcribeScreenshots(screenshots.map((s) => s.dataUri))
              : null
            if (transcription) {
              await params.onScreenshotTranscription?.(transcription.summary, transcription.modelId)
            }
            if (modelConfig.enableVision) {
              screenshotImages = screenshots.map((s) => ({
                type: 'image_url' as const,
                image_url: { url: s.dataUri, detail: 'low' as const },
              }))
              // 工具文本只保留摘要，base64 已转入 image_url 块
              toolResultText =
                (parsed.message || `已获取 ${screenshots.length} 张屏幕截图`) +
                (coordinateGuidance ? `\n${coordinateGuidance}` : '') +
                (transcription ? `\n图片文字转述：${transcription.summary}` : '')
              logger.info(`截图已提取 ${screenshots.length} 张，转为 image_url 注入 user 消息`)
            } else if (transcription) {
              toolResultText = `已截取 ${screenshots.length} 张屏幕截图。专用多模态模型转述如下：\n${transcription.summary}`
              logger.info('当前主模型无视觉能力，已使用多模态转述文字替代截图原图')
            } else {
              // 模型未启用视觉且转述不可用：剥离 base64，避免把超长数据灌给模型
              toolResultText = `已截取 ${screenshots.length} 张屏幕截图，但当前模型未启用视觉能力，无法识别图片内容。请在模型配置中开启「视觉 / 多模态」后重试。`
              logger.warn(
                'take_screenshot 已执行，但当前模型 enableVision=false，跳过图片注入并剥离 base64',
              )
            }
          }
        } catch {
          // JSON 解析失败，降级为原始文本输出
        }
      }

      // 推送 SSE: tool_result (仅文本，不包含 base64)
      yield {
        event: 'tool_result',
        data: {
          name: fnName,
          callId: tc.id,
          result: toolResultText.slice(0, 2000),
          isError: result.isError,
          durationMs: result.durationMs,
        },
      }

      toolBlock.result = toolResultText.slice(0, 8000)
      toolBlock.isError = result.isError
      toolBlock.durationMs = result.durationMs

      // 累积工具调用审计到原始转写。读取类工具使用脱敏审计摘要，正文只存在于当前 ReAct 内存。
      // 用 ⟦TOOL⟧…⟦/TOOL⟧ 哨兵包裹：这对符号不会出现在 JSON 参数/返回里，
      // 避免和前端 Thinking/NIT 的方括号正则相互截断。
      const transcriptResult = EPHEMERAL_READ_TOOLS.has(fnName)
        ? persistentToolResult
        : toolResultText
      rawTranscript +=
        (rawTranscript ? '\n' : '') +
        `⟦TOOL⟧${fnName}\n` +
        `参数: ${truncate(JSON.stringify(fnArgs), 2000)}\n` +
        `返回 (${result.durationMs}ms${result.isError ? ', error' : ''}): ${truncate(transcriptResult, 4000)}\n` +
        `⟦/TOOL⟧`

      // 1. 工具结果消息（role: tool，文本）；审批附言单独注入，避免破坏 JSON 工具结果。
      messages.push({
        role: 'tool',
        content: result.approvalObservation
          ? `${result.approvalObservation}\n${toolResultText}`
          : toolResultText,
        toolCallId: tc.id,
      })

      // 2. 截图注入：模型通过 user 消息的 image_url 块看到图片
      if (screenshotImages.length > 0) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text' as const,
              text: '【系统】以下是刚刚截取的屏幕截图，请直接分析：',
            },
            ...screenshotImages,
          ],
        })
        logger.debug(`已将 ${screenshotImages.length} 张截图注入 user 消息`)
      }

      if (result.isError) {
        consecutiveErrors++
        logger.warn(`工具执行错误 (连续 ${consecutiveErrors} 次): ${fnName}`)
      } else {
        consecutiveErrors = 0
      }

      await params.onCheckpoint?.({
        messages: structuredClone(messages),
        toolCalls: [...allToolCalls],
        turn: turn + 1,
      })

      if (result.shouldTerminate) {
        // finish_task.reply始终作为独立最终交付；仅与本轮已显示正文完全重复时去重。
        if (fnName === 'finish_task') {
          const reply = typeof fnArgs.reply === 'string' ? fnArgs.reply.trim() : ''
          if (reply && reply !== visibleTurnText.trim()) {
            const blockId = `narration-${turn + 1}-finish`
            contentBlocks.push({
              blockId,
              sequence: ++blockSequence,
              kind: 'narration',
              turn: turn + 1,
              phase: 'final',
              content: reply,
            })
            hasVisibleReply = true
            yield { event: 'narration_start', data: { blockId, turn: turn + 1 } }
            yield { event: 'narration_delta', data: { blockId, turn: turn + 1, delta: reply } }
            yield { event: 'narration_end', data: { blockId, turn: turn + 1, phase: 'final' } }
          } else if (!reply && !hasVisibleReply) {
            logger.warn('finish_task缺少reply正文，且模型未输出可见回复，用户可能收不到本次答复')
          }
        }
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
          '请立即停止任何后续的思考与工具调用，放弃当前任务，并主动向用户汇报失败原因。',
      })
      currentTools = [] // 禁用后续工具调用
      yield {
        event: 'status',
        data: { state: 'tool_failed', message: '工具连续失败，已停止自动调用工具并准备汇报原因' },
      }
    }

    if (shouldTerminate) {
      logger.info('ReAct 循环由 finish_task 终止')
      break
    }
  }

  return { toolCalls: allToolCalls, messages, rawText: rawTranscript, contentBlocks }
}
