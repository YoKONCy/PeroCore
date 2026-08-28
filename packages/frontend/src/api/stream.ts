/**
 * Internal Surface SSE 客户端。
 *
 * 对外只接收 Surface Frame、执行完成和执行错误；文本、工具与状态不再暴露为并行 UI 事件。
 */

import type { SurfaceFrame } from '@infos/shared'
import { getBaseUrl } from './transportUtils'

/** 执行完成事件。 */
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

export type SseEvent = SurfaceFrame | SseDoneEvent | SseErrorEvent

export interface RagProgressEvent {
  stage: 'embedding' | 'retrieval' | 'reranking' | 'timeline' | 'completed'
  status?: 'running' | 'completed' | 'failed'
  failureKind?: 'embedding' | 'rag'
  message: string
  candidateCount?: number
  resultCount?: number
}

/** SSE 事件回调集合 */
export interface SseEvents {
  onSurface?: (data: SurfaceFrame) => void
  onRagProgress?: (data: RagProgressEvent) => void
  onDone?: (data: Omit<SseDoneEvent, 'type'>) => void
  onError?: (data: Omit<SseErrorEvent, 'type'>) => void
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

    /** 是否收到服务端明确的 error 终态（避免再误报流截断）。 */
    let terminalErrorReceived = false

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
          parseSseEvent(
            part,
            events,
            () => {
              doneReceived = true
            },
            () => {
              terminalErrorReceived = true
            },
          )
        }
      }

      // 处理最后残余
      if (buffer.trim()) {
        parseSseEvent(
          buffer,
          events,
          () => {
            doneReceived = true
          },
          () => {
            terminalErrorReceived = true
          },
        )
      }

      // 流自然结束但未收到 done 或正式 error 事件时，才判定为意外截断。
      if (!doneReceived && !terminalErrorReceived) {
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
  markTerminalError: () => void,
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
      case 'surface':
        events.onSurface?.(parsed as SurfaceFrame)
        break
      case 'rag_progress':
        events.onRagProgress?.(parsed as RagProgressEvent)
        break
      case 'done':
        markDone()
        events.onDone?.(parsed)
        break
      case 'error':
        markTerminalError()
        events.onError?.(parsed)
        break
    }
  } catch {
    // JSON 解析失败，忽略
  }
}
