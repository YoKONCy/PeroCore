/**
 * MCP Router — MCP 服务器管理 API
 *
 * 提供 MCP 配置的 CRUD + 连接管理 + 工具查询。
 *
 * 路由前缀: /api/mcp
 *
 * @module packages/backend/src/routers/mcp.router
 */

import { Hono } from 'hono'
import type { AppContext } from '../container'
import { McpConfigRepository } from '../repositories/mcp.repo'
import { AppError } from '../lib/appError'

export function createMcpRouter(ctx: AppContext) {
  const router = new Hono()
  const mcpRepo = new McpConfigRepository(ctx.db)

  // ── GET /api/mcp/configs — 获取所有 MCP 配置 ──
  router.get('/configs', async (c) => {
    const configs = await mcpRepo.findAll()

    // 解析 JSON 字段
    const parsed = configs.map((cfg) => ({
      ...cfg,
      args: cfg.args ? JSON.parse(cfg.args) : [],
      env: cfg.env ? JSON.parse(cfg.env) : {},
    }))

    return c.json({ code: 'OK', message: '获取成功', data: parsed })
  })

  // ── POST /api/mcp/configs — 创建 MCP 配置 ──
  router.post('/configs', async (c) => {
    const body = await c.req.json()

    if (!body.name) {
      throw new AppError('VALIDATION_ERROR', { message: 'name 为必填字段' })
    }

    // 检查重名
    const existing = await mcpRepo.findByName(body.name)
    if (existing) {
      throw new AppError('VALIDATION_ERROR', {
        message: `MCP 配置 "${body.name}" 已存在`,
      })
    }

    const config = await mcpRepo.create(body)
    return c.json({ code: 'CREATED', message: 'MCP 配置已创建', data: config }, 201)
  })

  // ── PUT /api/mcp/configs/:id — 更新 MCP 配置 ──
  router.put('/configs/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()

    const updated = await mcpRepo.update(id, body)
    if (!updated) {
      throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    }

    return c.json({ code: 'OK', message: 'MCP 配置已更新', data: updated })
  })

  // ── DELETE /api/mcp/configs/:id — 删除 MCP 配置 ──
  router.delete('/configs/:id', async (c) => {
    const id = Number(c.req.param('id'))

    // 先断开连接 (如果有)
    const config = await mcpRepo.findById(id)
    if (config && ctx.mcpManager) {
      await ctx.mcpManager.disconnectOne(config.name)
    }

    const deleted = await mcpRepo.delete(id)
    if (!deleted) {
      throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    }

    return c.json({ code: 'OK', message: 'MCP 配置已删除', data: { deleted: true } })
  })

  // ── POST /api/mcp/configs/:id/toggle — 切换启用状态 ──
  router.post('/configs/:id/toggle', async (c) => {
    const id = Number(c.req.param('id'))
    const updated = await mcpRepo.toggleEnabled(id)
    if (!updated) {
      throw new AppError('NOT_FOUND', { message: `MCP 配置 #${id} 不存在` })
    }
    return c.json({ code: 'OK', message: '启用状态已切换', data: updated })
  })

  // ── POST /api/mcp/connect — 连接所有已启用的 MCP 服务器 ──
  router.post('/connect', async (c) => {
    if (!ctx.mcpManager) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: 'MCP Manager 未初始化' })
    }
    await ctx.mcpManager.connectAll()
    return c.json({ code: 'OK', message: 'MCP 连接已完成', data: ctx.mcpManager.getStatus() })
  })

  // ── POST /api/mcp/:name/reconnect — 重新连接单个 Server ──
  router.post('/:name/reconnect', async (c) => {
    const name = c.req.param('name')
    if (!ctx.mcpManager) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: 'MCP Manager 未初始化' })
    }
    const conn = await ctx.mcpManager.reconnectOne(name)
    if (!conn) {
      throw new AppError('NOT_FOUND', { message: `MCP 配置 "${name}" 不存在` })
    }
    return c.json({
      code: 'OK',
      message: `MCP 服务器 "${name}" 已重新连接`,
      data: {
        name: conn.name,
        status: conn.status,
        toolCount: conn.tools.length,
        error: conn.error,
      },
    })
  })

  // ── GET /api/mcp/status — 获取连接状态 ──
  router.get('/status', async (c) => {
    if (!ctx.mcpManager) {
      return c.json({
        code: 'OK',
        message: 'MCP 未初始化',
        data: { totalServers: 0, connectedServers: 0, totalTools: 0, connections: [] },
      })
    }
    return c.json({ code: 'OK', message: '获取成功', data: ctx.mcpManager.getStatus() })
  })

  // ── GET /api/mcp/tools — 获取所有已发现的 MCP 工具 ──
  router.get('/tools', async (c) => {
    if (!ctx.mcpManager) {
      return c.json({ code: 'OK', message: '获取成功', data: [] })
    }
    const tools = ctx.mcpManager.getAllTools()
    return c.json({ code: 'OK', message: '获取成功', data: tools })
  })

  return router
}
