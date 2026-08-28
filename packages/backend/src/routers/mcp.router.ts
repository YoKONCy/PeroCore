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
import { AppError } from '../lib/appError'

export function createMcpRouter(ctx: AppContext) {
  const router = new Hono()
  const service = ctx.mcpConfigService

  // ── GET /api/mcp/configs — 获取所有 MCP 配置 ──
  router.get('/configs', async (c) => {
    const configs = await service.list()
    return c.json({ code: 'OK', message: '获取成功', data: configs })
  })

  // ── POST /api/mcp/configs — 创建 MCP 配置 ──
  router.post('/configs', async (c) => {
    const body = await c.req.json()

    if (!body.name) {
      throw new AppError('VALIDATION_ERROR', { message: 'name 为必填字段' })
    }

    const config = await service.create(body)
    await ctx.mcpManager.connectAll()
    ctx.mcpRegistrySynchronizer.sync()
    return c.json({ code: 'CREATED', message: 'MCP 配置已创建', data: config }, 201)
  })

  // ── PUT /api/mcp/configs/:id — 更新 MCP 配置 ──
  router.put('/configs/:id', async (c) => {
    const id = Number(c.req.param('id'))
    const body = await c.req.json()

    const updated = await service.update(id, body)
    await ctx.mcpManager.connectAll()
    ctx.mcpRegistrySynchronizer.sync()

    return c.json({ code: 'OK', message: 'MCP 配置已更新', data: updated })
  })

  // ── DELETE /api/mcp/configs/:id — 删除 MCP 配置 ──
  router.delete('/configs/:id', async (c) => {
    const id = Number(c.req.param('id'))

    await service.delete(id)
    await ctx.mcpManager.connectAll()
    ctx.mcpRegistrySynchronizer.sync()

    return c.json({ code: 'OK', message: 'MCP 配置已删除', data: { deleted: true } })
  })

  // ── POST /api/mcp/configs/:id/toggle — 切换启用状态 ──
  router.post('/configs/:id/toggle', async (c) => {
    const id = Number(c.req.param('id'))
    const updated = await service.toggle(id)
    await ctx.mcpManager.connectAll()
    ctx.mcpRegistrySynchronizer.sync()
    return c.json({ code: 'OK', message: '启用状态已切换', data: updated })
  })

  // ── POST /api/mcp/connect — 连接所有已启用的 MCP 服务器 ──
  router.post('/connect', async (c) => {
    if (!ctx.mcpManager) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: 'MCP Manager 未初始化' })
    }
    await ctx.mcpManager.connectAll()
    ctx.mcpRegistrySynchronizer.sync()
    return c.json({ code: 'OK', message: 'MCP 连接已完成', data: ctx.mcpManager.getStatus() })
  })

  // ── POST /api/mcp/:name/reconnect — 重新连接单个 Server ──
  router.post('/:name/reconnect', async (c) => {
    const name = c.req.param('name')
    if (!ctx.mcpManager) {
      throw new AppError('SERVICE_UNAVAILABLE', { message: 'MCP Manager 未初始化' })
    }
    const conn = await ctx.mcpManager.reconnectOne(name)
    ctx.mcpRegistrySynchronizer.sync()
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

  // ── GET /api/mcp/skills — 获取所有已加载的 Skill 清单 ──
  router.get('/skills', async (c) => {
    const manifests = ctx.skillLoader.getAllManifests()
    return c.json({ code: 'OK', message: '获取成功', data: manifests })
  })

  router.get('/skills/:id/compatibility', async (c) => {
    const skillId = c.req.param('id')
    const availableTools = new Set(ctx.toolRegistry.getAllDefinitions().map((tool) => tool.name))
    const report = ctx.skillLoader.getCompatibilityReport(skillId, availableTools)
    if (!report) throw new AppError('NOT_FOUND', { message: `Skill "${skillId}" 不存在` })
    return c.json({ code: 'OK', message: '获取成功', data: report })
  })

  // ── GET /api/mcp/skills/:id/content — 获取 Skill 的完整内容 (L2) ──
  router.get('/skills/:id/content', async (c) => {
    const skillId = c.req.param('id')
    const content = ctx.skillLoader.loadSkillContent(skillId)
    if (!content) {
      throw new AppError('NOT_FOUND', { message: `Skill "${skillId}" 不存在` })
    }
    return c.json({ code: 'OK', message: '获取成功', data: { id: skillId, content } })
  })

  // ── POST /api/mcp/skills/reload — 重新扫描所有 Skill 目录 ──
  router.post('/skills/reload', async (c) => {
    ctx.skillLoader.reloadAll()
    const manifests = ctx.skillLoader.getAllManifests()
    return c.json({
      code: 'OK',
      message: `已重新加载 ${manifests.length} 个 Skill`,
      data: manifests,
    })
  })

  // ── POST /api/mcp/skills/import — 导入本地 Skill 文件夹 ──
  router.post('/skills/import', async (c) => {
    const body = await c.req.json<{ sourcePath: string }>()
    const sourcePath = body.sourcePath?.trim()

    if (!sourcePath) {
      throw new AppError('VALIDATION_ERROR', { message: 'sourcePath 为必填字段' })
    }

    // 业务逻辑下沉到 SkillLoader (Service 层)
    const folderName = ctx.skillLoader.importFromPath(sourcePath)
    const manifests = ctx.skillLoader.getAllManifests()

    return c.json({
      code: 'OK',
      message: `Skill "${folderName}" 已成功导入`,
      data: manifests,
    })
  })

  // ── DELETE /api/mcp/skills/:id — 删除用户 Skill ──
  router.delete('/skills/:id', async (c) => {
    const skillId = c.req.param('id')

    // 业务逻辑下沉到 SkillLoader (Service 层)
    ctx.skillLoader.deleteById(skillId)
    const manifests = ctx.skillLoader.getAllManifests()

    return c.json({
      code: 'OK',
      message: `Skill "${skillId}" 已删除`,
      data: manifests,
    })
  })

  return router
}
