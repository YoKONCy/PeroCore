/**
 * attachment.router — HTTP 路由适配层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { Hono } from 'hono'
import type { AppContext } from '../container'
import { AppError } from '../lib/appError'
import { z } from 'zod'
import { validate as zValidator } from '../lib/validation'
import { resourceContent, previewResourceText } from '../services/attachment/resourceContent'
import { HtmlPreviewService } from '../services/attachment/htmlPreviewService'

const referenceSchema = z.object({
  agentId: z.string().min(1),
  threadId: z.string().min(1),
  source: z.string().trim().min(1).max(2048),
  taskId: z.string().max(128).optional(),
})

export function createAttachmentRouter(
  ctx: AppContext,
  previews = new HtmlPreviewService(ctx.resourceService, ctx.attachmentService, ctx.threadService),
) {
  const router = new Hono()

  router.post(
    '/browser-preview',
    zValidator('json', z.union([z.object({ id: z.string().min(1) }).strict(), referenceSchema])),
    async (c) => c.json({ code: 'OK', data: await previews.issue(c.req.valid('json')) }),
  )

  router.post('/resolve-reference', zValidator('json', referenceSchema), async (c) => {
    const input = c.req.valid('json')
    const data = await ctx.resourceService.resolveReference(input, input.source)
    return c.json({ code: 'OK', data })
  })
  router.post(
    '/preview-text',
    zValidator('json', z.union([z.object({ id: z.string().min(1) }), referenceSchema])),
    async (c) => {
      const input = c.req.valid('json')
      const resolved =
        'id' in input
          ? await ctx.attachmentService.contentFile(input.id)
          : await ctx.resourceService.referenceFile(input, input.source)
      const mime = 'row' in resolved ? resolved.row.mimeType : resolved.resource.mimeType
      if (
        !mime.startsWith('text/') &&
        !['application/json', 'application/xml', 'application/svg+xml', 'image/svg+xml'].includes(
          mime,
        )
      )
        throw new AppError('BAD_REQUEST', { message: '此文件不支持文本预览' })
      return c.json({ code: 'OK', data: await previewResourceText(resolved.filePath) })
    },
  )
  router.on(
    ['GET', 'HEAD'],
    '/reference-content',
    zValidator('query', referenceSchema),
    async (c) => {
      const input = c.req.valid('query')
      const { resource, filePath } = await ctx.resourceService.referenceFile(input, input.source)
      return resourceContent(c, filePath, resource.mimeType, resource.name)
    },
  )

  router.get('/capabilities', (c) =>
    c.json({ code: 'OK', message: '获取成功', data: ctx.attachmentService.capabilities() }),
  )
  router.get('/:id', async (c) =>
    c.json({
      code: 'OK',
      message: '获取成功',
      data: ctx.attachmentService.toDto(await ctx.attachmentService.getActive(c.req.param('id'))),
    }),
  )
  router.post('/:id/retry', async (c) =>
    c.json({
      code: 'OK',
      message: '已重新开始解析',
      data: await ctx.attachmentService.retryPdf(c.req.param('id')),
    }),
  )

  router.post('/', async (c) => {
    const body = await c.req.parseBody({ all: true })
    const fileValue = body.file
    const threadValue = body.threadId
    if (!(fileValue instanceof File) || typeof threadValue !== 'string' || !threadValue) {
      throw new AppError('BAD_REQUEST', { message: 'multipart 请求必须包含 file 和 threadId' })
    }
    const data = await ctx.attachmentService.upload(fileValue, threadValue)
    return c.json({ code: 'CREATED', message: '附件上传成功', data }, 201)
  })

  router.on(['GET', 'HEAD'], '/:id/content', async (c) => {
    const { row, filePath } = await ctx.attachmentService.contentFile(c.req.param('id'))
    return resourceContent(c, filePath, row.mimeType, row.originalName)
  })

  router.delete('/:id', async (c) => {
    await ctx.attachmentService.deleteUnbound(c.req.param('id'))
    return c.json({ code: 'OK', message: '附件已删除' })
  })

  return router
}
