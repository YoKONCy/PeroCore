/**
 * Stronghold Router — 据点/群聊管理 API
 *
 * 路由前缀: /api/stronghold
 *
 * 端点分组:
 * 1. 设施管理: /facilities
 * 2. 房间管理: /rooms
 * 3. Agent 位置: /locations
 * 4. 群聊消息: /rooms/:roomId/messages
 * 5. 管家: /butler
 *
 * @module packages/backend/src/routers/stronghold.router
 */

import { Hono } from 'hono'
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  loadMemoryRuntimeConfig,
} from '../services/memory/memoryRuntimeConfig'
import { randomUUID } from 'node:crypto'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

export function createStrongholdRouter(ctx: AppContext) {
  const router = new Hono()

  // ═══ 设施管理 ═══

  // GET /api/stronghold/facilities — 列出所有设施
  router.get('/facilities', async (c) => {
    const facilities = await ctx.strongholdService.listFacilities()
    return c.json({ code: 'OK', message: '获取成功', data: facilities })
  })

  // POST /api/stronghold/facilities — 创建设施
  router.post('/facilities', async (c) => {
    const body = await c.req.json()
    if (!body.name) {
      throw new AppError('VALIDATION_ERROR', { message: 'name 为必填字段' })
    }
    const facility = await ctx.strongholdService.createFacility(body)
    return c.json({ code: 'CREATED', message: '设施已创建', data: facility }, 201)
  })

  // ═══ 房间管理 ═══

  // GET /api/stronghold/rooms — 列出所有房间
  router.get('/rooms', async (c) => {
    const facilityId = c.req.query('facilityId')
    const rooms = await ctx.strongholdService.listRooms(facilityId ? Number(facilityId) : undefined)

    // 附加每个房间的 Agent 列表
    const enriched = await Promise.all(
      rooms.map(async (room) => {
        const agents = await ctx.strongholdService.getRoomAgents(room.id)
        return { ...room, agents }
      }),
    )

    return c.json({ code: 'OK', message: '获取成功', data: enriched })
  })

  // POST /api/stronghold/rooms — 创建房间
  router.post('/rooms', async (c) => {
    const body = await c.req.json()
    if (!body.facilityId || !body.name) {
      throw new AppError('VALIDATION_ERROR', { message: 'facilityId 和 name 为必填字段' })
    }
    const room = await ctx.strongholdService.createRoom(body)
    return c.json({ code: 'CREATED', message: '房间已创建', data: room }, 201)
  })

  // PUT /api/stronghold/rooms/:roomId — 更新房间
  router.put('/rooms/:roomId', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()
    const room = await ctx.strongholdService.updateRoom(roomId, body)
    if (!room) {
      throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })
    }
    return c.json({ code: 'OK', message: '房间已更新', data: room })
  })

  // DELETE /api/stronghold/rooms/:roomId — 删除房间
  router.delete('/rooms/:roomId', async (c) => {
    const roomId = c.req.param('roomId')
    try {
      await ctx.strongholdService.deleteRoom(roomId)
      return c.json({ code: 'OK', message: '房间已删除' })
    } catch (err) {
      throw new AppError('VALIDATION_ERROR', {
        message: err instanceof Error ? err.message : '删除失败',
      })
    }
  })

  // PUT /api/stronghold/rooms/:roomId/env — 更新环境变量
  router.put('/rooms/:roomId/env', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()
    if (!body.key) {
      throw new AppError('VALIDATION_ERROR', { message: 'key 为必填字段' })
    }
    await ctx.strongholdService.updateEnvironment(roomId, body.key, body.value)
    return c.json({ code: 'OK', message: '环境变量已更新' })
  })

  // ═══ Agent 位置 ═══

  // POST /api/stronghold/locations/move — 移动 Agent
  router.post('/locations/move', async (c) => {
    const body = await c.req.json()
    if (!body.agentId || !body.roomId) {
      throw new AppError('VALIDATION_ERROR', { message: 'agentId 和 roomId 为必填字段' })
    }
    const agent = ctx.agentManager.listAgents().find((item) => item.id === body.agentId)
    if (!agent) throw new AppError('NOT_FOUND', { message: `Agent ${body.agentId} 不存在` })
    if (!agent.isEnabled) {
      throw new AppError('VALIDATION_ERROR', { message: `Agent ${body.agentId} 未启用` })
    }
    const location = await ctx.strongholdService.moveAgent(body.agentId, body.roomId)
    return c.json({ code: 'OK', message: 'Agent 已移动', data: location })
  })

  // GET /api/stronghold/locations/:agentId — 获取 Agent 位置
  router.get('/locations/:agentId', async (c) => {
    const agentId = c.req.param('agentId')
    const room = await ctx.strongholdService.getAgentLocation(agentId)
    return c.json({ code: 'OK', message: '获取成功', data: room ?? null })
  })

  // ═══ 群聊消息 ═══

  // GET /api/stronghold/rooms/:roomId/messages — 获取房间消息
  router.get('/rooms/:roomId/messages', async (c) => {
    const roomId = c.req.param('roomId')
    const limit = Number(c.req.query('limit') ?? '50')
    const messages = await ctx.groupChatService.getHistory(roomId, limit)
    return c.json({ code: 'OK', message: '获取成功', data: messages })
  })

  // GET /api/stronghold/rooms/:roomId/message-count — 获取房间消息数量（轻量计数）
  router.get('/rooms/:roomId/message-count', async (c) => {
    const roomId = c.req.param('roomId')
    const count = await ctx.groupChatService.countMessages(roomId)
    return c.json({ code: 'OK', message: '获取成功', data: { count } })
  })

  // POST /api/stronghold/rooms/:roomId/messages — 发送消息 + 触发调度
  router.post('/rooms/:roomId/messages', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()

    if (!body.content) {
      throw new AppError('VALIDATION_ERROR', { message: 'content 为必填字段' })
    }

    // 1. 保存消息。用户发言创建 pairId，让本轮所有异步回复可被精确级联删除。
    const pairId = (body.role ?? 'user') === 'user' ? randomUUID() : undefined
    const msg = await ctx.groupChatService.sendMessage({
      roomId,
      senderId: body.senderId ?? 'user',
      content: body.content,
      role: body.role ?? 'user',
      mentions: body.mentions,
      pairId,
    })

    // 2. 系统消息不触发 Agent；用户消息同步完成调度决策，生成仍在后台执行。
    if (msg.role === 'system') {
      return c.json(
        {
          code: 'CREATED',
          message: '系统消息已发送',
          data: { message: msg, replyQueued: false, reason: '系统消息不触发回复' },
        },
        201,
      )
    }

    const history = await ctx.groupChatService.getHistory(roomId, 10)
    const dispatch = await ctx.groupChatDispatcher.decideNextTurn(roomId, history)
    const roomAgentIds = await ctx.strongholdService.getRoomAgents(roomId)
    const enabledAgentIds = new Set(
      ctx.agentManager
        .listAgents()
        .filter((agent) => agent.isEnabled)
        .map((agent) => agent.id),
    )
    const validRoomAgents = roomAgentIds.filter((agentId) => enabledAgentIds.has(agentId))

    // 调度成员表可能包含历史残留；最终执行必须以物理位置和启用状态为准。
    let replyAgentId = dispatch.agentId
    const isAllMention = replyAgentId === '@all'
    if (!replyAgentId || (!isAllMention && !validRoomAgents.includes(replyAgentId))) {
      replyAgentId = validRoomAgents[0] ?? null
    }
    if (!replyAgentId) {
      const reason = validRoomAgents.length === 0 ? '当前房间没有已启用的角色' : dispatch.reason
      logger.info(`调度决定: 无人接话 (${reason})`)
      return c.json(
        {
          code: 'CREATED',
          message: '消息已发送，但当前没有角色接话',
          data: { message: msg, replyQueued: false, reason },
        },
        201,
      )
    }

    // @全体成员：随机打乱回复顺序，让每个角色都能看到前面角色的发言后依次接话。
    if (isAllMention) {
      const shuffled = [...validRoomAgents].sort(() => Math.random() - 0.5)
      logger.info(`调度决定: @全体成员 -> ${shuffled.join(', ')}`)
      setImmediate(async () => {
        for (const agentId of shuffled) {
          try {
            await executeAgentTurn(ctx, roomId, agentId, pairId)
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err)
            logger.error(`Agent ${agentId} 群聊发言失败: ${reason}`)
            // 单个成员失败不阻断后续成员，失败本身回写为可见的 system 消息。
            await ctx.groupChatService.sendMessage({
              roomId,
              senderId: 'system',
              content: `${agentId} 暂时无法回复：${reason}`,
              role: 'system',
              pairId,
            })
          }
        }
      })

      return c.json(
        {
          code: 'CREATED',
          message: '消息已发送，成员将依次回复',
          data: {
            message: msg,
            replyQueued: true,
            agentId: '@all',
            allAgentIds: shuffled,
            reason: '全体成员已召唤，随机顺序依次回复',
          },
        },
        201,
      )
    }

    logger.info(`调度决定: ${replyAgentId} (${dispatch.reason})`)
    setImmediate(async () => {
      try {
        await executeAgentTurn(ctx, roomId, replyAgentId, pairId)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        logger.error(`Agent ${replyAgentId} 群聊发言失败: ${reason}`)
        // 异步失败必须回写据点历史；若用户已经删除本轮，则不允许失败消息复活。
        if (!pairId || (await ctx.groupChatService.isPairActive(roomId, pairId))) {
          await ctx.groupChatService.sendMessage({
            roomId,
            senderId: 'system',
            content: `${replyAgentId} 暂时无法回复：${reason}`,
            role: 'system',
            pairId,
          })
        }
      }
    })

    return c.json(
      {
        code: 'CREATED',
        message: '消息已发送，角色正在回复',
        data: {
          message: msg,
          replyQueued: true,
          agentId: replyAgentId,
          reason: dispatch.reason,
        },
      },
      201,
    )
  })

  // DELETE /api/stronghold/rooms/:roomId/messages/:messageId — 级联删除本轮群聊消息
  router.delete('/rooms/:roomId/messages/:messageId', async (c) => {
    const roomId = c.req.param('roomId')
    const messageId = Number(c.req.param('messageId'))
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new AppError('VALIDATION_ERROR', { message: 'messageId 必须为正整数' })
    }
    const room = await ctx.strongholdService.getRoom(roomId)
    if (!room) throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })

    try {
      const result = await ctx.groupChatService.deleteMessagePair(roomId, messageId)
      return c.json({
        code: 'OK',
        message:
          result.deletedCount > 1 ? `已删除 ${result.deletedCount} 条关联消息` : '消息已删除',
        data: result,
      })
    } catch (err) {
      throw new AppError('NOT_FOUND', {
        message: err instanceof Error ? err.message : '消息删除失败',
      })
    }
  })

  // GET /api/stronghold/rooms/:roomId/members — 获取房间成员
  router.get('/rooms/:roomId/members', async (c) => {
    const roomId = c.req.param('roomId')
    const members = await ctx.groupChatService.getRoomMembers(roomId)
    return c.json({ code: 'OK', message: '获取成功', data: members })
  })

  // POST /api/stronghold/rooms/:roomId/members — 添加成员
  router.post('/rooms/:roomId/members', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()
    if (!body.agentId) {
      throw new AppError('VALIDATION_ERROR', { message: 'agentId 为必填字段' })
    }
    await ctx.groupChatService.addMember(roomId, body.agentId, body.role)
    return c.json({ code: 'OK', message: '成员已添加' })
  })

  // ═══ 管家 ═══

  // POST /api/stronghold/rooms/:roomId/butler-command — 执行确定性的管家命令
  router.post('/rooms/:roomId/butler-command', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()
    if (!body.command && !body.action) {
      throw new AppError('VALIDATION_ERROR', { message: 'command 或 action 为必填字段' })
    }
    try {
      const result = await ctx.butlerService.execute({
        roomId,
        command: body.command,
        action: body.action,
        requesterId: body.requesterId ?? 'user',
      })
      return c.json({ code: 'OK', message: '管家命令已执行', data: result })
    } catch (err) {
      throw new AppError('VALIDATION_ERROR', {
        message: err instanceof Error ? err.message : '管家命令执行失败',
      })
    }
  })

  // GET /api/stronghold/butler — 获取管家配置
  router.get('/butler', async (c) => {
    const config = await ctx.strongholdService.getButlerConfig()
    return c.json({ code: 'OK', message: '获取成功', data: config })
  })

  // PUT /api/stronghold/butler/toggle — 切换管家启用
  router.put('/butler/toggle', async (c) => {
    const body = await c.req.json()
    await ctx.strongholdService.updateButlerEnabled(body.enabled ?? false)
    return c.json({ code: 'OK', message: '管家状态已更新' })
  })

  return router
}

