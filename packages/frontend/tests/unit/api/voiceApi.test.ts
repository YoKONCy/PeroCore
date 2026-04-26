import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBaseUrl: vi.fn(() => 'http://localhost:5173'),
  apiGet: vi.fn(),
}))

vi.mock('@perocore/frontend/api/transportUtils', () => ({
  getBaseUrl: mocks.getBaseUrl,
}))

vi.mock('@perocore/frontend/api/client', () => ({
  apiClient: {
    get: mocks.apiGet,
  },
}))

import { voiceApi } from '@perocore/frontend/api/modules/voiceApi'

describe('voiceApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5173/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好', voice: 'pero', speed: 1.2, format: 'mp3' }),
    })
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

    await expect(voiceApi.synthesize({ text: '你好' })).rejects.toThrow('语音合成失败')
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
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:5173/api/voice/asr', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: audio,
    })
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

  it('getStatus 应当通过 apiClient 获取语音服务状态', () => {
    voiceApi.getStatus()

    expect(mocks.apiGet).toHaveBeenCalledWith('/voice/status')
  })
})
