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

/** 模式对应的默认最大轮次（AIOS 第八阶段：清理 work 残留） */
const MODE_MAX_TURNS: Record<string, number> = {
  desktop: 30,
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
  /**
   * 第七阶段修复（批次 B1）：当前对话归属的 Agent ID。
   * 透传给 ToolExecutor 用于工具权限校验，缺失时权限会退回默认 Agent 配置。
   */
  agentId?: string
  /**
   * AIOS: Thread 上下文，透传给 ToolExecutor。
   * - threadId: 当前对话 Thread ID
   * - channel: 当前对话通道（desktop/companion/social/group）
   */
  threadContext?: { threadId?: string; channel?: string }
  cancelChecker?: CancelChecker
  config?: Partial<ReActConfig>
}): AsyncGenerator<
  ReActYield,
  { toolCalls: ToolCallRecord[]; messages: ChatMessage[]; rawText: string }
> {
  const { llmService, modelConfig, messages, source, toolExecutor } = params
  const maxTurns = params.config?.maxTurns ?? MODE_MAX_TURNS[source] ?? 30
  const errorThreshold = params.config?.errorThreshold ?? 3
  const sessionId = params.sessionId ?? 'default'

  // 第七阶段修复（批次 B1）：构造透传给 ToolExecutor 的完整运行时上下文
  // 把 agentId / sessionId 与 threadContext 合并，确保工具权限校验拿到正确的 Agent 身份
  const toolRuntimeContext = {
    ...params.threadContext,
    agentId: params.agentId,
    sessionId,
  }

  logger.debug(
    `ReAct modelConfig: modelId=${modelConfig.modelId} enableVision=${modelConfig.enableVision}`,
  )

  const allToolCalls: ToolCallRecord[] = []
  let consecutiveErrors = 0
  let currentTools = params.tools
  // 完整原始转写：保留每一轮未过滤的 LLM 输出 (含 Thinking 块) + 工具调用/返回摘要，
  // 供「对话调试详情」查看内部构造 (区别于给用户看的、已剥离 Thinking 的可见回复)。
  let rawTranscript = ''

  for (let turn = 0; turn < maxTurns; turn++) {
    // ── 取消检测 ──
    if (params.cancelChecker?.isCancelled(sessionId)) {
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
    const collectedCalls: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }> = []
    let hasToolCalls = false

    // 是否已剥离开头杂质：部分模型 (如 gemini 系列经代理) 会在正文开头吐出孤立的
    // `}` / `]` 等闭合符 (内部推理/FC JSON 泄漏)，需在首个可见字符前清掉，避免污染前端显示与 TTS。
    let leadingStripped = false

    // ── 流式过滤器 (仅 Thinking 块) ──
    const thinkingFilter = new ThinkingStreamFilter()

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
        let filtered = thinkingFilter.filter(content)
        if (filtered && !leadingStripped) {
          // 仅在首个可见字符出现前剥离开头的孤立闭合符/空白
          filtered = filtered.replace(/^[\s}\])）】]+/, '')
          if (filtered) leadingStripped = true
        }
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
            // step-3.7-flash 等厂商在 streaming delta 中可能不返回 id，用 index 生成一个保证唯一
            const id = tcDelta.id || `tc-${Date.now()}-${idx}`
            collectedCalls[idx] = {
              id,
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
    let flushed = thinkingFilter.flush()
    if (flushed && !leadingStripped) {
      flushed = flushed.replace(/^[\s}\])）】]+/, '')
      if (flushed) leadingStripped = true
    }
    if (flushed) yield flushed

    // 打印 LLM 原始回复文本
    if (turnText) {
      logger.debug(`[LLM回复] ${truncate(turnText, 4000)}`)
      // 累积到原始转写 (保留 Thinking 块，供调试视图查看)
      // 剥离前导空白，避免 Debug View 显示缩进异常
      const cleanText = turnText.replace(/^[\s}\])）】]+/, '')
      rawTranscript += (rawTranscript ? '\n' : '') + cleanText
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
    // 必须携带 toolCalls！否则后续 role:'tool' 工具结果 / 截图 user 消息会成为「孤儿消息」，
    // 被厂商 API 报错丢弃或忽略，导致多模态模型读不到截图。
    messages.push({
      role: 'assistant',
      content: turnText || null,
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

      // 取消检测
      if (params.cancelChecker?.isCancelled(sessionId)) {
        logger.info('工具执行阶段被取消')
        break
      }

      const fnName = tc.function.name
      let fnArgs: Record<string, unknown> = {}
      let parseError: string | null = null
      try {
        fnArgs = JSON.parse(tc.function.arguments || '{}')
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err)
        logger.warn(`工具参数解析失败: ${fnName} - ${parseError}`)
      }

      // 第七阶段 #8: 参数解析失败时，把错误作为 tool_result 反馈给 LLM
      // 而非吞掉错误以空参数调用工具（会导致工具执行异常或无意义结果）
      if (parseError) {
        const errorMsg = `工具 "${fnName}" 参数解析失败：${parseError}\n原始参数: ${truncate(tc.function.arguments || '', 500)}\n请检查参数是否为合法 JSON 格式后重试。`
        yield { event: 'tool_call', data: { name: fnName, args: {} } }
        yield {
          event: 'tool_result',
          data: { name: fnName, result: errorMsg, isError: true, durationMs: 0 },
        }
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
        })
        consecutiveErrors++
        continue
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
      // AIOS: 透传 Thread 上下文给工具执行器
      // 第七阶段修复（批次 B1）：使用合并了 agentId/sessionId 的完整运行时上下文
      const result = await toolExecutor.execute(fnName, fnArgs, source, toolRuntimeContext)
      logger.debug(
        `[工具返回] ${fnName} (${result.durationMs}ms, error=${result.isError}): ${truncate(result.output, 8000)}`,
      )

      allToolCalls.push({
        name: fnName,
        args: fnArgs,
        result: result.output,
        durationMs: result.durationMs,
      })

      // ── 截图工具特殊处理：把 base64 从工具文本里剥离，转为 image_url 内容块 ──
      // 多模态模型无法从 role:'tool' 的纯文本里"看到"图片，必须以 image_url 块形式放进 user 消息。
      // 注意：base64 绝不能塞回 tool 文本 / SSE，否则既污染上下文、爆 token，模型也只会看到一堆乱码。
      let screenshotImages: Array<{
        type: 'image_url'
        image_url: { url: string; detail: string }
      }> = []
      let toolResultText = result.output

      if (fnName === 'take_screenshot') {
        try {
          const parsed = JSON.parse(result.output)
          const screenshots: Array<{ index: number; dataUri: string }> = parsed?.screenshots
          if (Array.isArray(screenshots) && screenshots.length > 0) {
            if (modelConfig.enableVision) {
              screenshotImages = screenshots.map((s) => ({
                type: 'image_url' as const,
                image_url: { url: s.dataUri, detail: 'low' as const },
              }))
              // 工具文本只保留摘要，base64 已转入 image_url 块
              toolResultText = parsed.message || `已获取 ${screenshots.length} 张屏幕截图`
              logger.info(`截图已提取 ${screenshots.length} 张，转为 image_url 注入 user 消息`)
            } else {
              // 模型未启用视觉：剥离 base64 并明确告知，避免把超长 base64 当文本灌给模型
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
          result: toolResultText.slice(0, 2000),
          isError: result.isError,
          durationMs: result.durationMs,
        },
      }

      // 累积工具调用/返回摘要到原始转写，供「对话调试详情」查看 (不含 base64)。
      // 用 ⟦TOOL⟧…⟦/TOOL⟧ 哨兵包裹：这对符号不会出现在 JSON 参数/返回里，
      // 避免和前端 Thinking/NIT 的方括号正则相互截断。
      rawTranscript +=
        (rawTranscript ? '\n' : '') +
        `⟦TOOL⟧${fnName}\n` +
        `参数: ${truncate(JSON.stringify(fnArgs), 2000)}\n` +
        `返回 (${result.durationMs}ms${result.isError ? ', error' : ''}): ${truncate(toolResultText, 4000)}\n` +
        `⟦/TOOL⟧`

      // 1. 工具结果消息（role: tool，文本）
      messages.push({
        role: 'tool',
        content: toolResultText,
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

  return { toolCalls: allToolCalls, messages, rawText: rawTranscript }
}
