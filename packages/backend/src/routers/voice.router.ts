/**
 * Voice Router — 语音 API 端点
 *
 * 提供 TTS (文本转语音) 和 ASR (语音识别) REST API。
 *
 * 路由层职责：接收请求 → 参数校验 → 调用 Service → 包装响应。
 * 禁止：直接操作 DB、包含业务逻辑、catch 后吞错误。
 *
 * @see Router 层规范 (S05 §2)
 * @module packages/backend/src/routers/voice.router
 */

import { Hono } from 'hono'
import type { TtsService, AsrService } from '../services/voice'
import { AppError } from '../lib/appError'

/** Voice Router 依赖 */
interface VoiceRouterDeps {
  ttsService: TtsService
  asrService: AsrService
}

export function createVoiceRouter(deps: VoiceRouterDeps) {
  const router = new Hono()

  /**
   * POST /api/voice/tts — 文本转语音
   *
   * 请求体：{ text, voice?, speed?, format? }
   * 响应：音频二进制流 (Content-Type 由 format 决定)
   */
  router.post('/tts', async (c) => {
    const body = await c.req.json<{
      text?: string
      voice?: string
      speed?: number
      format?: 'mp3' | 'opus' | 'aac' | 'pcm'
    }>()

    if (!body.text || body.text.trim().length === 0) {
      throw new AppError('VALIDATION_ERROR', { message: '文本不能为空' })
    }

    // 限制文本长度 (OpenAI TTS 最大 4096 字符)
    if (body.text.length > 4096) {
      throw new AppError('VALIDATION_ERROR', {
        message: '文本过长，最大 4096 字符',
        data: { field: 'text', max: 4096 },
      })
    }

    const result = await deps.ttsService.synthesize({
      text: body.text,
      voice: body.voice,
      speed: body.speed,
      format: body.format,
    })

    // 返回音频二进制流 (特殊响应，不走信封格式)
    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Length': String(result.audio.byteLength),
        'Cache-Control': 'no-cache',
      },
    })
  })

  /**
   * POST /api/voice/asr — 语音识别
   *
   * 请求体：multipart/form-data { audio (file), language? }
   *   或   application/octet-stream (直接音频流)
   * 响应：{ code, message, data: { text, language, confidence, durationMs } }
   */
  router.post('/asr', async (c) => {
    const contentType = c.req.header('content-type') ?? ''
    let audioBuffer: ArrayBuffer
    let mimeType = 'audio/webm'
    let language: string | undefined

    if (contentType.includes('multipart/form-data')) {
      // FormData 上传
      const formData = await c.req.formData()
      const file = formData.get('audio')
      language = formData.get('language')?.toString()

      if (!file || !(file instanceof File)) {
        throw new AppError('MISSING_FIELD', {
          message: '缺少音频文件',
          data: { field: 'audio' },
        })
      }

      mimeType = file.type || 'audio/webm'
      audioBuffer = await file.arrayBuffer()
    } else {
      // 直接二进制流
      audioBuffer = await c.req.arrayBuffer()
      mimeType = contentType || 'audio/webm'
      language = c.req.query('language') ?? undefined
    }

    if (audioBuffer.byteLength === 0) {
      throw new AppError('VALIDATION_ERROR', { message: '音频数据为空' })
    }

    // 限制音频大小 (25MB — OpenAI Whisper 限制)
    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      throw new AppError('PAYLOAD_TOO_LARGE', {
        message: '音频文件过大，最大 25MB',
        data: {
          maxSize: '25MB',
          actualSize: `${(audioBuffer.byteLength / 1024 / 1024).toFixed(1)}MB`,
        },
      })
    }

    const result = await deps.asrService.recognize({
      audio: audioBuffer,
      mimeType,
      language,
    })

    return c.json({
      code: 'OK',
      message: '语音识别成功',
      data: result,
    })
  })

  /**
   * GET /api/voice/status — 语音服务状态
   */
  router.get('/status', (c) => {
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        tts: { available: deps.ttsService.isAvailable },
        asr: { available: deps.asrService.isAvailable },
      },
    })
  })

  return router
}
