// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBaseUrl: vi.fn(() => 'http://localhost:7359'),
  apiGet: vi.fn(),
}))

vi.mock('@infos/frontend/api/transportUtils', () => ({
  getBaseUrl: mocks.getBaseUrl,
}))

vi.mock('@infos/frontend/api/client', () => ({
  apiClient: {
    get: mocks.apiGet,
  },
}))

import { voiceApi } from '@infos/frontend/api/modules/voiceApi'

describe('voiceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('infos.currentServerOrigin', mocks.getBaseUrl())
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('synthesize 应当发送 JSON 请求并返回音频 ArrayBuffer', async () => {
    const audio = new Uint8Array([1, 2, 3]).buffer
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(audio),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await voiceApi.synthesize({
      text: '你好',
      voice: 'pero',
      speed: 1.2,
      format: 'mp3',
    })

    expect(result).toBe(audio)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7359/api/voice/tts', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ text: '你好', voice: 'pero', speed: 1.2, format: 'mp3' }),
      signal: undefined,
    })
  })

  it('TTS 使用当前远程服务器鉴权并透传取消信号', async () => {
    localStorage.setItem('infos.currentServerOrigin', 'https://voice.example')
    sessionStorage.setItem('infos.currentServerToken', 'configured-token')
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: unknown, _options?: RequestInit) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(2),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await voiceApi.synthesize({ text: '选中的文字' }, controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://voice.example/api/voice/tts',
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer configured-token',
    )
  })

  it('synthesize 应当在失败响应中优先使用服务端错误消息', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'TTS 服务异常' }),
        }),
      ),
    )

    await expect(voiceApi.synthesize({ text: '你好' })).rejects.toThrow('TTS 服务异常')
  })

  it('synthesize 应当在错误 body 不可解析时使用默认中文错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.reject(new Error('不是 JSON')),
        }),
      ),
    )

    await expect(voiceApi.synthesize({ text: '你好' })).rejects.toThrow(Error)
  })

  it('recognize 应当发送二进制音频并返回识别 data', async () => {
    const audio = new Uint8Array([4, 5, 6]).buffer
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: { text: '你好主人', confidence: 0.98 } }),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await voiceApi.recognize(audio, 'audio/wav')

    expect(result).toEqual({ text: '你好主人', confidence: 0.98 })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:7359/api/voice/asr', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: audio,
      signal: undefined,
    })
  })

  it('recognize 透传真实编码与取消信号', async () => {
    const controller = new AbortController()
    const audio = new ArrayBuffer(2)
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: { text: '你好' } }) })
    vi.stubGlobal('fetch', fetchMock)
    await voiceApi.recognize(audio, 'audio/ogg;codecs=opus', controller.signal)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        signal: controller.signal,
        headers: { 'Content-Type': 'audio/ogg;codecs=opus' },
        body: audio,
      }),
    )
  })

  it('recognize 应当在失败响应中返回识别错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ message: '音频格式错误' }),
        }),
      ),
    )

    await expect(voiceApi.recognize(new ArrayBuffer(0))).rejects.toThrow('音频格式错误')
  })
})
