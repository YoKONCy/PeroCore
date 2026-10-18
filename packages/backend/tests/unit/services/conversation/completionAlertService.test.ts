import { describe, expect, it, vi } from 'vitest'
import { CompletionAlertService } from '@infos/backend/services/conversation/completionAlertService'
import type { CapabilityDirectory } from '@infos/backend/kernel/capabilityDirectory'
import type { CapabilityHandleRegistry } from '@infos/backend/kernel/capabilityHandleRegistry'
import type { KernelNodeId, CompletionAlert } from '@infos/shared'

function fixture() {
  const offers = [
    {
      offerId: 'client-1',
      health: 'available',
      placement: { providerNodeId: 'client' },
      provider: {},
    },
  ]
  const invoke = vi.fn(
    async (_operation: string, _input: unknown, _context: unknown, _signal: unknown) => ({
      accepted: true,
    }),
  )
  const bind = vi.fn((_input: unknown) => ({ invoke }))
  let changed: () => void = () => {}
  const unsubscribe = vi.fn()
  const directory = {
    listOffers: vi.fn((_requirement?: unknown) => offers),
    bind,
    subscribe: vi.fn((listener: () => void) => {
      changed = listener
      return unsubscribe
    }),
  }
  const handles = { issue: vi.fn((_input: unknown) => ({ handleId: 'handle' })), revoke: vi.fn() }
  const service = new CompletionAlertService(
    directory as unknown as CapabilityDirectory,
    handles as unknown as CapabilityHandleRegistry,
    'server' as KernelNodeId,
  )
  const alert: CompletionAlert = {
    id: 'conversation:thread:message',
    kind: 'conversation',
    agentId: 'pero',
    agentName: 'Pero',
    title: '已完成',
    completedAt: new Date().toISOString(),
  }
  return {
    service,
    offers,
    directory,
    handles,
    invoke,
    changed: () => changed(),
    unsubscribe,
    alert,
  }
}

describe('后端完成提醒投递', () => {
  it('通过独立客户端能力投递，不要求 Input Seat，并复用在线绑定', async () => {
    const { service, directory, handles, invoke, alert } = fixture()
    await service.notify(alert)
    await service.notify({ ...alert, id: 'conversation:thread:next' })
    expect(directory.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        requirement: expect.objectContaining({
          capabilityType: 'client.completion-alert',
          placement: expect.objectContaining({ requiresInputSeat: false }),
        }),
      }),
    )
    expect(invoke).toHaveBeenCalledWith(
      'notify',
      alert,
      expect.objectContaining({ idempotencyKey: alert.id }),
      expect.any(AbortSignal),
    )
    expect(handles.issue).toHaveBeenCalledTimes(1)
    await service.stop()
    expect(handles.revoke).toHaveBeenCalledTimes(1)
  })

  it('客户端未连接时不补发历史，投递异常也不抛给任务主流程', async () => {
    const { service, offers, invoke, alert } = fixture()
    offers[0]!.health = 'unavailable'
    await expect(service.notify(alert)).resolves.toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
    offers[0]!.health = 'available'
    invoke.mockRejectedValueOnce(new Error('客户端连接断开'))
    await expect(service.notify(alert)).resolves.toBeUndefined()
    await service.stop()
  })

  it('客户端断开后释放绑定，重连后重新绑定', async () => {
    const { service, offers, changed, handles, alert } = fixture()
    await service.notify(alert)
    offers[0]!.health = 'unavailable'
    changed()
    offers[0]!.health = 'available'
    changed()
    await service.notify({ ...alert, id: 'next' })
    expect(handles.issue).toHaveBeenCalledTimes(2)
    await service.stop()
    expect(handles.revoke).toHaveBeenCalledTimes(2)
  })
})
