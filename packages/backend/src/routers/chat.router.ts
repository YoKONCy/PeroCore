/**
 * Chat Router — 新版对话 HTTP/SSE 端点
 *
 * 基于 Thread + ContextCompiler 架构：
 * - POST /api/chat             非流式对话 { threadId, content, agentId? }
 * - POST /api/chat/stream       流式对话 (SSE) { threadId, content, agentId? }
 * - POST /api/chat/stop         停止生成
 * - GET  /api/threads           Thread 列表
 * - GET  /api/threads/:id       Thread 详情 + 消息
 * - POST /api/threads           创建新 Thread
 * - PATCH /api/threads/:id/messages/:msgId  编辑消息
 * - DELETE /api/threads/:id/messages/:msgId 软删除消息
 * - DELETE /api/threads/:id/messages/:msgId/pair 软删除对话对
 *
 * SSE 事件类型：
 * - delta: 文本增量
 * - tool_call: 工具调用开始
 * - tool_result: 工具执行结果
 * - status: 状态变更 (thinking/calling/generating)
 * - done: 对话完成 (含 usage)
 * - error: 错误
 *
 * @module packages/backend/src/routers/chat.router
 */

import { Hono } from 'hono'
import { validate as zValidator } from '../lib/validation'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { ConversationSurfaceSession } from '../projections/conversationSurfaceSession'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { resolveToolUserDescription, resolveToolUserLabel } from '../tools/toolUserLabels'
import { isAdvancedTool } from '../tools/advancedTools'
import { isSystemProtocolTool } from '../tools/systemProtocolTools'
import type { ThreadChannel } from '@infos/shared'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

/** 新版对话请求：只接受 threadId + content */
const chatRequestSchema = z.object({
  threadId: z.string().min(1),
  content: z.string().min(1),
  /** 可选覆盖 Agent（默认用 Thread 的 agentId） */
  agentId: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).max(5).optional(),
  /** 图片识别方式：原生视觉或专用多模态转述。 */
  imageMode: z.enum(['auto', 'native', 'relay']).optional(),
  /** 工作区隐式上下文：仅注入模型上下文，不写入用户消息正文。 */
  workspaceContext: z
    .object({
      filePath: z.string().max(2048).optional(),
      terminalId: z.string().max(256).optional(),
    })
    .optional(),
})

/**
 * 创建 Thread 请求
 *
 * 注：social/group channel 已从 ContextCompiler 剥离，由社交子 Agent 应用独立处理。
 * 当前 Thread API 服务本地主 Agent 的 desktop 场景。
 */
const createThreadSchema = z.object({
  agentId: z.string().default('pero'),
  channel: z.literal('desktop').default('desktop'),
  platform: z.string().optional(),
  platformIdentifier: z.string().optional(),
  title: z.string().optional(),
})

/** 修改会话标题请求；允许空字符串恢复为“未命名会话”展示。 */
const renameThreadSchema = z.object({
  title: z.string().max(100),
})

/** 编辑消息请求 */
const threadToolsSchema = z.object({
  disabledTools: z.array(z.string().min(1)).max(500),
})

const threadExecutionModeSchema = z.object({
  autoExecuteTools: z.boolean(),
})

const rewindSchema = z
  .object({
    messageId: z.number().int().positive().optional(),
    wholeThread: z.boolean().optional(),
  })
  .refine((value) => value.wholeThread === true || value.messageId !== undefined, {
    message: '必须指定 messageId 或 wholeThread=true',
  })

