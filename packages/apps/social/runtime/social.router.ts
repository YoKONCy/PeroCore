/**
 * Social Router — 社交模式 HTTP + WebSocket 端点
 *
 * 提供:
 * - GET  /api/social/status   适配器连接状态
 * - POST /api/social/send     手动发送消息 (调试用)
 * - GET  /api/social/ws       NapCat 反向 WebSocket 端点 (由主入口 WS 升级)
 *
 * 注意: WS 升级在不同运行时 (Bun/Node) 有不同的 API,
 * 因此 WS 端点的实际 upgrade 逻辑由 app 入口层处理。
 * 本 Router 通过 handleWsMessage / handleWsOpen / handleWsClose 暴露
 * WS 事件处理器给入口层调用。
 *
 * @module packages/apps/social/runtime/social.router
 */

import { Hono } from 'hono'
import type { NapcatAdapter, WsSender } from '../adapters/napcat'
import type { SocialBridge } from './socialBridge'
import type { SocialDataService } from './socialDataService'

/**
 * 创建社交路由
 *
 * 接收 SocialBridge 实例作为参数，不再依赖 AppContext。
 */
export function createSocialRouter(
  socialBridge: SocialBridge,
  deps?: {
    dataService: SocialDataService
    getModeConfig: () => Record<string, unknown>
    updateModeConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>>
    getAgentConfig: () => { agentId: string }
    updateAgentConfig: (agentId: string) => Promise<{ agentId: string; closedSessions: number }>
  },
) {
  const router = new Hono()

  // ── GET /api/social/status — 获取所有适配器状态 ──
  router.get('/status', async (c) => {
    const statuses = await socialBridge.getAllStatus()
    return c.json({
      code: 'OK',
      message: '获取社交状态成功',
      data: { adapters: statuses },
    })
  })

  // ── POST /api/social/send — 手动发送消息 (调试) ──
  router.post('/send', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const platform = (body.platform as string) ?? 'qq'
    const channelId = body.channelId as string
    const channelType = (body.channelType as string) ?? 'private'
    const content = body.content as string

    if (!channelId || !content) {
      return c.json({ code: 'BAD_REQUEST', message: '缺少 channelId 或 content' }, 400)
    }

    await socialBridge.sendReply(platform, {
      channelId,
      channelType: channelType as 'private' | 'group',
      content,
    })

    return c.json({ code: 'OK', message: '消息已发送' })
  })

  router.get('/mode-config', (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    return c.json({ code: 'OK', message: '获取社交模式配置成功', data: deps.getModeConfig() })
  })

  router.put('/mode-config', async (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const data = await deps.updateModeConfig(body)
    return c.json({ code: 'OK', message: '社交模式配置已保存', data })
  })

  router.get('/agent-config', (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    return c.json({ code: 'OK', message: '获取社交角色成功', data: deps.getAgentConfig() })
  })

  router.put('/agent-config', async (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
    if (!agentId) return c.json({ code: 'BAD_REQUEST', message: '缺少 agentId' }, 400)
    try {
      const data = await deps.updateAgentConfig(agentId)
      return c.json({ code: 'OK', message: '社交角色已切换', data })
    } catch (error) {
      return c.json(
        { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : String(error) },
        400,
      )
    }
  })

  router.get('/projection/:agentId', async (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交数据服务未初始化' }, 503)
    const agentId = c.req.param('agentId')
    return c.json({
      code: 'OK',
      message: '获取社交Surface成功',
      data: await deps.dataService.project(agentId),
    })
  })

  router.get('/contacts/:agentId', async (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交数据服务未初始化' }, 503)
    const contacts = await deps.dataService.listContacts(c.req.param('agentId'))
    return c.json({ code: 'OK', message: '获取联系人成功', data: { contacts } })
  })

  router.post('/history-sync/:platform', async (c) => {
    const platform = c.req.param('platform')
    await socialBridge.syncOfflineHistory(platform)
    return c.json({ code: 'OK', message: '离线历史同步完成' })
  })

  router.post('/data/clear', async (c) => {
    if (!deps) return c.json({ code: 'SERVICE_UNAVAILABLE', message: '社交数据服务未初始化' }, 503)
    const result = await deps.dataService.clear(
      (await c.req.json().catch(() => ({}))) as Record<string, unknown>,
    )
    if ('error' in result) return c.json({ code: 'BAD_REQUEST', message: result.error }, 400)
    if ('precondition' in result) {
      return c.json({ code: 'PRECONDITION_FAILED', message: result.precondition }, 422)
    }
    return c.json({ code: 'OK', message: result.message, data: result.data })
  })

  return router
}

// ─────────────────────────────────────────────
// WS 事件处理辅助 (供入口层调用)
// ─────────────────────────────────────────────

/**
 * 获取 NapCat 适配器引用
 *
 * 供入口层（如 Bun.serve 的 websocket 回调）在 WS 连接时使用。
 */
export function getNapcatAdapter(socialBridge: SocialBridge): NapcatAdapter | undefined {
  return socialBridge.getAdapter('qq') as NapcatAdapter | undefined
}

/**
 * 创建 WsSender 包装器
 *
 * 将运行时特定的 WebSocket 实例包装为统一的 WsSender 接口。
 */
export function createWsSender(ws: { send: (data: string) => void; close: () => void }): WsSender {
  return {
    send: (data: string) => ws.send(data),
    close: () => ws.close(),
  }
}
