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
import { cleanTextForTts } from '../services/voice'
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
    const activeAgent = ctx.agentManager.defaultAgentId
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
  // AIOS: 改用 RuntimeStateService 按 threadId 取消任务
  ctx.gatewayHub.on('abort', (envelope: GatewayEnvelope) => {
    const threadId = (envelope.payload?.threadId as string) ||
      (envelope.payload?.sessionId as string) || 'default'
    ctx.runtimeStateService.cancelTask(threadId)
    logger.info(`对话已中断: thread=${threadId}`)
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
 * AIOS 新版架构：前端通过 WS 发送 request('chat', { content, threadId?, agentId? })。
 * 兼容旧版 payload：若收到 messages 数组，则取最后一条 user 消息的 content。
 *
 * 处理流程：
 * 1. 获取或创建 desktop Thread（若 payload 未带 threadId）
 * 2. 追加用户消息到 Thread
 * 3. ContextCompiler 编译上下文（从 Thread 加载历史 + 人格 + 记忆 + 工具）
 * 4. RuntimeStateService 注册任务（替代旧 TaskManager）
 * 5. AgentService.chatStreamWithCompiledMessages() 执行流式对话
 * 6. 将每个 delta 通过 pushStreamDelta 推送到前端
 * 7. 追加 Agent 回复到 Thread
 * 8. 对话完成后发送 stream_end + RPC response 回送
 * 9. 异步合成 TTS 并推送音频
 */
/**
 * 合成 TTS 并推送音频到前端 (异步，失败不影响对话)
 *
 * desktop 文本对话路径默认走 TTS，与语音管道保持一致的「听得到声音」体验。
 * 前端通过 Gateway 的 audio_chunk 事件接收并播放。
 */
async function synthesizeAndPushTts(
  ctx: AppContext,
  reply: string,
  sessionId: string,
): Promise<void> {
  try {
    if (!ctx.ttsService.isAvailable) {
      logger.debug('TTS 不可用，跳过桌面对话语音合成')
      return
    }

    // 清洗朗读文本 (移除 ReAct 推理块/代码块/Markdown 等)
    const ttsText = cleanTextForTts(reply)
    if (!ttsText.trim()) {
      logger.debug('TTS 文本清洗后为空，跳过合成')
      return
    }

    const audio = await ctx.ttsService.synthesize({ text: ttsText })
    await ctx.gatewayHub.pushAudioChunk(audio.audio, sessionId)
    logger.info(
      `桌面对话 TTS 已推送: ${(audio.audio.byteLength / 1024).toFixed(1)}KB, session=${sessionId}`,
    )
  } catch (err) {
    logger.warn(`桌面对话 TTS 失败: ${err}`)
  }
}

function registerChatHandler(ctx: AppContext): void {
  ctx.gatewayHub.on('action:chat', async (envelope: GatewayEnvelope) => {
    const payload = envelope.payload as Record<string, unknown>
    const agentId = (payload.agentId as string) || 'pero'
    const requestId = envelope.id
    const sourceNodeId = envelope.sourceId ?? ''

    // AIOS: 优先使用 threadId；兼容旧版 sessionId 字段
    const threadId = (payload.threadId as string) ||
      (payload.sessionId as string) || ''

    // AIOS: 优先使用 content；兼容旧版 messages 数组（取最后一条 user 消息）
    let content = (payload.content as string) || ''
    if (!content) {
      const messages = (payload.messages as Array<{ role: string; content: string }>) || []
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]!.role === 'user') {
          content = messages[i]!.content
          break
        }
      }
    }

    if (!content.trim()) {
      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendError(requestId, sourceNodeId, '消息内容为空')
      }
      return
    }

    try {
      // ── 1. 获取或创建 Thread ──
      let threadIdResolved = threadId
      if (!threadIdResolved) {
        // 未指定 threadId 时，获取或创建 Agent 的最新 desktop Thread
        const thread = await ctx.threadService.getOrCreateLatest(agentId, 'desktop')
        threadIdResolved = thread.id
      } else {
        // 校验 Thread 是否存在
        const existing = await ctx.threadService.getThread(threadIdResolved)
        if (!existing) {
          // Thread 不存在则创建（兼容前端传入新 threadId 的场景）
          await ctx.threadService.createThread({
            id: threadIdResolved,
            agentId,
            channel: 'desktop',
          })
        }
      }

      // ── 2. 追加用户消息到 Thread ──
      // 提前生成 pairId，使 user 消息与后续 assistant 回复通过相同 pairId 关联，
      // 便于对话对级联删除（softDeletePair 按 pairId 匹配）
      const pairId = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      await ctx.threadService.appendUserMessage(threadIdResolved, content, pairId)

      // ── 3. 陪伴活动通知（AIOS: 改用 CompanionSchedulerService） ──
      // AIOS: 移除 incrementMessageCount（ThreadService 自维护计数）
      ctx.companionSchedulerService.notifyActivity(agentId)

      // ── 4. ContextCompiler 编译上下文 ──
      const compiled = await ctx.contextCompiler.compile(threadIdResolved, agentId)

      // ── 5. RuntimeStateService 注册任务（替代旧 TaskManager） ──
      ctx.runtimeStateService.registerTask(threadIdResolved, agentId)

      // ── 6. 流式对话 ──
      // rawContent 保存含 Thinking/Monologue/NIT 等调试块的完整原始转写，
      // 供「对话调试详情」查看（区别于给用户看的、已剥离 Thinking 的可见回复 fullReply）
      let rawContent = ''
      const gen = ctx.agentService.chatStreamWithCompiledMessages({
        messages: compiled.messages,
        agentId,
        threadId: threadIdResolved,
        onRawText: (rawText) => {
          rawContent = rawText
        },
      })

      let fullReply = ''

      for await (const chunk of gen) {
        if (typeof chunk === 'string') {
          // delta 文本 → 推送流式增量到前端
          fullReply += chunk
          await ctx.gatewayHub.pushStreamDelta(chunk, threadIdResolved)
        } else if (chunk && typeof chunk === 'object' && 'event' in chunk) {
          // 工具调用/状态等结构化事件
          const sseEvent = chunk as { event: string; data: unknown }
          if (sseEvent.event === 'tool_call') {
            const toolData = sseEvent.data as { name?: string }
            await ctx.gatewayHub.pushToolStatus({
              name: toolData?.name ?? 'unknown',
              state: 'calling',
              sessionId: threadIdResolved,
            })
          } else if (sseEvent.event === 'tool_result') {
            const toolData = sseEvent.data as { name?: string }
            await ctx.gatewayHub.pushToolStatus({
              name: toolData?.name ?? 'unknown',
              state: 'completed',
              sessionId: threadIdResolved,
            })
          }
        }
      }

      // ── 7. 追加 Agent 回复到 Thread ──
      // 复用步骤 2 生成的 pairId，使 user + assistant 消息通过相同 pairId 关联
      // rawContent 传入完整原始转写（含调试块），供对话日志调试视图查看
      //
      // 边界情况：模型可能只调用了工具（无正文输出）或内容全在【Thinking】块里
      // （剥离后 fullReply 为空）。此时仍需追加 assistant 消息以保证对话对完整，
      // 避免对话日志出现缺失 pair。用占位文本说明无可见回复。
      const assistantContent = fullReply || '(本次回复无可见正文，详情请查看调试视图)'
      await ctx.threadService.appendAssistantMessage({
        threadId: threadIdResolved,
        content: assistantContent,
        rawContent: rawContent || undefined,
        pairId,
        agentId,
      })

      // ── 8. 流结束 + RPC 响应回送 ──
      await ctx.gatewayHub.pushStreamEnd(threadIdResolved)

      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendResponse(requestId, sourceNodeId, {
          success: true,
          reply: fullReply,
          threadId: threadIdResolved,
        })
      }

      // ── 9. desktop 对话 TTS: 异步合成并推送音频 ──
      void synthesizeAndPushTts(ctx, fullReply, threadIdResolved)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error(`Gateway chat 失败: ${errMsg}`)

      // 推送错误到前端
      const threadIdResolved = threadId || 'default'
      await ctx.gatewayHub.pushStreamEnd(threadIdResolved)

      // RPC 错误回送
      if (requestId && sourceNodeId) {
        await ctx.gatewayHub.sendError(requestId, sourceNodeId, errMsg)
      }
    } finally {
      // AIOS: 注销任务（按 threadId）
      const threadIdResolved = threadId || 'default'
      ctx.runtimeStateService.unregisterTask(threadIdResolved)
    }
  })
}