const editMessageSchema = z.object({
  content: z.string().min(1),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createChatRouter(ctx: AppContext) {
  const router = new Hono()

  // ─────────────────────────────────────────────
  // 对话接口
  // ─────────────────────────────────────────────

  /**
   * POST /api/chat — 非流式对话
   *
   * 请求体：{ threadId, content, agentId? }
   * 流程：
   * 1. 追加用户消息到 Thread
   * 2. ContextCompiler 编译上下文
   * 3. AgentService 执行对话（ReAct Loop）
   * 4. 追加 Agent 回复到 Thread
   */
  router.post('/', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const { threadId, content } = body

    const result = await ctx.conversationTurnService.executeTurn({
      threadId,
      agentId: body.agentId,
      content,
      attachmentIds: body.attachmentIds,
      imageMode: body.imageMode,
    })

    const messageId = result.assistantMessage?.id
    if (!messageId) throw new Error('非流式对话完成后缺少持久消息身份')
    ctx.conversationProjection.invalidate(threadId)
    const projection = await ctx.conversationProjection.getSnapshot(threadId)
    const surface = projection.surfaces.find((item) => item.messageId === String(messageId))
    if (!surface) throw new Error(`Conversation Surface 不存在: message=${messageId}`)

    return c.json({
      code: 'OK',
      message: '对话完成',
      data: {
        executionId: result.execution?.executionId,
        threadId: result.threadId,
        messageId: String(messageId),
        surface,
      },
    })
  })

  /**
   * POST /api/chat/stream — 流式对话 (SSE)
   *
   * 请求体：{ threadId, content, agentId? }
   */
  router.post('/stream', zValidator('json', chatRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const { threadId, content } = body

    // 预先确认 Thread 存在，流式执行本身会在 streamTurn 内统一完成消息持久化。
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }
    const agentId = body.agentId ?? thread.agentId

    // 注册任务，并把同一取消信号传入完整对话链路。
    ctx.runtimeStateService.registerTask(threadId, agentId)
    const signal = ctx.runtimeStateService.getAbortSignal(threadId)

    return streamSSE(c, async (stream) => {
      const startTime = Date.now()
      let toolCallCount = 0
      let fullContent = ''
      let mode: 'stream' | 'non_stream' = 'stream'
      let firstTokenMs: number | undefined
      let firstTokenAt: number | undefined
      const surfaceRef: { current: ConversationSurfaceSession | null } = { current: null }
      const writeSurface = async (frame: import('@infos/shared').SurfaceFrame) => {
        await stream.writeSSE({ event: 'surface', data: JSON.stringify(frame) })
      }
      try {
        // 统一流式对话：创建 Pair、编译上下文、保存原始文本与工具调用都由服务处理。
        const gen = ctx.conversationTurnService.streamTurn({
          threadId,
          agentId,
          content,
          attachmentIds: body.attachmentIds,
          imageMode: body.imageMode,
          workspaceContext: body.workspaceContext,
          signal,
          onRagProgress: async (progress) => {
            await stream.writeSSE({
              event: 'rag_progress',
              data: JSON.stringify(progress),
            })
          },
          onExecutionStarted: async (execution) => {
            surfaceRef.current = new ConversationSurfaceSession(
              threadId,
              agentId,
              execution.executionId,
            )
            await writeSurface(surfaceRef.current.open())
          },
          onModelResolved: async (config) => {
            mode = config.stream === false ? 'non_stream' : 'stream'
            if (surfaceRef.current) {
              await writeSurface(
                surfaceRef.current.status(
                  'thinking',
                  mode === 'stream' ? '流式模式 · 等待首字' : '非流式模式 · 等待完整响应',
                  { mode },
                ),
              )
            }
          },
        })

        let next = await gen.next()
        while (!next.done) {
          const chunk = next.value
          if (chunk.event === 'thinking_start') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.startThinking(data.blockId))
          } else if (chunk.event === 'thinking_delta') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.appendThinking(data.blockId, data.delta))
          } else if (chunk.event === 'thinking_end') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.completeThinking(data.blockId, data.durationMs))
          } else if (chunk.event === 'native_reasoning_start') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.startNativeReasoning(data.blockId, data.mode))
          } else if (chunk.event === 'native_reasoning_delta') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.appendNativeReasoning(data.blockId, data.delta))
          } else if (chunk.event === 'native_reasoning_end') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(
                surfaceRef.current.completeNativeReasoning(data.blockId, data.durationMs),
              )
          } else if (chunk.event === 'tool_call_start') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.startToolDraft(data.draftId))
          } else if (chunk.event === 'tool_call_delta') {
            const data = chunk.data
            if (surfaceRef.current) {
              await writeSurface(
                surfaceRef.current.appendToolDraft(
                  data.draftId,
                  data.nameDelta,
                  data.argumentsDelta,
                  data.receivedChars,
                ),
              )
            }
          } else if (chunk.event === 'tool_call_ready') {
            toolCallCount++
            const data = chunk.data
            if (surfaceRef.current) await writeSurface(surfaceRef.current.finalizeToolDraft(data))
          } else if (chunk.event === 'narration_start') {
            const data = chunk.data
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.startNarration(data.blockId))
          } else if (chunk.event === 'narration_delta') {
            const data = chunk.data
            const now = Date.now()
            if (firstTokenMs === undefined) {
              firstTokenMs = now - startTime
              firstTokenAt = now
              if (surfaceRef.current) {
                await writeSurface(
                  surfaceRef.current.status(
                    'generating',
                    mode === 'stream' ? '正在流式输出' : '完整响应已返回',
                    { mode, firstTokenMs },
                  ),
                )
              }
            }
            fullContent += data.delta
            if (surfaceRef.current)
              await writeSurface(surfaceRef.current.appendText(data.blockId, data.delta))
          } else if (chunk.event === 'narration_end') {
            // 块结束语义已进入持久Timeline，实时节点无需额外操作。
          } else {
            if (chunk.event === 'tool_call') {
              // 兼容事件：正式节点已由tool_call_ready在原草稿节点上完成。
            } else if (chunk.event === 'tool_result') {
              const data = chunk.data as {
                callId: string
                result: string
                isError: boolean
                durationMs?: number
              }
              if (surfaceRef.current) {
                for (const frame of surfaceRef.current.toolResult(data)) await writeSurface(frame)
              }
            } else if (chunk.event === 'status') {
              const data = chunk.data as {
                state: 'thinking' | 'calling' | 'generating' | 'tool_failed'
                message?: string
              }
              if (surfaceRef.current) {
                await writeSurface(surfaceRef.current.status(data.state, data.message))
              }
            }
          }
          next = await gen.next()
        }

        const turnResult = next.value
        // streamTurn 自然结束时消息已持久化；最终 Surface 必须来自统一 Projection。
        const messageId = turnResult?.assistantMessage?.id
        if (!messageId) throw new Error('流式对话完成后缺少持久消息身份')
        ctx.conversationProjection.invalidate(threadId)
        const projection = await ctx.conversationProjection.getSnapshot(threadId)
        const committedMessage = projection.messages.find(
          (message) => message.messageId === String(messageId),
        )
        const committedSurface = projection.surfaces.find(
          (surface) => surface.messageId === String(messageId),
        )
        if (!committedMessage || !committedSurface) {
          throw new Error(`Conversation Projection 不完整: message=${messageId}`)
        }
        const completedAt = Date.now()
        const durationMs = completedAt - startTime
        const outputDurationMs = firstTokenAt ? completedAt - firstTokenAt : 0
        if (surfaceRef.current) {
          await writeSurface(
            surfaceRef.current.commit(projection, committedMessage, committedSurface, {
              mode,
              firstTokenMs,
              outputDurationMs,
              totalDurationMs: durationMs,
            }),
          )
        }

        // 完成遥测与done事件
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            usage: {
              promptTokens: ctx.tokenCounter.countMessages(turnResult.initialPromptMessages),
              completionTokens: ctx.tokenCounter.countTokens(fullContent),
            },
            toolCallCount,
            mode,
            firstTokenMs,
            outputDurationMs,
            durationMs,
            threadId,
            agentId,
          }),
        })
      } catch (err) {
        const appError = err instanceof AppError ? err : null
        const code = appError?.code ?? 'INTERNAL_ERROR'
        const message = appError?.message ?? (err instanceof Error ? err.message : String(err))
        if (surfaceRef.current) {
          await writeSurface(surfaceRef.current.fail(code, message, fullContent))
        }
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code,
            message,
            data: appError?.data,
          }),
        })
      } finally {
        ctx.runtimeStateService.unregisterTask(threadId)
      }
    })
  })

  // POST /api/chat/stop — 停止生成
  router.post('/stop', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (threadId) {
      ctx.runtimeStateService.cancelTask(threadId)
    }
    return c.json({ code: 'OK', message: '已停止生成' })
  })

  // ─────────────────────────────────────────────
  // Thread 管理接口
  // ─────────────────────────────────────────────

  /**
   * GET /api/threads — Thread 列表
   *
   * 查询参数：agentId, channel, page, pageSize
   */
  router.get('/threads', async (c) => {
    const agentId = c.req.query('agentId') || undefined
    const channel = c.req.query('channel') ?? undefined
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? 20)))

    const knownAgentIds = ctx.agentManager.listAgents().map((agent) => agent.id)
    if (agentId && !ctx.agentManager.getAgent(agentId)) {
      throw new AppError('NOT_FOUND', { message: `角色不存在: ${agentId}` })
    }

    // M05 §8.3: 普通聊天列表默认排除后台任务 Thread，除非显式传 purpose
    const purpose = c.req.query('purpose') ?? 'conversation'

    const result = await ctx.threadService.listThreads({
      agentId,
      agentIds: agentId ? undefined : knownAgentIds,
      channel,
      // 社交是独立应用；其用于心流生命周期的内部 Thread 不属于主应用对话日志。
      // 同时排除旧版本已误标为 conversation 的 social Thread。
      excludeChannels: ['social'],
      purpose: purpose as import('../repositories/thread.repo').ThreadPurpose,
      page,
      pageSize,
    })

    return c.json({ code: 'OK', message: '获取成功', data: result })
  })

  async function assertThreadMutable(threadId: string): Promise<void> {
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const reactBusy = ctx.runtimeStateService
      .listActiveTasks()
      .some((task) => task.threadId === threadId)
    const taskBusy = ctx.backgroundTaskService
      ? await ctx.backgroundTaskService.hasActiveWork({ threadId })
      : false
    if (reactBusy || taskBusy) {
      throw new AppError('CONFLICT', {
        message: '会话关联的 Agent 工作仍在进行，请先停止或等待完成',
      })
    }
  }

  /** 计算 Thread 可配置工具：Registry 通道声明 ∩ Agent/Channel 能力矩阵。 */
  async function resolveThreadTools(threadId: string) {
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const registryTools = ctx.toolRegistry
      .getDefinitions(thread.channel)
      .filter((tool) => !ctx.applicationRealms.isPrivateTool(tool.name))
    const allowed = ctx.capabilityGate.resolve(thread.agentId, thread.channel).allowedTools
    const disabled = new Set(thread.disabledTools.filter((name) => !isSystemProtocolTool(name)))
    const tools = registryTools
      .filter(
        (tool) =>
          !isAdvancedTool(tool.name) && (isSystemProtocolTool(tool.name) || allowed.has(tool.name)),
      )
      .map((tool) => ({
        name: tool.name,
        label: resolveToolUserLabel(tool.name, tool.display?.label),
        description: resolveToolUserDescription(
          tool.name,
          tool.display?.description,
          tool.description,
        ),
        display: tool.display ?? undefined,
        enabled: isSystemProtocolTool(tool.name) || !disabled.has(tool.name),
        locked: isSystemProtocolTool(tool.name),
      }))
    return { thread, tools }
  }

  /** GET /threads/:id/projection — 从领域表重建 Conversation 权威读模型。 */
  router.get('/threads/:id/projection', async (c) => {
    const threadId = c.req.param('id')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const data = await ctx.conversationProjection.getSnapshot(threadId)
    return c.json({ code: 'OK', message: '获取成功', data })
  })

  /** GET /threads/:id/flow-state — 查看当前 Thread 的心流；group 返回全部 Agent。 */
  router.get('/threads/:id/flow-state', async (c) => {
    const threadId = c.req.param('id')
    const agentId = c.req.query('agentId')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const data = agentId
      ? [await ctx.flowStateService.get(threadId, agentId)]
      : thread.channel === 'group'
        ? await ctx.flowStateService.listByThread(threadId)
        : [await ctx.flowStateService.get(threadId, thread.agentId)]
    return c.json({ code: 'OK', data })
  })

  /** DELETE /threads/:id/flow-state — 用户清空指定 Agent 的当前会话心流。 */
  router.delete('/threads/:id/flow-state', async (c) => {
    const threadId = c.req.param('id')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    const agentId = c.req.query('agentId') ?? thread.agentId
    const data = await ctx.flowStateService.clear(threadId, agentId)
    return c.json({ code: 'OK', message: '心流已清空', data })
  })

  /** DELETE /threads/:id/work-context — 用户清空指定 Agent 的工作上下文。 */
  router.delete('/threads/:id/work-context', async (c) => {
    const threadId = c.req.param('id')
    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) throw new AppError('NOT_FOUND', { message: '会话不存在' })
    const agentId = c.req.query('agentId') ?? thread.agentId
    const data = await ctx.flowStateService.clearWorkContext(threadId, agentId)
    return c.json({ code: 'OK', message: '工作上下文已清空', data })
  })

  /** GET /threads/:id/tools — 仅返回当前 Channel 合法且可由会话控制的工具。 */
  router.get('/threads/:id/tools', async (c) => {
    const { thread, tools } = await resolveThreadTools(c.req.param('id'))
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        threadId: thread.id,
        channel: thread.channel,
        autoExecuteTools: thread.autoExecuteTools,
        tools,
      },
    })
  })

  router.put(
    '/threads/:id/execution-mode',
    zValidator('json', threadExecutionModeSchema),
    async (c) => {
      const threadId = c.req.param('id')
      await assertThreadMutable(threadId)
      const { autoExecuteTools } = c.req.valid('json')
      await ctx.threadService.updateAutoExecuteTools(threadId, autoExecuteTools)
      return c.json({
        code: 'OK',
        message: autoExecuteTools ? '自动执行模式已开启' : '自动执行模式已关闭',
        data: { threadId, autoExecuteTools },
      })
    },
  )

  /** PUT /threads/:id/tools — 持久化禁用集合；禁止提交 Channel 白名单之外的工具。 */
  router.put('/threads/:id/tools', zValidator('json', threadToolsSchema), async (c) => {
    const threadId = c.req.param('id')
    if (ctx.runtimeStateService.listActiveTasks().some((task) => task.threadId === threadId)) {
      throw new AppError('INVALID_PARAMETER', { message: '会话正在生成中，请停止后再修改工具配置' })
    }
    const { tools } = await resolveThreadTools(threadId)
    const configurable = new Set(tools.map((tool) => tool.name))
    const requestedDisabled = [...new Set(c.req.valid('json').disabledTools)]
    const advancedTools = requestedDisabled.filter(isAdvancedTool)
    if (advancedTools.length) {
      throw new AppError('INVALID_PARAMETER', {
        message: `高级工具由系统统一管理，不可单独禁用: ${advancedTools.join(', ')}`,
      })
    }
    const protocolTools = requestedDisabled.filter(isSystemProtocolTool)
    if (protocolTools.length) {
      throw new AppError('INVALID_PARAMETER', {
        message: `系统协议工具不可禁用: ${protocolTools.join(', ')}`,
      })
    }
    const disabledTools = requestedDisabled
    const invalid = disabledTools.filter((name) => !configurable.has(name))
    if (invalid.length) {
      throw new AppError('INVALID_PARAMETER', {
        message: `工具不属于当前 Channel: ${invalid.join(', ')}`,
      })
    }
    await ctx.threadService.updateDisabledTools(threadId, disabledTools)
    return c.json({
      code: 'OK',
      message: '本会话工具配置已保存',
      data: {
        disabledTools,
        autoExecuteTools: (await ctx.threadService.getThread(threadId))?.autoExecuteTools ?? false,
        tools: tools.map((tool) => ({ ...tool, enabled: !disabledTools.includes(tool.name) })),
      },
    })
  })

  /**
   * GET /api/threads/:id — Thread 详情 + 消息列表
   *
   * 查询参数：page, pageSize（消息分页）
   */
  router.get('/threads/:id', async (c) => {
    const threadId = c.req.param('id')
    const page = Math.max(1, Number(c.req.query('page') ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? 100)))

    const thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      throw new AppError('NOT_FOUND', { message: `Thread 不存在: ${threadId}` })
    }

    const messages = await ctx.threadService.listMessages({
      threadId,
      page,
      pageSize,
    })

    const attachmentMap = await ctx.attachmentService.listForMessages(
      messages.items.map((message) => message.id),
    )
    const messagesWithAttachments = messages.items.map((message) => ({
      ...message,
      attachments: attachmentMap.get(message.id) ?? [],
    }))

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        thread,
        messages: messagesWithAttachments,
        total: messages.total,
      },
    })
  })

  /**
   * POST /api/threads — 创建新 Thread
   */
  router.post('/threads', zValidator('json', createThreadSchema), async (c) => {
    const body = c.req.valid('json')
    if (!ctx.agentManager.getAgent(body.agentId)) {
      throw new AppError('NOT_FOUND', { message: `角色不存在: ${body.agentId}` })
    }
    const thread = await ctx.threadService.createThread({
      agentId: body.agentId,
      channel: body.channel as ThreadChannel,
      platform: body.platform,
      platformIdentifier: body.platformIdentifier,
      title: body.title,
    })
    return c.json({ code: 'OK', message: 'Thread 已创建', data: { thread } })
  })

  /**
   * POST /api/threads/latest — 获取或创建 Agent 的最新 Thread
   *
   * 前端打开聊天页时调用，自动获取最新 Thread 或创建新的。
   */
  router.post('/threads/latest', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const agentId = ((body as Record<string, unknown>).agentId as string) ?? 'pero'
    const channel = 'desktop'

    const thread = await ctx.threadService.getOrCreateLatest(agentId, channel, 'conversation')
    return c.json({ code: 'OK', message: '获取成功', data: { thread } })
  })

  /** PATCH /api/threads/:id — 修改会话标题。 */
  router.patch('/threads/:id', zValidator('json', renameThreadSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    await ctx.threadService.renameThread(threadId, body.title)
    return c.json({ code: 'OK', message: '会话标题已更新' })
  })

  /** POST /threads/:id/rewind-preview — 返回删除及文件回滚清单，不产生副作用。 */
  router.post('/threads/:id/rewind-preview', zValidator('json', rewindSchema), async (c) => {
    const threadId = c.req.param('id')
    const body = c.req.valid('json')
    const preview = body.wholeThread
      ? await ctx.threadService.previewThreadRewind(threadId)
      : await ctx.threadService.previewMessageRewind(threadId, body.messageId!)
    return c.json({ code: 'OK', message: '预检成功', data: preview })
  })

  /** POST /threads/:id/rewind — 强制回滚文件并链式删除对话历史。 */
  router.post('/threads/:id/rewind', zValidator('json', rewindSchema), async (c) => {
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    const body = c.req.valid('json')
    const preview = body.wholeThread
      ? await ctx.threadService.previewThreadRewind(threadId)
      : await ctx.threadService.previewMessageRewind(threadId, body.messageId!)
    const result = body.wholeThread
      ? await ctx.threadService.rewindThread(threadId)
      : await ctx.threadService.rewindMessage(threadId, body.messageId!)
    if (body.wholeThread) {
      await ctx.flowStateService.deleteThread(threadId)
    } else {
      // “回滚到目标轮次”保留目标轮次完成后的心流，只撤销其后 B/C/D 等轮次的修订。
      const laterPairIds = preview.pairIds.slice(1)
      if (laterPairIds.length) await ctx.flowStateService.rollbackPairs(threadId, laterPairIds)
    }
    let projection
    if (!body.wholeThread) {
      ctx.conversationProjection.invalidate(threadId)
      projection = await ctx.conversationProjection.getSnapshot(threadId)
    } else {
      ctx.conversationProjection.invalidate(threadId)
    }
    return c.json({
      code: 'OK',
      message: '对话、工作区与心流已回滚',
      data: { ...result, ...(projection ? { projection } : {}) },
    })
  })

  /** DELETE /api/threads/:id — 兼容旧客户端：删除时同样回滚整条会话。 */
  router.delete('/threads/:id', async (c) => {
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    await ctx.threadService.rewindThread(threadId)
    await ctx.flowStateService.deleteThread(threadId)
    return c.json({ code: 'OK', message: '会话、工作区与心流已回滚' })
  })

  // ─────────────────────────────────────────────
  // 消息编辑/删除
  // ─────────────────────────────────────────────

  /**
   * PATCH /api/threads/:id/messages/:msgId — 编辑消息内容
   */
  router.patch('/threads/:id/messages/:msgId', zValidator('json', editMessageSchema), async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const body = c.req.valid('json')
    const success = await ctx.threadService.editMessage(msgId, body.content)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    ctx.conversationProjection.invalidate(c.req.param('id'))
    const data = await ctx.conversationProjection.getSnapshot(c.req.param('id'))
    return c.json({ code: 'OK', message: '消息已更新', data })
  })

  /**
   * DELETE /api/threads/:id/messages/:msgId — 软删除单条消息
   */
  router.delete('/threads/:id/messages/:msgId', async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const success = await ctx.threadService.deleteMessage(msgId)
    if (!success) {
      throw new AppError('NOT_FOUND', { message: '消息不存在' })
    }
    ctx.conversationProjection.invalidate(c.req.param('id'))
    const data = await ctx.conversationProjection.getSnapshot(c.req.param('id'))
    return c.json({ code: 'OK', message: '消息已删除', data })
  })

  /**
   * DELETE /api/threads/:id/messages/:msgId/pair — 软删除整对消息
   */
  router.delete('/threads/:id/messages/:msgId/pair', async (c) => {
    const msgId = Number(c.req.param('msgId'))
    if (!Number.isInteger(msgId) || msgId <= 0) {
      throw new AppError('INVALID_PARAMETER', {
        message: '无效的消息 ID',
        data: { field: 'msgId', expected: 'positive integer' },
      })
    }
    const threadId = c.req.param('id')
    await assertThreadMutable(threadId)
    const result = await ctx.threadService.rewindMessage(threadId, msgId)
    ctx.conversationProjection.invalidate(threadId)
    const projection = await ctx.conversationProjection.getSnapshot(threadId)
    return c.json({
      code: 'OK',
      message: `已回滚 ${result.preview.pairCount} 轮对话及关联文件`,
      data: {
        deletedCount: result.deletedMessageIds.length,
        preview: result.preview,
        deletedMessageIds: result.deletedMessageIds,
        projection,
      },
    })
  })

  // ─────────────────────────────────────────────
  // 任务控制 (保留)
  // ─────────────────────────────────────────────

  router.get('/tasks', (c) => {
    const tasks = ctx.runtimeStateService.listActiveTasks()
    return c.json({ code: 'OK', message: '获取成功', data: tasks })
  })

  router.post('/tasks/pause', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (!threadId) {
      throw new AppError('MISSING_FIELD', { message: '缺少 threadId', data: { field: 'threadId' } })
    }
    const ok = ctx.runtimeStateService.pauseTask(threadId)
    return ok
      ? c.json({ code: 'OK', message: '任务已暂停' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  router.post('/tasks/resume', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    if (!threadId) {
      throw new AppError('MISSING_FIELD', { message: '缺少 threadId', data: { field: 'threadId' } })
    }
    const ok = ctx.runtimeStateService.resumeTask(threadId)
    return ok
      ? c.json({ code: 'OK', message: '任务已恢复' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  router.post('/tasks/inject', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const threadId = ((body as Record<string, unknown>).threadId as string) ?? ''
    const instruction = ((body as Record<string, unknown>).instruction as string) ?? ''
    if (!threadId || !instruction.trim()) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 threadId 或 instruction',
        data: { field: 'threadId, instruction' },
      })
    }
    const ok = ctx.runtimeStateService.injectInstruction(threadId, instruction)
    return ok
      ? c.json({ code: 'OK', message: '指令已注入' })
      : c.json({ code: 'NOT_FOUND', message: '任务不存在' }, 404)
  })

  return router
}
