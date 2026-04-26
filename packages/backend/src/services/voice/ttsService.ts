/**
 * TTS 服务 — 文本转语音
 *
 * 支持多 Provider:
 * - Edge TTS (默认，免费，无需 API Key)
 * - OpenAI TTS (需 API Key)
 * - Azure Speech (TODO)
 * - [实验] 可爱化后处理 (音高/共振峰调整，默认关闭)
 *
 * (236行) 的核心功能。
 *
 * 三层架构：Service 层 — 负责业务逻辑编排，禁止直接构造 HTTP 响应。
 *
 * @see 三层架构
 * @module packages/backend/src/services/voice/ttsService
 */

import { createLogger } from '../../lib/logger'

const logger = createLogger('TtsService')

// ── 类型 ──

/** TTS 请求参数 */
export interface TtsRequest {
  /** 要合成的文本 */
  text: string
  /** TTS Provider */
  provider?: TtsProvider
  /** 声音标识 */
  voice?: string
  /** 语速 — Edge: "+25%", OpenAI: 1.25 */
  speed?: number | string
  /** 音调 — Edge: "+5Hz" */
  pitch?: string
  /** 音频格式 */
  format?: 'mp3' | 'opus' | 'aac' | 'pcm'
  /**
   * [实验] 可爱化后处理
   * 设为 true 时调整音高/共振峰使声音变萌。
   * 注意：当前 Node.js 端暂无 Parselmouth 等效库，标记为实验性。
   */
  cute?: boolean
}

/** 支持的 TTS Provider */
export type TtsProvider = 'edge_tts' | 'openai' | 'azure' | 'local'

/** TTS 响应 */
export interface TtsResult {
  /** 音频二进制数据 */
  audio: ArrayBuffer
  /** MIME 类型 */
  mimeType: string
  /** 音频时长（秒） */
  durationSec?: number
}

/** TTS Provider 配置 */
export interface TtsConfig {
  /** 当前 Provider (默认 edge_tts) */
  provider: TtsProvider
  /** OpenAI API 基础地址 */
  apiBase: string
  /** OpenAI API Key */
  apiKey: string
  /** Edge TTS 声音 (默认 zh-CN-XiaoyiNeural，对齐 v1) */
  voice: string
  /** Edge TTS 语速 (默认 +25%，对齐 v1) */
  rate: string
  /** Edge TTS 音调 (默认 +5Hz，对齐 v1) */
  pitch: string
  /** OpenAI 语速 (0.25~4.0) */
  speed: number
  /** OpenAI 音频格式 */
  format: 'mp3' | 'opus' | 'aac' | 'pcm'
}

// ── 默认配置 ──

const DEFAULT_CONFIG: TtsConfig = {
  provider: 'edge_tts',
  apiBase: 'https://api.openai.com/v1',
  apiKey: '',
  voice: 'zh-CN-XiaoyiNeural',
  rate: '+25%',
  pitch: '+5Hz',
  speed: 1.0,
  format: 'mp3',
}

// ── Service ──

export class TtsService {
  private config: TtsConfig

  constructor(config?: Partial<TtsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    logger.info(`初始化完成 (Provider: ${this.config.provider}, 声音: ${this.config.voice})`)
  }

  /** 返回当前 TTS 配置是否有效可用 */
  get isAvailable(): boolean {
    if (this.config.provider === 'openai') return !!this.config.apiKey
    if (this.config.provider === 'edge_tts') return true
    return false
  }

  /** 更新配置 */
  updateConfig(partial: Partial<TtsConfig>): void {
    this.config = { ...this.config, ...partial }
    logger.info(`配置已更新 (Provider: ${this.config.provider})`)
  }

  /**
   * 文本转语音
   *
   * @param request - TTS 请求参数
   * @returns 音频数据 + MIME 类型
   * @throws {Error} API 调用失败或配置缺失
   */
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    const provider = request.provider ?? this.config.provider

