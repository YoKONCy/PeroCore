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

  // ── 2. 恢复 Scorer 待处理任务 ──
  try {
    const activeAgent = ctx.agentManager.activeAgentId
    await ctx.scorerService.processBatch(activeAgent)
    logger.info('Scorer 启动恢复处理完成')
  } catch (err) {
    logger.warn(`Scorer 恢复失败: ${err}`)
  }

  // ── 3. 恢复 VectorSync 补偿任务 ──
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

  // ── 5. 注册 Gateway 对话事件处理 (action:chat) ──
  registerChatHandler(ctx)
  logger.success('对话 Gateway RPC 已注册')

  // ── 6. 注册 abort 事件处理 (前端中断对话) ──
  ctx.gatewayHub.on('abort', (envelope: GatewayEnvelope) => {
    const sessionId = (envelope.payload?.sessionId as string) || 'default'
    ctx.taskManager.cancel(sessionId)
    logger.info(`对话已中断: session=${sessionId}`)
  })
  logger.success('对话中断 Gateway 触发已注册')

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

/**
 * 注册 Gateway 对话处理 (action:chat)
 *
 * 前端桌宠通过 WS 发送 request('chat', { messages, source, sessionId })。
 * 此处接收请求后:
 * 1. 调用 agentService.chatStream() 执行流式对话
 * 2. 将每个 delta 通过 pushStreamDelta 推送到前端
 * 3. 对话完成后发送 stream_end + RPC response 回送
 */
function registerChatHandler(ctx: AppContext): void {
  ctx.gatewayHub.on('action:chat', async (envelope: GatewayEnvelope) => {
    const payload = envelope.payload as Record<string, unknown>
    const messages = (payload.messages as Array<{ role: string; content: string }>) || []
    const source = (payload.source as string) || 'desktop'
    const sessionId = (payload.sessionId as string) || 'default'
    const agentId = (payload.agentId as string) || 'pero'
    const requestId = envelope.id
    const sourceNodeId = envelope.sourceId ?? ''

    if (messages.length === 0) {
      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendError(requestId, sourceNodeId, '消息内容为空')
      }
      return
    }

    // 消息计数 + 陪伴活动通知
    ctx.sessionService?.incrementMessageCount?.(agentId)
    ctx.sessionService?.notifyCompanionActivity?.(agentId)

    // TaskManager 注册任务
    ctx.taskManager.register(sessionId)

    try {
      const gen = ctx.agentService.chatStream({
        messages: messages as { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }[],
        agentId,
        source: source as 'desktop' | 'social',
        sessionId,
      })

      let fullReply = ''

      for await (const chunk of gen) {
        if (typeof chunk === 'string') {
          // delta 文本 → 推送流式增量到前端
          fullReply += chunk
          await ctx.gatewayHub.pushStreamDelta(chunk, sessionId)
        } else if (chunk && typeof chunk === 'object' && 'event' in chunk) {
          // 工具调用/状态等结构化事件
          const sseEvent = chunk as { event: string; data: unknown }
          if (sseEvent.event === 'tool_call') {
            const toolData = sseEvent.data as { name?: string }
            await ctx.gatewayHub.pushToolStatus({
              name: toolData?.name ?? 'unknown',
              state: 'calling',
              sessionId,
            })
          } else if (sseEvent.event === 'tool_result') {
            const toolData = sseEvent.data as { name?: string }
            await ctx.gatewayHub.pushToolStatus({
              name: toolData?.name ?? 'unknown',
              state: 'completed',
              sessionId,
            })
          }
        }
      }

      // 流结束
      await ctx.gatewayHub.pushStreamEnd(sessionId)

      // RPC 响应回送 (前端 request() 的 Promise resolve)
      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendResponse(requestId, sourceNodeId, {
          success: true,
          reply: fullReply,
        })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`Gateway chat 失败: ${errMsg}`)

      // 推送错误到前端
      await ctx.gatewayHub.pushStreamEnd(sessionId)

      // RPC 错误回送
      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendError(requestId, sourceNodeId, errMsg)
      }
    } finally {
      ctx.taskManager.unregister(sessionId)
    }
  })
}
