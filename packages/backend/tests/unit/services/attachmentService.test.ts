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
  it('拒绝 PDF 并返回 415 业务错误', async () => {
    const { service } = createService()
    const file = new File([new Uint8Array([1, 2, 3])], 'test.pdf', { type: 'application/pdf' })
    await expect(service.upload(file, 'thread-1')).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      httpStatus: 415,
    })
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
    expect(() => service.resolveStoragePath('../secret')).toThrow('附件存储键非法')
  })

  it('绑定校验要求附件属于当前 Thread 且未绑定', async () => {
    const { service, repo } = createService()
    repo.findByIds.mockResolvedValue([
      { id: 'a', threadId: 'other', status: 'uploaded', messageId: null },
    ])
    await expect(service.validateForBinding(['a'], 'thread-1')).rejects.toThrow(
      '附件必须属于当前 Thread 且尚未绑定',
    )
  })
})
