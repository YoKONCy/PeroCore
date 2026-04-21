/**
 * Voice API 模块 — 语音 TTS/ASR
 *
 * 对接后端 /api/voice/* 路由。
 * 注：TTS 返回二进制音频, ASR 接收二进制音频 → 不走 apiClient 信封。
 *
 * @module packages/frontend/src/api/modules/voiceApi
 */

import { apiClient } from '../client'
import { getBaseUrl } from '../transportUtils'

/** ASR 识别结果 */
export interface AsrResult {
  text: string
  language?: string
  confidence?: number
  durationMs?: number
}

/** 语音服务状态 */
export interface VoiceStatus {
  tts: { available: boolean }
  asr: { available: boolean }
}

export const voiceApi = {
  /**
   * TTS 合成 — 返回 ArrayBuffer 音频数据
   */
  synthesize: async (params: {
    text: string
    voice?: string
    speed?: number
    format?: 'mp3' | 'opus' | 'aac' | 'pcm'
  }): Promise<ArrayBuffer> => {
    const res = await fetch(`${getBaseUrl()}/api/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '语音合成失败' }))
      throw new Error(err.message || `TTS 请求失败: ${res.status}`)
    }

    return res.arrayBuffer()
  },

  /**
   * ASR 语音识别 — 发送 ArrayBuffer 音频, 返回识别文本
   *
   * 使用 application/octet-stream 直接发送二进制流,
   * 避免 FormData 的额外开销。
   */
  recognize: async (audioData: ArrayBuffer, mimeType = 'audio/webm'): Promise<AsrResult> => {
    const res = await fetch(`${getBaseUrl()}/api/voice/asr`, {
      method: 'POST',
      headers: { 'Content-Type': mimeType },
      body: audioData,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '语音识别失败' }))
      throw new Error(err.message || `ASR 请求失败: ${res.status}`)
    }

    const json = await res.json()
    return json.data as AsrResult
  },

  /** 获取语音服务状态 */
  getStatus: () => apiClient.get<VoiceStatus>('/voice/status'),
}
