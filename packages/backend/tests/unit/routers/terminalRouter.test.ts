import { describe, expect, it, vi } from 'vitest'
import { createTerminalRouter } from '@infos/backend/routers/terminal.router'
import { errorHandler } from '@infos/backend/middleware/errorHandler'

function setup(thread: { agentId: string; channel: string } | null) {
  const getOrCreate = vi.fn().mockResolvedValue({ id: 'session-1' })
  const list = vi.fn().mockReturnValue([])
  const archiveCompleted = vi.fn()
  const stopOwned = vi.fn().mockResolvedValue(undefined)
  const create = vi.fn().mockResolvedValue({ id: 'manual' })
  const router = createTerminalRouter({
    threadService: { getThread: vi.fn().mockResolvedValue(thread) },
    productivityRuntime: {
      workspace: { getWorkspaceRoot: () => 'C:/workspace/pero' },
      sessions: { getOrCreate },
      terminals: { list, archiveCompleted, stopOwned, create },
    },
  } as never)
  router.onError(errorHandler)
  return { router, getOrCreate, list, archiveCompleted, stopOwned, create }
}

describe('终端会话校验', () => {
  it('归档和停止 Agent 使用不同回收入口，手动创建显式归属用户', async () => {
    const { router, archiveCompleted, stopOwned, create } = setup({
      agentId: 'pero',
      channel: 'desktop',
    })
    const request = (url: string, data: object) =>
      router.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'pero', threadId: 'thread-1', ...data }),
      })
    expect((await request('/cleanup', { action: 'archive_completed' })).status).toBe(200)
    expect(archiveCompleted).toHaveBeenCalledWith('session-1')
    expect(stopOwned).not.toHaveBeenCalled()
    expect((await request('/cleanup', { action: 'stop_agent' })).status).toBe(200)
    expect(stopOwned).toHaveBeenCalledWith('session-1')
    expect((await request('/', {})).status).toBe(200)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'user', executionSessionId: 'session-1' }),
    )
  })

  it('有效 desktop 会话可以查询终端', async () => {
    const { router, list } = setup({ agentId: 'pero', channel: 'desktop' })
    const response = await router.request('/?agentId=pero&threadId=thread-1')
    expect(response.status).toBe(200)
    expect(list).toHaveBeenCalledWith('session-1')
  })

  it.each([
    [null, 404, 'NOT_FOUND'],
    [{ agentId: 'nana', channel: 'desktop' }, 403, 'FORBIDDEN'],
    [{ agentId: 'pero', channel: 'group' }, 403, 'FORBIDDEN'],
  ] as const)('拒绝无效身份并返回可区分的原因：%j', async (thread, status, code) => {
    const { router, getOrCreate } = setup(thread)
    const response = await router.request('/?agentId=pero&threadId=thread-1')
    expect(response.status).toBe(status)
    expect(((await response.json()) as { code: string }).code).toBe(code)
    expect(getOrCreate).not.toHaveBeenCalled()
  })
})