    switch (provider) {
      case 'edge_tts':
        return this.synthesizeEdge(request)
      case 'openai':
        return this.synthesizeOpenAI(request)
      case 'azure':
        throw new Error('Azure TTS 尚未实现')
      case 'local':
        throw new Error('本地 TTS 尚未实现')
      default:
        // 未知 Provider → 回退到 Edge
        logger.warn(`未知 Provider "${provider}"，回退到 Edge TTS`)
        return this.synthesizeEdge(request)
    }
  }

  // ── Edge TTS (默认，免费) ──

  /**
   * 使用 Edge TTS 合成语音
   *
   * 通过 edge-tts npm 包调用 Microsoft Edge 的在线 TTS 服务。
   * 无需 API Key， _synthesize_edge() 方法。
   *
   * 默认声音：zh-CN-XiaoyiNeural (对齐 v1)
   * 默认语速：+25% (对齐 v1)
   * 默认音调：+5Hz (对齐 v1)
   */
  private async synthesizeEdge(request: TtsRequest): Promise<TtsResult> {
    // 动态导入 msedge-tts（避免在未安装时影响其他 Provider）
    let MsEdgeTTS: typeof import('msedge-tts').MsEdgeTTS
    let OUTPUT_FORMAT: typeof import('msedge-tts').OUTPUT_FORMAT
    try {
      const msedge = await import('msedge-tts')
      MsEdgeTTS = msedge.MsEdgeTTS
      OUTPUT_FORMAT = msedge.OUTPUT_FORMAT
    } catch {
      throw new Error('msedge-tts 包未安装，请运行: pnpm add msedge-tts')
    }

    const voice = (request.voice as string) ?? this.config.voice
    // Edge TTS 的 rate/pitch 是字符串格式 ("+25%", "+5Hz")
    // request.speed 可能是数字 (OpenAI 格式)，不能直接用于 Edge
    const rate = (typeof request.speed === 'string' ? request.speed : null) ?? this.config.rate
    const pitch = request.pitch ?? this.config.pitch

    logger.info(
      `[Edge] 合成: "${request.text.slice(0, 50)}..." (声音: ${voice}, 语速: ${rate}, 音调: ${pitch})`,
    )
    const startTime = Date.now()

    const tts = new MsEdgeTTS()
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)

    const { audioStream } = tts.toStream(request.text, { rate, pitch })

    // 将流转换为 Buffer
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) {
      chunks.push(chunk as Buffer)
    }
    const buffer = Buffer.concat(chunks)

    const durationMs = Date.now() - startTime
    logger.info(
      `[Edge] 合成完成 (${(buffer.byteLength / 1024).toFixed(1)}KB, 耗时 ${durationMs}ms)`,
    )

    return {
      audio: new Uint8Array(buffer).buffer as ArrayBuffer,
      mimeType: 'audio/mpeg',
    }
  }

  // ── OpenAI TTS ──

  private async synthesizeOpenAI(request: TtsRequest): Promise<TtsResult> {
    const apiBase = this.config.apiBase || 'https://api.openai.com/v1'
    const apiKey = this.config.apiKey

    if (!apiKey) {
      throw new Error('OpenAI TTS 需要 API Key，请在 VoiceTab 中配置')
    }

    // 对齐 v1: 如果 speed 是 Edge 格式 ("+25%")，自动转换为 OpenAI 格式 (1.25)
    let speed = this.config.speed
    const rawSpeed = request.speed ?? this.config.rate
    if (typeof rawSpeed === 'string' && rawSpeed.includes('%')) {
      try {
        const val = parseInt(rawSpeed.replace('%', '').replace('+', ''))
        speed = 1.0 + val / 100.0
      } catch {
        speed = 1.0
      }
    } else if (typeof rawSpeed === 'number') {
      speed = rawSpeed
    }

    const voice = (request.voice as string) ?? 'shimmer'
    const format = request.format ?? this.config.format

    const mimeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      opus: 'audio/ogg',
      aac: 'audio/aac',
      pcm: 'audio/pcm',
    }

    logger.info(
      `[OpenAI] 合成: "${request.text.slice(0, 50)}..." (声音: ${voice}, 格式: ${format})`,
    )
    const startTime = Date.now()

    const response = await fetch(`${apiBase}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: request.text,
        voice,
        speed,
        response_format: format,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      logger.error(`OpenAI TTS API 失败: ${response.status} — ${body}`)
      throw new Error(`TTS API 调用失败: ${response.status}`)
    }

    const audio = await response.arrayBuffer()
    const durationMs = Date.now() - startTime

    logger.info(
      `[OpenAI] 合成完成 (${(audio.byteLength / 1024).toFixed(1)}KB, 耗时 ${durationMs}ms)`,
    )

    return {
      audio,
      mimeType: mimeMap[format] ?? 'audio/mpeg',
    }
  }

  // ── [实验] 可爱化后处理 ──
  // 可通过 Parselmouth (Praat) 调整音高/共振峰使声音变萌。
  // Node.js 目前没有直接的 Parselmouth 替代品。
  // 以下为预留接口，等待合适的 Node.js 音频处理库后启用。
  //
  // async processCute(audio: ArrayBuffer, options?: {
  //   pitchFactor?: number   // 音高倍率 (默认 1.2，对齐 v1)
  //   formantFactor?: number // 共振峰倍率 (默认 1.1，对齐 v1)
  // }): Promise<ArrayBuffer> {
  //   const { pitchFactor = 1.2, formantFactor = 1.1 } = options ?? {}
  //   // TODO: 使用 Praat/SoX/ffmpeg 或 WebAssembly 音频处理库
  //   // Parselmouth "Change gender" (75Hz, 600Hz, formantFactor, pitchFactor, 1.0, 1.0)
  //   logger.warn('可爱化后处理尚未实现 (缺少 Node.js Parselmouth 替代)')
  //   return audio
  // }
}
