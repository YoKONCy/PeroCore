/**
 * System Router — 系统信息与健康检查
 *
 * 提供系统级 API：
 * - GET /api/system/health   健康检查
 * - GET /api/system/info     系统信息 (版本/运行时/统计)
 *
 * @module packages/backend/src/routers/system.router
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { validate as zValidator } from '../lib/validation'
import { streamSSE } from 'hono/streaming'
import type { AppContext } from '../container'
import { addLogListener, getLogHistory } from '../lib/logBroadcaster'
import { AppError } from '../lib/appError'

/** 应用版本号 (由 scripts/sync-version.ts 自动同步) */
const APP_VERSION = '0.9.3-hotfix2'

export function createSystemRouter(ctx: AppContext) {
  const router = new Hono()

  // GET /api/system/health — 健康检查
  router.get('/health', (c) => {
    return c.json({
      code: 'OK',
      message: '服务运行正常',
      data: {
        status: 'healthy',
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    })
  })

  // GET /api/system/info — 系统信息
  router.get('/info', async (c) => {
    const agents = ctx.agentManager.listAgents()

    // 业务逻辑委托 Service 层 (S05 §2)
    const snapshot = await ctx.systemService.getSnapshot()

    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        version: APP_VERSION,
        runtime: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          uptime: Math.floor(process.uptime()),
          memoryUsage: {
            rss: snapshot.memoryUsedMB,
            heapUsed: snapshot.heapUsedMB,
          },
          cpuPercent: snapshot.cpuPercent,
          totalMemoryMB: snapshot.totalMemoryMB,
        },
        storage: {
          sqliteSizeMB: snapshot.sqliteSizeMB,
          triviumSizeMB: snapshot.triviumSizeMB,
          triviumNodeCount: ctx.storeRegistry.countExistingNodes(agents.map((agent) => agent.id)),
        },
        agents: {
          total: agents.length,
          enabled: agents.filter((a) => a.isEnabled).length,
          activeId: ctx.agentManager.defaultAgentId,
        },
        gateway: {
          connectedNodes: ctx.gatewayHub.connectedCount,
        },
        multiNode: {
          nodes: ctx.nodeRegistry.listNodes(),
          sessions: ctx.nodeRegistry.listSessions(),
          inputSeats: ctx.nodeRegistry.listInputSeats(),
          capabilityTransport: ctx.capabilityBridge.diagnostics(),
        },
      },
    })
  })

  // PUT /api/system/chat-background — 保存客户端已压缩的聊天背景。
  router.put('/chat-background', async (c) => {
    const body = await c.req.parseBody()
    const file = body.background
    if (!(file instanceof File)) throw new AppError('MISSING_FIELD', { message: '请上传背景图片' })
    await ctx.chatBackgroundService.save(file)
    return c.json({
      code: 'OK',
      message: '聊天背景已保存',
      data: { contentUrl: `/system/chat-background/content?v=${Date.now()}` },
    })
  })

  router.get('/chat-background/content', async () => {
    const { bytes, mime } = await ctx.chatBackgroundService.read()
    return new Response(bytes, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-cache',
      },
    })
  })

  router.delete('/chat-background', async (c) => {
    await ctx.chatBackgroundService.remove()
    return c.json({ code: 'OK', message: '聊天背景已删除' })
  })

  // POST /api/system/token-count — 为前端编辑器提供后端统一精确计数。
  router.post(
    '/token-count',
    zValidator('json', z.object({ text: z.string().max(1_000_000) })),
    (c) => {
      const { text } = c.req.valid('json')
      return c.json({
        code: 'OK',
        message: '计算成功',
        data: {
          tokens: ctx.tokenCounter.countTokens(text),
          tokenizer: ctx.tokenCounter.tokenizerId,
        },
      })
    },
  )

  // POST /api/system/storage/sqlite-snapshot — 为云存档生成一致性 SQLite 快照
  router.post('/storage/sqlite-snapshot', async (c) => {
    const data = await ctx.databaseSnapshotService.createCloudSnapshot()
    return c.json({ code: 'OK', message: '数据库快照已生成', data })
  })

  // POST /api/system/open-path — 通过系统打开路径 (P2-13)
  router.post('/open-path', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const targetPath = (body as Record<string, unknown>).path as string

    await ctx.systemService.openPath(targetPath)

    return c.json({ code: 'OK', message: '已请求打开' })
  })

  // GET /api/system/logs/stream — SSE 日志流
  // 支持 EventSource 断线续传 (Last-Event-ID header)
  router.get('/logs/stream', (c) => {
    // 解析 Last-Event-ID（断线重连时 EventSource 自动携带）
    const lastEventId = c.req.header('Last-Event-ID')
    const afterId = lastEventId ? parseInt(lastEventId, 10) : undefined

    return streamSSE(c, async (stream) => {
      // 1. 先发送缓冲区中的历史日志（支持增量续传）
      const history = getLogHistory(afterId)
      for (const event of history) {
        await stream.writeSSE({
          event: 'log',
          id: String(event.id),
          data: JSON.stringify(event),
        })
      }

      // 2. 注册实时监听
      let alive = true
      const unlisten = addLogListener((event) => {
        if (!alive) return
        stream
          .writeSSE({
            event: 'log',
            id: String(event.id),
            data: JSON.stringify(event),
          })
          .catch(() => {
            // 连接已断开，忽略
            alive = false
          })
      })

      // 3. 心跳保活（防止代理/负载均衡器超时断开）
      try {
        while (alive) {
          await stream.writeSSE({ event: 'ping', data: '' })
          await stream.sleep(15000)
        }
      } catch {
        // 客户端断开
      } finally {
        alive = false
        unlisten()
      }
    })
  })

  return router
}
