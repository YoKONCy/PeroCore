/**
 * Agent Router — 角色管理 API
 *
 * 提供 Agent CRUD + 切换 + Capabilities 端点：
 * - GET    /api/agents           列出所有 Agent
 * - GET    /api/agents/active    获取当前活跃 Agent
 * - PUT    /api/agents/active    切换活跃 Agent
 * - GET    /api/agents/:id       获取单个 Agent 详情
 * - POST   /api/agents           创建自定义 Agent (B6-3)
 * - DELETE /api/agents/:id       删除自定义 Agent (B6-3)
 * - POST   /api/agents/:id/enable   启用 Agent (D54)
 * - POST   /api/agents/:id/disable  禁用 Agent (D54)
 * - GET    /api/agents/:id/capabilities  获取 Agent 能力配置 (B6-3)
 * - POST   /api/agents/reload       重载 Agent 目录
 *
 * @module packages/backend/src/routers/agent.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { AppError } from '../lib/appError'
import type { AppContext } from '../container'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

const switchAgentSchema = z.object({
  agentId: z.string().min(1),
})

const createAgentSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-z0-9_-]+$/, 'ID 只允许小写字母、数字、下划线和短横线'),
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createAgentRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/agents — 列出所有 Agent (含 avatarUrl)
  router.get('/', (c) => {
    const agents = ctx.agentManager.listAgents().map((a) => ({
      ...a,
      avatarUrl: `/agents/${a.id}/avatar`,
    }))
    return c.json({ code: 'OK', message: '获取成功', data: agents })
  })

  // GET /api/agents/active — 获取当前活跃 Agent
  router.get('/active', (c) => {
    const agent = ctx.agentManager.getActiveAgent()
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: '当前没有活跃的 Agent',
        data: { agentId: ctx.agentManager.activeAgentId },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatarPath: agent.avatarPath,
      },
    })
  })

  // GET /api/agents/:id/avatar — 获取 Agent 头像图片
  router.get('/:id/avatar', (c) => {
    const agentId = c.req.param('id')
    const avatarData = ctx.agentManager.getAvatarData(agentId)
    if (!avatarData) {
      return c.json({ code: 'NOT_FOUND', message: '该 Agent 没有头像' }, 404)
    }
    c.header('Content-Type', avatarData.mime)
    c.header('Cache-Control', 'public, max-age=3600')
    return c.body(new Uint8Array(avatarData.buffer))
  })

  // PUT /api/agents/active — 切换活跃 Agent
  router.put('/active', zValidator('json', switchAgentSchema), (c) => {
    const { agentId } = c.req.valid('json')
    const success = ctx.agentManager.setActiveAgent(agentId)
    if (!success) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `无法切换到 Agent: ${agentId}`,
        data: { agentId },
      })
    }
    // 广播 Agent 切换事件给前端
    void ctx.gatewayHub.pushStateUpdate({ action: 'agent_changed', agentId })

    return c.json({
      code: 'OK',
      message: `已切换到 ${agentId}`,
      data: { agentId: ctx.agentManager.activeAgentId },
    })
  })

  // GET /api/agents/:id — 获取单个 Agent 详情 (B6-3)
  router.get('/:id', (c) => {
    const id = c.req.param('id')
    // 排除特殊路径防止与 /active /reload 冲突
    if (id === 'active' || id === 'reload') return c.notFound()

    const agent = ctx.agentManager.getAgent(id)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        avatarPath: agent.avatarPath,
        workTraits: agent.workTraits,
        socialTraits: agent.socialTraits,
        useStickers: agent.useStickers,
      },
    })
  })

  // POST /api/agents — 创建自定义 Agent (B6-3)
  router.post('/', zValidator('json', createAgentSchema), (c) => {
    const body = c.req.valid('json')

    try {
      const profile = ctx.agentManager.createAgent({
        id: body.id,
        name: body.name,
        description: body.description,
      })
      return c.json(
        {
          code: 'CREATED',
          message: `Agent "${profile.id}" 创建成功`,
          data: { id: profile.id, name: profile.name, description: profile.description },
        },
        201,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError('ALREADY_EXISTS', {
        message: msg,
        data: { resource: 'agent' },
      })
    }
  })

  // DELETE /api/agents/:id — 删除自定义 Agent (B6-3)
  router.delete('/:id', (c) => {
    const id = c.req.param('id')

    try {
      ctx.agentManager.deleteAgent(id)
      return c.json({ code: 'OK', message: `Agent "${id}" 已删除` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('不存在')) {
        throw new AppError('AGENT_NOT_FOUND', {
          message: msg,
          data: { agentId: id },
        })
      }
      throw new AppError('UNPROCESSABLE', {
        message: msg,
        data: { agentId: id },
      })
    }
  })

  // POST /api/agents/:id/enable — 启用 Agent
  router.post('/:id/enable', (c) => {
    const id = c.req.param('id')
    const success = ctx.agentManager.enableAgent(id)
    if (!success) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `无法启用 Agent: ${id}`,
        data: { agentId: id },
      })
    }
    return c.json({ code: 'OK', message: `Agent ${id} 已启用` })
  })

  // POST /api/agents/:id/disable — 禁用 Agent
  router.post('/:id/disable', (c) => {
    const id = c.req.param('id')
    const success = ctx.agentManager.disableAgent(id)
    if (!success) {
      throw new AppError('UNPROCESSABLE', {
        message: `无法禁用 Agent: ${id} (可能是当前主角色)`,
        data: { agentId: id },
      })
    }
    return c.json({ code: 'OK', message: `Agent ${id} 已禁用` })
  })

  // GET /api/agents/:id/capabilities — 获取 Agent 能力配置 (B6-3)
  router.get('/:id/capabilities', (c) => {
    const id = c.req.param('id')
    const agent = ctx.agentManager.getAgent(id)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }

    // 从 CapabilityGate 获取能力配置
    const modes = ctx.capabilityGate.getAgentModes(id)
    const skills = ctx.capabilityGate.getAgentSkills(id)

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { agentId: id, modes, skills },
    })
  })

  // POST /api/agents/reload — 重载 Agent 目录
  router.post('/reload', (c) => {
    ctx.agentManager.reloadAgents()
    const agents = ctx.agentManager.listAgents()
    return c.json({
      code: 'OK',
      message: `已重载，共 ${agents.length} 个 Agent`,
      data: agents,
    })
  })

  // GET /api/agents/:id/texts — 获取 Agent 看板娘台词 (静态 + 动态合并)
  router.get('/:id/texts', async (c) => {
    const id = c.req.param('id')
    const texts = await ctx.agentManager.getWaifuTexts(id)
    if (!texts) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent "${id}" 不存在`,
        data: { agentId: id },
      })
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: texts,
    })
  })

  return router
}
