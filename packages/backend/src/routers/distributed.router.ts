import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../container'
import { validate as zValidator } from '../lib/validation'

const serverInput = z.object({
  endpoint: z.string().min(1).max(2048),
  token: z.string().max(4096).default(''),
  displayName: z.string().max(120).optional(),
})

/** “分布式”Tab 的 Server 列表、连接探测和手动完整同步 API。 */
export function createDistributedRouter(ctx: AppContext) {
  const router = new Hono()

  router.get('/identity', (c) =>
    c.json({ code: 'OK', message: '获取成功', data: ctx.distributedSyncService.identity() }),
  )

  router.get('/servers', async (c) =>
    c.json({
      code: 'OK',
      message: '获取成功',
      data: await ctx.distributedSyncService.listServers(),
    }),
  )

  router.post('/servers/probe', zValidator('json', serverInput), async (c) =>
    c.json({
      code: 'OK',
      message: '连接成功',
      data: await ctx.distributedSyncService.probe(
        c.req.valid('json').endpoint,
        c.req.valid('json').token,
      ),
    }),
  )

  router.post('/servers', zValidator('json', serverInput), async (c) =>
    c.json(
      {
        code: 'CREATED',
        message: '服务器已保存',
        data: await ctx.distributedSyncService.saveServer(c.req.valid('json')),
      },
      201,
    ),
  )

  router.delete('/servers/:serverId', async (c) =>
    c.json({
      code: 'OK',
      message: '服务器已删除',
      data: { removed: await ctx.distributedSyncService.removeServer(c.req.param('serverId')) },
    }),
  )

  router.post('/snapshot/import', async (c) => {
    const transferKey = c.req.header('X-Sync-Transfer-Key') ?? ''
    const bytes = Buffer.from(await c.req.arrayBuffer())
    return c.json(
      {
        code: 'ACCEPTED',
        message: '完整快照已校验并暂存，将在 Daemon 重启时安全应用',
        data: {
          manifest: await ctx.distributedSyncService.stageEncryptedSnapshot(bytes, transferKey),
          restartRequired: true,
        },
      },
      202,
    )
  })

  router.post('/snapshot', async (c) => {
    const transferKey = c.req.header('X-Sync-Transfer-Key') ?? ''
    const bytes = await ctx.distributedSyncService.createEncryptedSnapshot(transferKey)
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/vnd.infos.full-sync',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
      },
    })
  })

  router.post('/sync/:serverId', async (c) =>
    c.json(
      {
        code: 'ACCEPTED',
        message: '完整快照已校验并暂存，将在 Daemon 重启时安全应用',
        data: {
          manifest: await ctx.distributedSyncService.stageFromServer(c.req.param('serverId')),
          restartRequired: true,
        },
      },
      202,
    ),
  )

  router.get('/pending', async (c) =>
    c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        pending: await ctx.distributedSyncService.pending(),
        lastSync: await ctx.distributedSyncService.lastSync(),
      },
    }),
  )

  router.post('/rollback', async (c) => {
    const staged = await ctx.distributedSyncService.stageRollback()
    return c.json(
      {
        code: staged ? 'ACCEPTED' : 'NOT_FOUND',
        message: staged
          ? '已暂存撤销操作，将在 Daemon 重启时恢复同步前备份'
          : '没有可撤销的同步备份',
        data: { staged, restartRequired: staged },
      },
      staged ? 202 : 404,
    )
  })

  router.post('/capability-invites', (c) => {
    const configuredHost = process.env.PERO_CAPABILITY_PUBLIC_HOST?.trim()
    const host = configuredHost || c.req.header('host')?.split(':')[0] || '127.0.0.1'
    const protocol = configuredHost ? 'wss' : 'ws'
    const port = Number(process.env.PERO_CAPABILITY_PORT ?? 9121)
    return c.json(
      {
        code: 'CREATED',
        message: '一次性能力节点配对邀请已生成',
        data: ctx.capabilityBridge.createPairingInvite(`${protocol}://${host}:${port}`),
      },
      201,
    )
  })

  router.get('/capability-nodes', (c) =>
    c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        nodes: ctx.nodeRegistry.listNodes().filter((node) => node.facets.includes('capability')),
        sessions: ctx.nodeRegistry.listSessions(),
        offers: ctx.capabilityBridge.diagnostics().offers,
      },
    }),
  )

  return router
}
