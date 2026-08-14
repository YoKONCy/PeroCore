/**
 * Runtime Router — 运行时状态管理 API
 *
 * 窗口级 Agent 状态管理（混合方案）：
 * - POST   /api/runtime/window-agent        注册/更新窗口 Agent
 * - GET    /api/runtime/window-agent/:wid   查询窗口 Agent
 * - DELETE /api/runtime/window-agent/:wid   窗口关闭时注销
 * - GET    /api/runtime/window-agent        列出所有窗口 Agent 映射
 * - GET    /api/runtime/tasks               获取活跃任务列表
 *
 * 设计原则：
 * - 后端不维护全局活跃 Agent
 * - 每个前端窗口自行持久化 defaultAgentId（localStorage）
 * - 后端维护 windowId → agentId 映射，用于广播、Cron 通知等场景
 * - windowId 由前端生成（uuid，持久化到 localStorage）
 *
 * @module packages/backend/src/routers/runtime.router
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

// ─────────────────────────────────────────────
// Zod Schema
// ─────────────────────────────────────────────

/** 注册/更新窗口 Agent 请求 */
const setWindowAgentSchema = z.object({
  windowId: z.string().min(1).max(128),
  agentId: z.string().min(1).max(64),
})

// ─────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────

export function createRuntimeRouter(ctx: AppContext) {
  const router = new Hono()

  /**
   * POST /api/runtime/window-agent — 注册/更新窗口 Agent
   *
   * 前端窗口启动时调用，将 windowId 与 agentId 绑定。
   * 切换 Agent 时也调用此接口更新映射。
   *
   * 请求体：{ windowId, agentId }
   */
  router.post('/window-agent', zValidator('json', setWindowAgentSchema), async (c) => {
    const { windowId, agentId } = c.req.valid('json')

    // 校验 Agent 是否存在
    const agent = ctx.agentManager.getAgent(agentId)
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent 不存在: ${agentId}`,
        data: { agentId },
      })
    }

    ctx.runtimeStateService.setActiveAgent(agentId)
    ctx.runtimeStateService.setWindowAgent(windowId, agentId)

    return c.json({
      code: 'OK',
      message: `窗口 ${windowId} 已绑定 Agent ${agentId}`,
      data: { windowId, agentId, agentName: agent.name },
    })
  })

  /**
   * GET /api/runtime/window-agent/:wid — 查询窗口 Agent
   *
   * 返回指定窗口绑定的 Agent ID。
   * 如果窗口未注册，返回后端默认 Agent。
   */
  router.get('/window-agent/:wid', (c) => {
    const windowId = c.req.param('wid')
    const agentId = ctx.runtimeStateService.getWindowAgent(windowId)

    // 未注册则返回默认 Agent
    const defaultAgentId = ctx.agentManager.defaultAgentId
    const resolvedAgentId = agentId ?? defaultAgentId
    const agent = ctx.agentManager.getAgent(resolvedAgentId)

    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', {
        message: `Agent 不存在: ${resolvedAgentId}`,
        data: { agentId: resolvedAgentId },
      })
    }

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        windowId,
        agentId: resolvedAgentId,
        agentName: agent.name,
        isRegistered: agentId !== undefined,
      },
    })
  })

  /**
   * DELETE /api/runtime/window-agent/:wid — 窗口关闭时注销
   *
   * 前端窗口关闭（onbeforeunload）时调用，清理后端映射。
   * 如果不调用，后端会在窗口超时后自动清理（未来实现）。
   */
  router.delete('/window-agent/:wid', (c) => {
    const windowId = c.req.param('wid')
    ctx.runtimeStateService.removeWindow(windowId)
    return c.json({ code: 'OK', message: `窗口 ${windowId} 已注销` })
  })

  /**
   * GET /api/runtime/window-agent — 列出所有窗口 Agent 映射
   *
   * 用于调试和 Dashboard 展示。
   */
  router.get('/window-agent', (c) => {
    const map = ctx.runtimeStateService.getAllWindowAgents()
    const entries = [...map.entries()].map(([windowId, agentId]) => ({
      windowId,
      agentId,
    }))
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        windows: entries,
        total: entries.length,
      },
    })
  })

  /**
   * GET /api/runtime/tasks — 获取活跃任务列表
   *
   * 返回当前正在进行的 LLM 调用列表。
   */
  router.get('/tasks', (c) => {
    const tasks = ctx.runtimeStateService.listActiveTasks()
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: { tasks, total: tasks.length },
    })
  })

  return router
}
