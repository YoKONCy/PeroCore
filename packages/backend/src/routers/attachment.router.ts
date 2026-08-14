import { Hono } from 'hono'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'attachment'
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function createAttachmentRouter(ctx: AppContext) {
  const router = new Hono()

  router.post('/', async (c) => {
    const body = await c.req.parseBody({ all: true })
    const fileValue = body.file
    const threadValue = body.threadId
    if (!(fileValue instanceof File) || typeof threadValue !== 'string' || !threadValue) {
      throw new AppError('BAD_REQUEST', { message: 'multipart 请求必须包含 file 和 threadId' })
    }
    const data = await ctx.attachmentService.upload(fileValue, threadValue)
    return c.json({ code: 'OK', message: '附件上传成功', data }, 201)
  })

  router.get('/:id/content', async (c) => {
    const { row, bytes } = await ctx.attachmentService.readContent(c.req.param('id'))
    return new Response(bytes, {
      headers: {
        'Content-Type': row.mimeType,
        'Content-Length': String(bytes.length),
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': contentDisposition(row.originalName),
        'Cache-Control': 'private, no-store',
      },
    })
  })

  router.delete('/:id', async (c) => {
    await ctx.attachmentService.deleteUnbound(c.req.param('id'))
    return c.json({ code: 'OK', message: '附件已删除' })
  })

  return router
}
