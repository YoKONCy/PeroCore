/**
 * SSE 流式客户端
 *
 * 对接后端 chat/stream 端点，处理 SSE 事件格式：
 * - event: delta    → 增量内容
 * - event: done     → 完成 (含 usage)
 * - event: error    → 错误
 * - event: status   → 状态变更 (thinking/tool_call 等)
 *
 */

import { getBaseUrl } from './transportUtils'

/** SSE 事件类型 */
export interface SseEvents {
  /** 增量内容 */
  onDelta?: (data: { content: string }) => void
  /** 工具调用 */
  onToolCall?: (data: { name: string; arguments: string }) => void
  /** 工具结果 */
  onToolResult?: (data: { name: string; output: string; isError: boolean }) => void
  /** 状态变更 */
  onStatus?: (data: { state: string; message?: string; turn?: number }) => void
  /** 完成 */
  onDone?: (data: { usage?: Record<string, number> | null }) => void
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
          parseSseEvent(part, events)
        }
      }

      // 处理最后残余
      if (buffer.trim()) {
        parseSseEvent(buffer, events)
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
function parseSseEvent(raw: string, events: SseEvents): void {
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
