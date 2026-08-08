/**
 * SSE 流式客户端
 *
 * 对接后端 chat/stream 端点，处理 SSE 事件格式：
 * - event: delta       → 增量内容
 * - event: tool_call   → 工具调用开始 (含 callId)
 * - event: tool_result → 工具执行结果 (含 callId，与 tool_call 关联)
 * - event: status      → 状态变更 (thinking/calling/generating)
 * - event: done        → 完成 (含 usage/agentId/threadId)
 * - event: error       → 错误 (LLM_ERROR/INTERNAL_ERROR)
 *
 * 此外，前端会在流被异常截断（未收到 done）时合成 STREAM_TRUNCATED 错误事件。
 */

import { getBaseUrl } from './transportUtils'

// ── SSE 事件 discriminated union ──

/** delta 事件：文本增量 */
export interface SseDeltaEvent {
  type: 'delta'
  content: string
}

/** tool_call 事件：工具调用开始 */
export interface SseToolCallEvent {
  type: 'tool_call'
  name: string
  args: string
  /** 工具调用 ID，用于与 tool_result 关联 */
  callId: string
}

/** tool_result 事件：工具执行结果 */
export interface SseToolResultEvent {
  type: 'tool_result'
  /** 对应的 tool_call ID */
  callId: string
  result: string
  isError: boolean
}

/** status 事件：状态变更 */
export interface SseStatusEvent {
  type: 'status'
  state: 'thinking' | 'calling' | 'generating'
}

/** done 事件：对话完成 */
export interface SseDoneEvent {
  type: 'done'
  usage: {
    promptTokens: number
    completionTokens: number
  }
  toolCallCount: number
  durationMs: number
  threadId: string
  agentId?: string
}

/** error 事件：错误 */
export interface SseErrorEvent {
  type: 'error'
  /** 后端错误码: LLM_ERROR / INTERNAL_ERROR；前端合成: STREAM_TRUNCATED / NETWORK_ERROR / STREAM_ERROR */
  code: string
  message: string
}

/** 所有 SSE 事件的 discriminated union */
export type SseEvent =
  | SseDeltaEvent
  | SseToolCallEvent
  | SseToolResultEvent
  | SseStatusEvent
  | SseDoneEvent
  | SseErrorEvent

/** SSE 事件回调集合 */
export interface SseEvents {
  /** 增量内容 */
  onDelta?: (data: { content: string }) => void
  /** 工具调用开始 (含 callId) */
  onToolCall?: (data: { name: string; args: string; callId: string }) => void
  /** 工具结果 (含 callId，与 tool_call 关联) */
  onToolResult?: (data: { callId: string; result: string; isError: boolean }) => void
  /** 状态变更 */
  onStatus?: (data: { state: 'thinking' | 'calling' | 'generating' }) => void
  /** 完成 (含 usage) */
  onDone?: (data: {
    usage: { promptTokens: number; completionTokens: number }
    toolCallCount: number
    durationMs: number
    threadId: string
    agentId?: string
  }) => void
  /** 错误 */
  onError?: (data: { code: string; message: string }) => void
}

/**
 * 发起 SSE 流式请求
 *
 * @param endpoint - API 端点 (如 '/chat/stream')
 * @param body - 请求体
 * @param events - 事件回调
 * @returns AbortController (可用于中断)
 */
export function streamRequest(endpoint: string, body: unknown, events: SseEvents): AbortController {
  const controller = new AbortController()

  // 异步启动，不阻塞调用方
  void (async () => {
    /** 是否已收到 done 事件（用于检测流截断） */
    let doneReceived = false

    try {
      // 直接用 fetch (Transport 没有 SSE 接口，这里是允许的二进制/流式例外)
      const baseUrl = getBaseUrl()

      const res = await fetch(`${baseUrl}/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        events.onError?.({ code: 'NETWORK_ERROR', message: `HTTP ${res.status}` })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 按 SSE 协议解析 (双换行分隔事件)
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          parseSseEvent(part, events, () => {
            doneReceived = true
          })
        }
      }

      // 处理最后残余
      if (buffer.trim()) {
        parseSseEvent(buffer, events, () => {
          doneReceived = true
        })
      }

      // 流自然结束但未收到 done 事件 → 合成 STREAM_TRUNCATED 错误
      if (!doneReceived) {
        events.onError?.({
          code: 'STREAM_TRUNCATED',
          message: '流式响应被截断：未收到 done 事件',
        })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      events.onError?.({
        code: 'STREAM_ERROR',
        message: (err as Error).message,
      })
    }
  })()

  return controller
}

/** 解析单个 SSE 事件 */
function parseSseEvent(
  raw: string,
  events: SseEvents,
  markDone: () => void,
): void {
  let eventType = 'delta'
  let data = ''

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data = line.slice(5).trim()
    }
  }

  if (!data) return

  try {
    const parsed = JSON.parse(data)
    switch (eventType) {
      case 'delta':
        events.onDelta?.(parsed)
        break
      case 'tool_call':
        events.onToolCall?.(parsed)
        break
      case 'tool_result':
        events.onToolResult?.(parsed)
        break
      case 'status':
        events.onStatus?.(parsed)
        break
      case 'done':
        markDone()
        events.onDone?.(parsed)
        break
      case 'error':
        events.onError?.(parsed)
        break
    }
  } catch {
    // JSON 解析失败，忽略
  }
}
