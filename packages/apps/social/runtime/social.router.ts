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
import type { SocialMessageRepository } from './socialMessage.repo'
import type { MemoryStoreRegistry } from '../../../backend/src/repositories/storeRegistry'
import type { AgentManager } from '../../../backend/src/services/agent/agentManager'

/**
 * 创建社交路由
 *
 * 接收 SocialBridge 实例作为参数，不再依赖 AppContext。
 */
export function createSocialRouter(
  socialBridge: SocialBridge,
  deps?: {
    messageRepo: SocialMessageRepository
    storeRegistry: MemoryStoreRegistry
    agentManager: AgentManager
    getModeConfig: () => Record<string, unknown>
    updateModeConfig: (config: Record<string, unknown>) => Promise<Record<string, unknown>>
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
    if (!deps) return c.json({ code: 'UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    return c.json({ code: 'OK', message: '获取社交模式配置成功', data: deps.getModeConfig() })
  })

  router.put('/mode-config', async (c) => {
    if (!deps) return c.json({ code: 'UNAVAILABLE', message: '社交配置服务未初始化' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const data = await deps.updateModeConfig(body)
    return c.json({ code: 'OK', message: '社交模式配置已保存', data })
  })

  router.get('/contacts/:agentId', async (c) => {
    if (!deps) return c.json({ code: 'UNAVAILABLE', message: '社交数据服务未初始化' }, 503)
    const contacts = await deps.messageRepo.listContactImpressions(c.req.param('agentId'))
    return c.json({ code: 'OK', message: '获取联系人成功', data: { contacts } })
  })

  router.post('/history-sync/:platform', async (c) => {
    const platform = c.req.param('platform')
    await socialBridge.syncOfflineHistory(platform)
    return c.json({ code: 'OK', message: '离线历史同步完成' })
  })

  router.post('/data/clear', async (c) => {
    if (!deps) return c.json({ code: 'UNAVAILABLE', message: '社交数据服务未初始化' }, 503)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const agentId = String(body.agentId ?? '')
    const scope = String(body.scope ?? '')
    const agent = deps.agentManager.getAgent(agentId)
    if (!agent) return c.json({ code: 'BAD_REQUEST', message: '目标 Agent 不存在' }, 400)

    if (scope === 'channel') {
      const channelType = String(body.channelType ?? '')
      const channelId = String(body.channelId ?? '')
      if (!['private', 'group'].includes(channelType) || !channelId) {
        return c.json({ code: 'BAD_REQUEST', message: '缺少有效的会话类型或会话 ID' }, 400)
      }
      const deletedBefore = Math.floor(Date.now() / 1000)
      await deps.messageRepo.upsertTombstone({
        agentId,
        platform: 'qq',
        channelType,
        channelId,
        deletedBefore,
      })
      const deleted = await deps.messageRepo.deleteChannelMessages(agentId, channelType, channelId)
      return c.json({ code: 'OK', message: '会话记录已清除', data: { deleted } })
    }
    if (scope === 'contact_impression') {
      const userId = String(body.userId ?? '')
      if (!userId) return c.json({ code: 'BAD_REQUEST', message: '缺少用户 ID' }, 400)
      await deps.messageRepo.deleteContactImpression(agentId, 'qq', userId)
      return c.json({ code: 'OK', message: '联系人印象已清除' })
    }
    if (String(body.confirmAgentName ?? '') !== agent.name) {
      return c.json(
        { code: 'CONFIRMATION_REQUIRED', message: `请输入角色名“${agent.name}”确认` },
        400,
      )
    }
    if (scope === 'all_messages') {
      await deps.messageRepo.upsertTombstone({
        agentId,
        platform: 'qq',
        deletedBefore: Math.floor(Date.now() / 1000),
      })
      const deleted = await deps.messageRepo.deleteAllMessages(agentId)
      return c.json({ code: 'OK', message: '全部社交消息已清除', data: { deleted } })
    }
    if (scope === 'long_memory') {
      deps.storeRegistry.resetAgentStore(agentId, 'social')
      return c.json({ code: 'OK', message: '全部社交长记忆已清除' })
    }
    if (scope === 'all_social_data') {
      await deps.messageRepo.upsertTombstone({
        agentId,
        platform: 'qq',
        deletedBefore: Math.floor(Date.now() / 1000),
      })
      const messages = await deps.messageRepo.deleteAllMessages(agentId)
      const impressions = await deps.messageRepo.deleteAllContactImpressions(agentId)
      deps.storeRegistry.resetAgentStore(agentId, 'social')
      return c.json({ code: 'OK', message: '全部社交数据已清除', data: { messages, impressions } })
    }
    return c.json({ code: 'BAD_REQUEST', message: '未知清理范围' }, 400)
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
