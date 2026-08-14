import { describe, expect, it, vi } from 'vitest'
import { AttachmentService } from '@infos/backend/services/attachment/attachmentService'

function createService() {
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
    service: new AttachmentService(repo as never, threadRepo as never, 'C:\\safe\\attachments'),
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
