import { describe, expect, it, vi } from 'vitest'
import { createBackgroundTaskRouter } from '@infos/backend/routers/backgroundTask.router'

describe('BackgroundTaskRouter', () => {
  it('send_to_chat 缺少目标 Thread 时应拒绝派发', async () => {
    const dispatch = vi.fn()
    const router = createBackgroundTaskRouter({
      backgroundTaskService: {
        dispatch,
        onEvent: vi.fn(),
      },
      agentManager: {
        getAgent: vi.fn(() => ({ id: 'pero' })),
      },
    } as never)

    const response = await router.request('http://test/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        agentId: 'pero',
        instruction: '整理任务结果',
        completionAction: 'send_to_chat',
      }),
    })

    expect(response.status).toBe(400)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
