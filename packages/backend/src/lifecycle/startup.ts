/**
 * 应用启动生命周期
 *
 * 在 createAppContext 返回后、HTTP 服务启动前执行的异步初始化。
 * lifespan() 中的初始化逻辑。
 *
 * 包含:
 * 1. Scorer 待处理任务恢复
 * 2. VectorSync 补偿任务恢复
 * 3. BackgroundScheduler 启动
 * 4. Gateway 语音管道事件注册
 *
 * @module packages/backend/src/lifecycle/startup
 */

import type { AppContext } from '../container'
import type { GatewayEnvelope } from '../services/gateway/types'
import { createEnvelope } from '../services/gateway/types'
import { createLogger } from '../lib/logger'

const logger = createLogger('Startup')

/**
 * 执行启动后异步初始化
 *
 * @param ctx - 已初始化的应用上下文
 */
export async function runStartupTasks(ctx: AppContext): Promise<void> {
  logger.info('正在执行启动后任务...')

  // ── 1. 启动后台调度器 ──
  ctx.scheduler.start()
  logger.success('后台调度器已启动')

  // ── 2. 恢复 Scorer 待处理任务 (P2-14) ──
  try {
    const activeAgent = ctx.agentManager.activeAgentId
    await ctx.scorerService.processBatch(activeAgent)
    logger.info('Scorer 启动恢复处理完成')
  } catch (err) {
    logger.warn(`Scorer 恢复失败: ${err}`)
  }

  // ── 3. 恢复 VectorSync 补偿任务 (P2-14) ──
  try {
    const pending = await ctx.vectorSyncRepo.getPending(50)
    if (pending.length > 0) {
      logger.info(`VectorSync 待补偿任务: ${pending.length} 条 (将在后续 cron 中处理)`)
    } else {
      logger.debug('VectorSync 无待补偿任务')
    }
  } catch (err) {
    logger.warn(`VectorSync 补偿检查失败: ${err}`)
  }

  // ── 4. 注册 Gateway 语音管道事件处理 ──
  registerVoicePipelineHandler(ctx)
  logger.success('语音管道 Gateway 触发已注册')

  logger.success('启动后任务执行完毕')
}

/**
 * 注册 Gateway 语音管道处理
 *
 * 当前端通过 WS 发送 action:voice_pipeline 请求时:
 * 1. 从 payload 提取 audio (base64) + agentId + sessionId
 * 2. 调用 RealtimeSessionManager.processVoicePipeline()
 * 3. 将 TTS 音频结果通过 pushAudioChunk 推送给前端
 */
function registerVoicePipelineHandler(ctx: AppContext): void {
  ctx.gatewayHub.on('action:voice_pipeline', async (envelope: GatewayEnvelope) => {
    const payload = envelope.payload as Record<string, unknown>
    const audioBase64 = payload.audio as string | undefined
    const agentId = (payload.agentId as string) || 'pero'
    const sessionId = (payload.sessionId as string) || `voice_${Date.now()}`

    if (!audioBase64) {
      logger.warn('voice_pipeline: 缺少 audio 数据')
      // 发送错误响应
      await ctx.gatewayHub.broadcast(
        createEnvelope('push', {
          action: 'voice_error',
          error: '缺少音频数据',
          sessionId,
        }),
      )
      return
    }

    try {
      // base64 → ArrayBuffer
      const buffer = Buffer.from(audioBase64, 'base64')
      const audioData = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      )

      logger.info(
        `语音管道启动: session=${sessionId}, agent=${agentId}, audio=${(audioData.byteLength / 1024).toFixed(1)}KB`,
      )

      // 执行全链路管道: ASR → Agent → TTS
      const result = await ctx.realtimeSessionManager.processVoicePipeline(
        audioData,
        agentId,
        sessionId,
      )

      // 推送 ASR 识别结果
      await ctx.gatewayHub.broadcast(
        createEnvelope('push', {
          action: 'voice_transcript',
          sessionId,
          text: result.transcript,
        }),
      )

      // 推送 Agent 回复文本
      await ctx.gatewayHub.broadcast(
        createEnvelope('push', {
          action: 'stream_end',
          sessionId,
          content: result.reply,
        }),
      )

      // 推送 TTS 音频 (由 pushAudioChunk 内部转 base64)
      if (result.audio) {
        await ctx.gatewayHub.pushAudioChunk(result.audio.audio, sessionId)
      }

      logger.info(
        `语音管道完成: ASR=${result.timing.asrMs}ms, Agent=${result.timing.agentMs}ms, TTS=${result.timing.ttsMs}ms, 总计=${result.timing.totalMs}ms`,
      )
    } catch (err) {
      logger.error(`语音管道错误: ${err}`)
      await ctx.gatewayHub.broadcast(
        createEnvelope('push', {
          action: 'voice_error',
          sessionId,
          error: (err as Error).message,
        }),
      )
    }
  })
}
