/**
 * ASR 服务 — 语音识别
 *
 * 调用 OpenAI 兼容的 `/audio/transcriptions` 端点进行语音转文字。
 * 任何兼容该接口格式的服务（OpenAI、SiliconFlow、本地 FasterWhisper 等）
 * 都可以直接使用，只需配置对应的 API Base / Key / Model。
 *
 * 三层架构：Service 层 — 负责业务逻辑编排，禁止直接构造 HTTP 响应。
 *
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
  /** 识别语言 (BCP-47, 如 zh / en / ja) */
  language?: string
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

/** ASR 配置 (模型无关，仅需 API 地址/Key/模型名) */
export interface AsrConfig {
  /** 是否启用 ASR */
  enabled: boolean
  /** API 基址 (OpenAI 兼容的 /audio/transcriptions) */
  apiBase: string
  /** API 密钥 */
  apiKey: string
  /** 默认识别语言 */
  language: string
  /** 模型名称 (如 whisper-1, FunAudioLLM/SenseVoiceSmall 等) */
  model: string
}

// ── 默认配置 ──

const DEFAULT_CONFIG: AsrConfig = {
  enabled: false,
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
    logger.info(`初始化完成 (API Base: ${this.config.apiBase}, 模型: ${this.config.model})`)
  }

  /** 返回当前 ASR 配置是否有效可用 */
  get isAvailable(): boolean {
    return this.config.enabled && !!this.config.apiKey
  }

  /** 更新配置 */
  updateConfig(partial: Partial<AsrConfig>): void {
    this.config = { ...this.config, ...partial }
    logger.info(`配置已更新 (API Base: ${this.config.apiBase}, 模型: ${this.config.model})`)
  }

  /**
   * 语音识别 — 调用 OpenAI 兼容的音频转写接口
   *
   * @param request - ASR 请求参数
   * @returns 识别结果
   * @throws {Error} API 调用失败或配置缺失
   */
  async recognize(request: AsrRequest): Promise<AsrResult> {
    const apiBase = this.config.apiBase || DEFAULT_CONFIG.apiBase
    const apiKey = this.config.apiKey

    if (!apiKey) {
      throw new Error('ASR 需要 API Key，请在语音配置中填写')
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
      `开始语音识别 (${(request.audio.byteLength / 1024).toFixed(1)}KB, ` +
        `模型: ${this.config.model}, 语言: ${language})`,
    )

    const startTime = Date.now()

    // 构建 FormData — OpenAI 兼容的 /audio/transcriptions
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
      logger.error(`ASR API 失败: ${response.status} — ${body}`)
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
