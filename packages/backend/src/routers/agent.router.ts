/**
 * Agent Router — 角色管理 API
 *
 * 提供 Agent CRUD + Capabilities 端点：
 * - GET    /api/agents           列出所有 Agent
 * - GET    /api/agents/active    获取默认 Agent（AIOS: 不再有全局活跃概念）
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

// AIOS: switchAgentSchema 已移除（PUT /api/agents/active 路由已删除）

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

  // GET /api/agents/active — 获取默认 Agent（AIOS 架构下不再有"活跃"概念，返回默认 Agent）
  router.get('/active', (c) => {
    const agent = ctx.agentManager.getDefaultAgent()
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: '当前没有默认 Agent',
        data: { agentId: ctx.agentManager.defaultAgentId },
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

  // AIOS: PUT /api/agents/active 已移除（setActiveAgent 方法已删除）
  // 不再允许运行时切换全局活跃 Agent，前端窗口级状态由 RuntimeStateService 管理。

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

  // GET /api/agents/:id/pet-state — 获取角色实时状态 (mood/vibe/mind + 动态台词)
  // 前端 Pet3D / Dashboard 启动时拉取，恢复 finish_task 持久化到 pet_states 的状态
  router.get('/:id/pet-state', async (c) => {
    const id = c.req.param('id')
    const state = await ctx.petStateService.get(id)
    const parse = <T>(text: string | null | undefined, fallback: T): T => {
      if (!text) return fallback
      try {
        return JSON.parse(text) as T
      } catch {
        return fallback
      }
    }
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        agentId: id,
        mood: state?.mood ?? '开心',
        vibe: state?.vibe ?? '活泼',
        mind: state?.mind ?? '正在想主人...',
        clickMessages: parse<Record<string, string[]>>(state?.clickMessagesJson, {}),
        idleMessages: parse<string[]>(state?.idleMessagesJson, []),
        backMessages: parse<string[]>(state?.backMessagesJson, []),
        updatedAt: state?.updatedAt ?? null,
      },
    })
  })

  return router
}
