import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readImageTool, setImageReadResourceService } from '@infos/backend/tools/fileOps/readImage'
import type { ResourceService } from '@infos/backend/services/attachment/resourceService'
import type { StructuredToolResult } from '@infos/backend/services/execution/toolResult'

const context = { agentId: 'nana', threadId: 'thread-1', signal: new AbortController().signal }
const readImage = vi.fn(async (_context: unknown, source: string) => ({
  bytes: Buffer.from(`原图:${source}`),
  name: source,
  sourceRef: source,
  mimeType: 'image/png',
  sizeBytes: 12,
  hash: source,
}))
const captureImagePreview = vi.fn(async (_context: unknown, image: { name: string }) => ({
  id: image.name.replace('.', '-'),
  name: image.name,
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 12,
}))
const execute = (args: Record<string, unknown>, signal = context.signal) =>
  readImageTool.execute(args, { ...context, signal } as never) as Promise<StructuredToolResult>

beforeEach(() => {
  vi.clearAllMocks()
  setImageReadResourceService({ readImage, captureImagePreview } as unknown as ResourceService)
})

describe('批量读取图片', () => {
  it('单图继续支持独立调用，并返回可重读的原版本快照', async () => {
    const result = await execute({ file_path: 'a.png' })
    expect(JSON.parse(result.output)).toMatchObject({
      name: 'a.png',
      snapshotRef: 'attachment:a-png',
      imagePreview: { id: 'a-png' },
    })
    expect(result.metadata?.image).toBeDefined()
    expect(result.output).not.toContain('base64')
  })
  it('顺序交付每张原图，并将二进制隔离在内部元数据中', async () => {
    const result = await execute({ file_paths: ['before.png', 'after.png'] })
    expect(result.ok).toBe(true)
    expect(JSON.parse(result.output).images.map((image: { name: string }) => image.name)).toEqual([
      'before.png',
      'after.png',
    ])
    const images = result.metadata?.images as Array<{ dataUri: string }>
    expect(
      images.map((image) => Buffer.from(image.dataUri.split(',')[1]!, 'base64').toString()),
    ).toEqual(['原图:before.png', '原图:after.png'])
    expect(result.output).not.toContain('base64')
  })
  it('局部失败不丢弃其他图片，也不改变观察顺序', async () => {
    readImage.mockRejectedValueOnce(new Error('图片不存在'))
    const result = await execute({ file_paths: ['missing.png', 'good.png'] })
    const output = JSON.parse(result.output)
    expect(result.ok).toBe(true)
    expect(output.images[0].name).toBe('good.png')
    expect(output.errors).toEqual([{ source: 'missing.png', error: '图片不存在' }])
  })
  it('拒绝冲突参数与超过上限的批量请求', async () => {
    await expect(execute({ file_path: 'a.png', file_paths: ['b.png'] })).rejects.toThrow()
    await expect(
      execute({ file_paths: Array.from({ length: 9 }, (_, index) => `${index}.png`) }),
    ).rejects.toThrow()
    expect(readImage).not.toHaveBeenCalled()
  })
  it('超过整批字节预算时保留已读图片，并停止为超额图片创建预览', async () => {
    const bytes = Buffer.alloc(14 * 1024 * 1024)
    const read = (name: string) => ({
      bytes,
      name,
      sourceRef: name,
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      hash: name,
    })
    readImage
      .mockResolvedValueOnce(read('a.png'))
      .mockResolvedValueOnce(read('b.png'))
      .mockResolvedValueOnce(read('c.png'))
    const result = await execute({ file_paths: ['a.png', 'b.png', 'c.png'] })
    const output = JSON.parse(result.output)
    expect(output.images).toHaveLength(2)
    expect(output.totalBytes).toBe(28 * 1024 * 1024)
    expect(output.errors[0].error).toContain('40 MB')
    expect(captureImagePreview).toHaveBeenCalledTimes(2)
  })
  it('父任务取消时不会把取消当作普通图片错误继续读取', async () => {
    const controller = new AbortController()
    readImage.mockImplementationOnce(async () => {
      controller.abort(new Error('任务已停止'))
      throw controller.signal.reason
    })
    await expect(execute({ file_paths: ['a.png', 'b.png'] }, controller.signal)).rejects.toThrow(
      '任务已停止',
    )
    expect(readImage).toHaveBeenCalledTimes(1)
    expect(captureImagePreview).not.toHaveBeenCalled()
  })
})
