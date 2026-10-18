import { describe, expect, it, vi } from 'vitest'
import { ResourceService } from '@infos/backend/services/attachment/resourceService'
import type { AttachmentService } from '@infos/backend/services/attachment/attachmentService'

const context = { agentId: 'pero', threadId: 'thread-1', pairId: 'pair-1', toolCallId: 'call-1' }
const image = {
  bytes: Buffer.from('图片快照'),
  name: '图.png',
  sourceRef: 'C:/workspace/图.png',
  mimeType: 'image/png',
  sizeBytes: 12,
  hash: 'hash-1',
}
function createService() {
  const row = {
    id: 'preview-1',
    threadId: 'thread-1',
    kind: 'image',
    originalName: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.bytes.length,
  }
  const attachments = {
    saveOutgoing: vi.fn(async (_input: Parameters<AttachmentService['saveOutgoing']>[0]) => row),
    getActive: vi.fn(async () => row),
    toDto: vi.fn(() => ({})),
  }
  const threads = { getThread: vi.fn(async () => ({ agentId: 'pero' })) }
  return { attachments, service: new ResourceService(attachments as never, threads as never) }
}

describe('读图预览快照', () => {
  it('截图保存实际画面快照并附上预览引用，当前模型仍接收原始字节', async () => {
    const { service, attachments } = createService()
    const dataUri =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
    const output = await service.captureScreenshotPreviews(
      context,
      JSON.stringify({
        success: true,
        screenshots: [{ index: 0, dataUri, coordinateContext: { displayId: '1' } }],
      }),
    )
    expect(JSON.parse(output).screenshots[0]).toMatchObject({
      dataUri,
      coordinateContext: { displayId: '1' },
      imagePreview: { id: 'preview-1', kind: 'image' },
    })
    expect(attachments.saveOutgoing.mock.calls[0]?.[0]).toMatchObject({
      bytes: Buffer.from(dataUri.split(',')[1]!, 'base64'),
      toolPreview: true,
      threadId: context.threadId,
      pairId: context.pairId,
    })
  })

  it('预览保存失败仍保留截图供模型消费，跨角色则不写附件', async () => {
    const { service, attachments } = createService()
    const input = JSON.stringify({ screenshots: [{ dataUri: 'data:image/png;base64,AAAA' }] })
    const output = JSON.parse(await service.captureScreenshotPreviews(context, input))
    expect(output.screenshots[0]).toMatchObject({
      dataUri: 'data:image/png;base64,AAAA',
      previewError: expect.any(String),
    })
    expect(attachments.saveOutgoing).not.toHaveBeenCalled()
    await expect(
      service.captureScreenshotPreviews({ ...context, agentId: 'nana' }, input),
    ).rejects.toThrow('截图与会话角色不匹配')
  })

  it('保存模型读到的字节并返回附件引用，不把原图写入结果', async () => {
    const { service, attachments } = createService()
    const result = await service.captureImagePreview(context, image)
    expect(attachments.saveOutgoing.mock.calls[0]?.[0]).toMatchObject({
      threadId: context.threadId,
      agentId: context.agentId,
      pairId: context.pairId,
      bytes: image.bytes,
      name: image.name,
      mimeType: image.mimeType,
      kind: 'image',
      toolPreview: true,
    })
    expect(result).toMatchObject({ id: 'preview-1', kind: 'image' })
    expect(result).not.toHaveProperty('bytes')
    expect(result).not.toHaveProperty('dataUri')
  })

  it('同一调用读到更新内容时不会复用旧版本的预览', async () => {
    const { service, attachments } = createService()
    await service.captureImagePreview(context, image)
    await service.captureImagePreview(context, {
      ...image,
      hash: 'hash-2',
      bytes: Buffer.from('新图'),
    })
    const [first, second] = attachments.saveOutgoing.mock.calls.map(([input]) => input)
    expect(first?.callId).not.toBe(second?.callId)
  })

  it('已是附件的图片复用原引用，不重复存储', async () => {
    const { service, attachments } = createService()
    const result = await service.captureImagePreview(context, {
      ...image,
      sourceRef: 'attachment:preview-1',
    })
    expect(result.id).toBe('preview-1')
    expect(attachments.getActive).toHaveBeenCalledWith('preview-1')
    expect(attachments.saveOutgoing).not.toHaveBeenCalled()
  })

  it('取消后不再创建预览', async () => {
    const { service, attachments } = createService()
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.captureImagePreview({ ...context, signal: controller.signal }, image),
    ).rejects.toThrow()
    expect(attachments.saveOutgoing).not.toHaveBeenCalled()
  })
})
