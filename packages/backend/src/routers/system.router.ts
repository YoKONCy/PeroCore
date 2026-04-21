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
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { createLogger } from '../lib/logger'

const logger = createLogger('SystemRouter')

/** 应用版本号 (由 scripts/sync-version.ts 自动同步) */
const APP_VERSION = '0.9.0'

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
  router.get('/info', (c) => {
    const agents = ctx.agentManager.listAgents()
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
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          },
        },
        agents: {
          total: agents.length,
          enabled: agents.filter((a) => a.isEnabled).length,
          activeId: ctx.agentManager.activeAgentId,
        },
        gateway: {
          connectedNodes: ctx.gatewayHub.connectedCount,
        },
      },
    })
  })

  // POST /api/system/open-path — 通过系统打开路径 (P2-13)
  router.post('/open-path', async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const targetPath = (body as Record<string, unknown>).path as string
    if (!targetPath?.trim()) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 path 参数',
        data: { field: 'path' },
      })
    }

    try {
      const { exec } = await import('node:child_process')
      const platform = process.platform
      const cmd =
        platform === 'win32'
          ? `start "" "${targetPath}"`
          : platform === 'darwin'
            ? `open "${targetPath}"`
            : `xdg-open "${targetPath}"`

      exec(cmd, (err) => {
        if (err) {
          logger.error(`打开路径失败: ${err.message}`)
        }
      })

      return c.json({ code: 'OK', message: '已请求打开' })
    } catch (err) {
      throw new AppError('INTERNAL_ERROR', {
        message: `打开失败: ${err instanceof Error ? err.message : err}`,
      })
    }
  })

  return router
}
