/**
 * ASR 服务 — 语音识别
 *
 * 支持多 Provider (OpenAI Whisper / Azure Speech / 本地)。
 * 当前实现 OpenAI Whisper API。
 *
 * 三层架构：Service 层 — 负责业务逻辑编排，禁止直接构造 HTTP 响应。
 *
 * @see 三层架构
 * @module packages/backend/src/services/voice/asrService
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('AsrService')

// ── 类型 ──

/** ASR 请求参数 */
export interface AsrRequest {
  /** 音频二进制数据 */
  audio: ArrayBuffer
  /** 音频文件 MIME 类型 */
  mimeType?: string
  /** 识别语言 (BCP-47) */
  language?: string
  /** ASR Provider */
  provider?: 'openai' | 'azure' | 'local'
}

/** ASR 结果 */
export interface AsrResult {
  /** 识别文本 */
  text: string
  /** 识别语言 */
  language?: string
  /** 置信度 (0~1) */
  confidence?: number
  /** 处理耗时 (ms) */
  durationMs: number
}

/** ASR Provider 配置 */
export interface AsrConfig {
  provider: 'openai' | 'azure' | 'local'
  apiBase: string
  apiKey: string
  language: string
  model: string
}

// ── 默认配置 ──

const DEFAULT_CONFIG: AsrConfig = {
  provider: 'openai',
  apiBase: 'https://api.openai.com/v1',
  apiKey: '',
  language: 'zh',
  model: 'whisper-1',
}

// ── Service ──

export class AsrService {
  private config: AsrConfig

  constructor(config?: Partial<AsrConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    logger.info(`初始化完成 (Provider: ${this.config.provider}, 语言: ${this.config.language})`)
  }

  /** 更新配置 */
  updateConfig(partial: Partial<AsrConfig>): void {
    this.config = { ...this.config, ...partial }
    logger.info(`配置已更新 (Provider: ${this.config.provider})`)
  }

  /**
   * 语音识别
   *
   * @param request - ASR 请求参数
   * @returns 识别结果
   * @throws {Error} API 调用失败或配置缺失
   */
  async recognize(request: AsrRequest): Promise<AsrResult> {
    const provider = request.provider ?? this.config.provider

    switch (provider) {
      case 'openai':
        return this.recognizeWhisper(request)
      case 'azure':
        // TODO: Azure Speech SDK 集成
        throw new Error('Azure ASR 尚未实现')
      case 'local':
        // TODO: 本地 ASR 集成
        throw new Error('本地 ASR 尚未实现')
      default:
        throw new Error(`不支持的 ASR Provider: ${provider}`)
    }
  }

  // ── OpenAI Whisper ──

  private async recognizeWhisper(request: AsrRequest): Promise<AsrResult> {
    const apiBase = this.config.apiBase || 'https://api.openai.com/v1'
    const apiKey = this.config.apiKey

    if (!apiKey) {
      throw new Error('OpenAI Whisper 需要 API Key，请在 VoiceTab 中配置')
    }

    const language = request.language ?? this.config.language
    const mimeType = request.mimeType ?? 'audio/webm'

    // 推断文件扩展名
    const extMap: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/webm;codecs=opus': 'webm',
      'audio/ogg': 'ogg',
      'audio/ogg;codecs=opus': 'ogg',
      'audio/mp4': 'mp4',
      'audio/mpeg': 'mp3',
      'audio/wav': 'wav',
    }
    const ext = extMap[mimeType] ?? 'webm'

    logger.info(
      `开始语音识别 (${(request.audio.byteLength / 1024).toFixed(1)}KB, 语言: ${language})`,
    )

    const startTime = Date.now()

    // 构建 FormData
    const formData = new FormData()
    const audioBlob = new Blob([request.audio], { type: mimeType })
    formData.append('file', audioBlob, `audio.${ext}`)
    formData.append('model', this.config.model)
    formData.append('language', language)
    formData.append('response_format', 'json')

    const response = await fetch(`${apiBase}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const body = await response.text()
      logger.error(`Whisper API 失败: ${response.status} — ${body}`)
      throw new Error(`ASR API 调用失败: ${response.status}`)
    }

    const result = (await response.json()) as { text: string }
    const durationMs = Date.now() - startTime

    logger.info(`语音识别完成: "${result.text.slice(0, 50)}..." (耗时 ${durationMs}ms)`)

    return {
      text: result.text,
      language,
      durationMs,
    }
  }
}
