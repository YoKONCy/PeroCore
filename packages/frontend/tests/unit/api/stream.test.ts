import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseUrlMock = vi.hoisted(() => ({
  getBaseUrl: vi.fn(() => 'http://localhost:7359'),
}))

vi.mock('@infos/frontend/api/transportUtils', () => ({
  getBaseUrl: baseUrlMock.getBaseUrl,
}))

import { streamRequest } from '@infos/frontend/api/stream'

function createStream(chunks: string[]) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    getReader: () => ({
      read: vi.fn(async () => {
        if (index >= chunks.length) return { done: true, value: undefined }
        return { done: false, value: encoder.encode(chunks[index++]) }
      }),
    }),
  }
}

async function flushStream() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}

describe('streamRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当发送 POST 请求并解析完整 SSE 事件序列', async () => {
    const events = {
      onDelta: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onStatus: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
    }
    const stream = createStream([
      'event: delta\ndata: {"content":"你',
      '好"}\n\nevent: tool_call\ndata: {"name":"search","arguments":"{}"}\n\n',
      'event: tool_result\ndata: {"name":"search","output":"结果","isError":false}\n\n',
      'event: status\ndata: {"state":"thinking","message":"思考中","turn":1}\n\n',
      'event: done\ndata: {"usage":{"tokens":12}}',
    ])
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, body: stream }))
    vi.stubGlobal('fetch', fetchMock)

    const controller = streamRequest('/chat/stream', { message: '你好' }, events)
    await flushStream()

    expect(controller).toBeInstanceOf(AbortController)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7359/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '你好' }),
      signal: controller.signal,
    })
    expect(events.onDelta).toHaveBeenCalledWith({ content: '你好' })
    expect(events.onToolCall).toHaveBeenCalledWith({ name: 'search', arguments: '{}' })
    expect(events.onToolResult).toHaveBeenCalledWith({
      name: 'search',
      output: '结果',
      isError: false,
    })
    expect(events.onStatus).toHaveBeenCalledWith({ state: 'thinking', message: '思考中', turn: 1 })
    expect(events.onDone).toHaveBeenCalledWith({ usage: { tokens: 12 } })
    expect(events.onError).not.toHaveBeenCalled()
  })

  it('应当在 HTTP 响应异常或缺少 body 时触发网络错误', async () => {
    const events = { onError: vi.fn() }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 503, body: null })),
    )

    streamRequest('/chat/stream', {}, events)
    await flushStream()

    expect(events.onError).toHaveBeenCalledWith({ code: 'NETWORK_ERROR', message: 'HTTP 503' })
  })

  it('应当忽略无效 JSON 事件并处理 error 事件', async () => {
    const events = { onDelta: vi.fn(), onError: vi.fn() }
    const stream = createStream([
      'event: delta\ndata: 不是 JSON\n\n',
      'event: error\ndata: {"code":"LLM_ERROR","message":"模型异常"}\n\n',
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, body: stream })),
    )

    streamRequest('/chat/stream', {}, events)
    await flushStream()

    expect(events.onDelta).not.toHaveBeenCalled()
    expect(events.onError).toHaveBeenCalledWith({ code: 'LLM_ERROR', message: '模型异常' })
  })

  it('应当在非 Abort 异常时触发流错误，在 AbortError 时静默', async () => {
    const streamErrorEvents = { onError: vi.fn() }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('连接断开'))),
    )

    streamRequest('/chat/stream', {}, streamErrorEvents)
    await flushStream()

    expect(streamErrorEvents.onError).toHaveBeenCalledWith({
      code: 'STREAM_ERROR',
      message: '连接断开',
    })

    const abortEvents = { onError: vi.fn() }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(Object.assign(new Error('已中断'), { name: 'AbortError' }))),
    )

    streamRequest('/chat/stream', {}, abortEvents)
    await flushStream()

    expect(abortEvents.onError).not.toHaveBeenCalled()
  })
})
