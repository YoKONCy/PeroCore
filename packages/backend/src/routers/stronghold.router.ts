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

  // POST /api/stronghold/rooms/:roomId/messages — 发送消息 + 触发调度
  router.post('/rooms/:roomId/messages', async (c) => {
    const roomId = c.req.param('roomId')
    const body = await c.req.json()

    if (!body.content) {
      throw new AppError('VALIDATION_ERROR', { message: 'content 为必填字段' })
    }

    // 1. 保存消息
    const msg = await ctx.groupChatService.sendMessage({
      roomId,
      senderId: body.senderId ?? 'user',
      content: body.content,
      role: body.role ?? 'user',
      mentions: body.mentions,
    })

    // 2. 触发调度 (异步，不阻塞响应)
    if (msg.role !== 'system') {
      setImmediate(async () => {
        try {
          const history = await ctx.groupChatService.getHistory(roomId, 10)
          const result = await ctx.groupChatDispatcher.decideNextTurn(roomId, history)

          if (result.agentId) {
            logger.info(`调度决定: ${result.agentId} (${result.reason})`)
            await executeAgentTurn(ctx, roomId, result.agentId)
          } else {
            logger.debug(`调度决定: 无人接话 (${result.reason})`)
          }
        } catch (err) {
          logger.error(`群聊调度失败: ${err}`)
        }
      })
    }

    return c.json({ code: 'CREATED', message: '消息已发送', data: msg }, 201)
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
 * 1. 获取历史 → 视角转换
 * 2. 调用 AgentService.chat()
 * 3. 保存回复到群聊消息
 * 4. 推送到前端
 */
async function executeAgentTurn(ctx: AppContext, roomId: string, agentId: string): Promise<void> {
  try {
    // 1. 获取历史并做视角转换
    const history = await ctx.groupChatService.getHistory(roomId, 20)
    const perspective = ctx.groupChatService.convertPerspective(history, agentId)

    // 2. 注入群聊触发指令
    const messages = [
      ...perspective,
      {
        role: 'user' as const,
        content:
          '(系统触发：请根据当前群聊上下文进行发言，保持角色人设，如果觉得没必要说话则回复空。)',
      },
    ]

    // 3. 调用 AgentService.chat()
    const reply = await ctx.agentService.chat({
      agentId,
      messages,
      source: 'group_chat',
      sessionId: `group_${roomId}`,
    })

    // 4. 保存回复到群聊消息
    if (reply && reply.trim()) {
      await ctx.groupChatService.sendMessage({
        roomId,
        senderId: agentId,
        content: reply,
        role: 'assistant',
      })

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
    }
  } catch (err) {
    logger.error(`Agent ${agentId} 群聊发言失败: ${err}`)
  }
}
