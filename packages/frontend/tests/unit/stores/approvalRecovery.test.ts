import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useApprovalStore } from '@infos/frontend/stores/useApprovalStore'
import { useCompositorStore } from '@infos/frontend/stores/useCompositorStore'
import type { ApprovalRequest } from '@infos/frontend/api/modules/approvalsApi'
import type { SurfaceId } from '@infos/shared'

const api = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn() }))
vi.mock('@infos/frontend/api/modules/approvalsApi', () => ({ approvalsApi: api }))
vi.mock('@infos/frontend/services/ui/uiSound', () => ({ uiSound: { play: vi.fn() } }))

const request: ApprovalRequest = {
  id: 'approval-1',
  agentId: 'pero',
  channel: 'desktop',
  sessionId: 'execution-1',
  threadId: 'thread-1',
  toolName: 'terminal_execute',
  argsSummary: { command: 'node main.js' },
  reason: '需要确认',
  riskLevel: 'medium',
  status: 'pending',
  createdAt: '2026-10-18T00:00:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  api.resolve.mockResolvedValue({ data: { ...request, status: 'approved' } })
})

describe('审批决策后的恢复隔离', () => {
  it('决策前发出的轮询和迟到推送不能让已完成卡片重新出现', async () => {
    const store = useApprovalStore()
    let complete!: (response: unknown) => void
    api.list.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    store.receive(request)
    const refreshing = store.refresh()
    await store.resolve(request.id, 'allow_once')
    complete({ data: { requests: [request] } })
    await refreshing
    store.receive(request)
    expect(store.pendingCount).toBe(0)
    expect(api.resolve).toHaveBeenCalledOnce()
  })

  it('移除审批只清除对应交互卡片，原工具执行画面继续保留', () => {
    const store = useApprovalStore()
    const compositor = useCompositorStore()
    const descriptor = {
      generation: 'g',
      threadId: 'thread-1',
      principalId: 'pero',
      revision: 1,
      sequence: 1,
      nodes: [],
    }
    compositor.install({
      ...descriptor,
      surfaceId: 'conversation-approval:approval-1' as SurfaceId,
      state: 'committed',
    })
    compositor.install({ ...descriptor, surfaceId: 'active-execution' as SurfaceId, state: 'open' })
    store.receive(request)
    store.remove(request.id)
    expect(compositor.get('conversation-approval:approval-1')).toBeUndefined()
    expect(compositor.get('active-execution')?.state).toBe('open')
    compositor.$dispose()
  })
})
