import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentService } from '@infos/backend/services/attachment/attachmentService'

function createService(rootDir = 'C:\\safe\\attachments') {
  const repo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByIds: vi.fn(),
    bind: vi.fn(),
    listByMessageIds: vi.fn(),
    markDeletedUnbound: vi.fn(),
  }
  const threadRepo = { getThread: vi.fn(() => Promise.resolve({ id: 'thread-1' })) }
  return {
    service: new AttachmentService(repo as never, threadRepo as never, rootDir),
    repo,
  }
}

describe('AttachmentService', () => {
  it('批量读图的所有预览都绑定到回复，避免只有首张图留存', async () => {
    const { service, repo } = createService()
    repo.findById.mockImplementation(async (id) => ({
      id,
      threadId: 'thread-1',
      messageId: null,
      status: 'uploaded',
      metadataJson: JSON.stringify({ resource: { agentId: 'pero', pairId: 'pair-1' } }),
    }))
    await service.bindOutgoing('thread-1', 'pero', 'pair-1', 42, [
      {
        name: 'read_image',
        result: JSON.stringify({
          images: ['a', 'b', 'c'].map((id) => ({
            imagePreview: {
              id,
              name: `${id}.png`,
              kind: 'image',
              mimeType: 'image/png',
              sizeBytes: 10,
            },
          })),
        }),
      },
    ])
    expect(repo.bind).toHaveBeenCalledWith(['a', 'b', 'c'], 'thread-1', 42)
  })
  it('历史消息不把工具预览重复展示成普通附件', async () => {
    const { service, repo } = createService()
    repo.listByMessageIds.mockResolvedValue([
      { id: 'preview-1', messageId: 42, metadataJson: '{"resource":{"toolPreview":true}}' },
      { id: 'user-image', messageId: 41, metadataJson: '{}' },
    ])
    const attachments = await service.listForMessages([41, 42])
    expect(attachments.has(42)).toBe(false)
    expect(attachments.get(41)).toEqual([expect.objectContaining({ id: 'user-image' })])
  })

  it('读图预览与回复一起绑定，转述失败也保留用户可浏览的图片', async () => {
    const { service, repo } = createService()
    repo.findById.mockResolvedValue({
      id: 'preview-1',
      threadId: 'thread-1',
      messageId: null,
      status: 'uploaded',
      metadataJson: JSON.stringify({ resource: { agentId: 'pero', pairId: 'pair-1' } }),
    })
    await service.bindOutgoing('thread-1', 'pero', 'pair-1', 42, [
      {
        name: 'read_image',
        isError: true,
        result: JSON.stringify({
          success: false,
          error: '转述不可用',
          imagePreview: {
            id: 'preview-1',
            kind: 'image',
            name: '图片.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
          },
        }),
      },
    ])
    expect(repo.bind).toHaveBeenCalledWith(['preview-1'], 'thread-1', 42)
  })

  it('即使按 PDF 命名也拒绝无效 PDF，不将未知字节交给解析器', async () => {
    const { service, repo } = createService()
    const file = new File([new Uint8Array([1, 2, 3])], 'test.pdf', { type: 'application/pdf' })
    await expect(service.upload(file, 'thread-1')).rejects.toMatchObject({
      code: 'INVALID_FORMAT',
    })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('未配置外部来源时保存 PDF 原件，等待工作模式按需读取', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'infos-document-upload-'))
    const { service, repo } = createService(rootDir)
    repo.create.mockImplementation(async (value) => ({
      ...value,
      messageId: null,
      contextPolicy: 'once',
    }))
    try {
      const file = new File(['%PDF-1.7\n%%EOF'], '资料.pdf', { type: 'application/pdf' })
      expect(await service.upload(file, 'thread-1')).toMatchObject({
        kind: 'pdf',
        status: 'uploaded',
      })
      expect(repo.create.mock.calls[0]?.[0].extractedText).toBeUndefined()
      expect(service.capabilities()).toMatchObject({ pdf: true, office: true })
      const office = new File([new Uint8Array([0x50, 0x4b, 3, 4])], '预算.xlsx', {
        type: 'application/octet-stream',
      })
      expect(await service.upload(office, 'thread-1')).toMatchObject({
        kind: 'file',
        status: 'uploaded',
      })
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('允许 20MB 图片并拒绝超过 20MB 的图片', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'infos-attachments-'))
    const { service, repo } = createService(rootDir)
    repo.create.mockImplementation(async (value) => ({
      ...value,
      messageId: null,
      contextPolicy: 'once',
      status: 'uploaded',
      createdAt: null,
      boundAt: null,
    }))

    try {
      const accepted = new File([new Uint8Array(20 * 1024 * 1024)], '边界.png', {
        type: 'image/png',
      })
      await expect(service.upload(accepted, 'thread-1')).resolves.toMatchObject({
        kind: 'image',
        sizeBytes: 20 * 1024 * 1024,
      })

      const oversized = new File([new Uint8Array(20 * 1024 * 1024 + 1)], '超限.png', {
        type: 'image/png',
      })
      await expect(service.upload(oversized, 'thread-1')).rejects.toMatchObject({
        code: 'BAD_REQUEST',
        httpStatus: 400,
      })
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  it('拒绝越界 storageKey', () => {
    const { service } = createService()
    expect(() => service.resolveStoragePath('../secret')).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })

  it('绑定校验要求附件属于当前 Thread 且未绑定', async () => {
    const { service, repo } = createService()
    repo.findByIds.mockResolvedValue([
      { id: 'a', threadId: 'other', status: 'uploaded', messageId: null },
    ])
    await expect(service.validateForBinding(['a'], 'thread-1')).rejects.toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    )
  })
})