// ── 局部导入的 logger (避免与模块级 logger 冲突) ──
import { createLogger as _createLogger } from '../lib/logger'
const logger = _createLogger('StrongholdRouter')

/**
 * 执行 Agent 在群聊中的发言回合
 *
 * 1. 获取据点权威历史与房间上下文
 * 2. 通过隔离的 group Thread 编译 Agent 人设和能力
 * 3. 调用 AgentService.chatWithCompiledMessages()
 * 4. 保存回复到据点权威消息表并推送
 */
export async function executeAgentTurn(
  ctx: AppContext,
  roomId: string,
  agentId: string,
  pairId?: string,
): Promise<void> {
  try {
    // @全体成员串行队列中，前一轮删除后后续角色无需再发起模型请求。
    if (pairId && !(await ctx.groupChatService.isPairActive(roomId, pairId))) {
      logger.info(`据点对话已删除，跳过 Agent ${agentId} 的群聊回合: room=${roomId}`)
      return
    }

    const room = await ctx.strongholdService.getRoom(roomId)
    if (!room) throw new AppError('NOT_FOUND', { message: `房间 ${roomId} 不存在` })

    const memoryConfig = ctx.configRepo
      ? await loadMemoryRuntimeConfig(ctx.configRepo)
      : DEFAULT_MEMORY_RUNTIME_CONFIG
    const history = await ctx.groupChatService.getHistoryPairs(
      roomId,
      memoryConfig.channels.group.contextPairs,
    )
    const perspective = ctx.groupChatService.convertPerspective(history, agentId)
    const threadId = `stronghold_${roomId}_${agentId}`
    let thread = await ctx.threadService.getThread(threadId)
    if (!thread) {
      thread = await ctx.threadService.createThread({
        id: threadId,
        agentId,
        channel: 'group',
        platform: 'stronghold',
        platformIdentifier: `${roomId}:${agentId}`,
        title: `${room.name} - ${agentId}`,
      })
    }

    const retrievalQuery =
      [...perspective].reverse().find((message) => message.role === 'user')?.content ?? ''
    const compiled = await ctx.contextCompiler.compile(thread.id, agentId, {
      retrievalQuery,
      appendThreadMessages: false,
    })
    const agents = await ctx.strongholdService.getRoomAgents(roomId)
    const environment = JSON.parse(room.environmentJson ?? '{}') as Record<string, unknown>
    const messages = [
      ...compiled.messages,
      {
        role: 'system' as const,
        content:
          `当前据点房间：${room.name}\n` +
          `房间说明：${room.description ?? '无'}\n` +
          `房间环境：${JSON.stringify(environment)}\n` +
          `在场成员：${agents.join('、') || '无'}`,
      },
      ...perspective,
      {
        role: 'user' as const,
        content: '（系统触发：请根据当前据点群聊上下文发言；保持角色人设，不需要发言时回复空。）',
      },
    ]

    const reply = await ctx.agentService.chatWithCompiledMessages({
      agentId,
      messages,
      channel: 'group',
      threadId,
    })

    if (!reply?.trim()) {
      throw new AppError('UNPROCESSABLE', { message: '角色本轮没有生成可见回复' })
    }

    // 发送期间用户可能删除了整轮对话；此时不允许迟到回复重新写回历史。
    if (pairId && !(await ctx.groupChatService.isPairActive(roomId, pairId))) {
      logger.info(`据点对话已删除，放弃 Agent ${agentId} 的迟到回复: room=${roomId}`)
      return
    }

    await ctx.groupChatService.sendMessage({
      roomId,
      senderId: agentId,
      content: reply,
      role: 'assistant',
      pairId,
    })

    // 据点房间历史是展示权威；同时将当前角色视角下的问答对写入 group Thread，供 Scorer 提炼。
    if (retrievalQuery) {
      await ctx.threadService.saveMessagePair({
        threadId,
        agentId,
        userContent: retrievalQuery,
        assistantContent: reply,
        pairId,
      })
      await ctx.memoryTaskRunner.triggerScorer(threadId, agentId, 'group')
    }

    // 5. 推送到前端
    await ctx.gatewayHub.broadcast({
      type: 'push',
      id: '',
      sourceId: 'backend',
      targetId: 'broadcast',
      payload: {
        action: 'group_chat_message',
        roomId,
        senderId: agentId,
        content: reply,
        role: 'assistant',
      },
      timestamp: Date.now(),
    })

    logger.info(`Agent ${agentId} 在房间 ${roomId} 发言: ${reply.slice(0, 50)}...`)
  } catch (err) {
    logger.error(`Agent ${agentId} 群聊发言失败: ${err}`)
    // 上抛给异步调度包装层，由它写入用户可见的 system 消息。
    throw err
  }
}
