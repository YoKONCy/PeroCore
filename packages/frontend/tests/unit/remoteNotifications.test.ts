// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteNotifications } from '../../src/composables/main/useRemoteNotifications'
import { useNotificationStore } from '../../src/stores/useNotificationStore'

vi.mock('../../src/lib/logger', () => ({ logger: { debug: vi.fn() } }))
const wrappers: Array<{ unmount(): void }> = []
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.setSystemTime(new Date('2026-10-15T06:00:00Z'))
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllTimers()
  vi.useRealTimers()
})

function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const handlers = new Map<string, (payload: Record<string, unknown>) => void>()
  const gateway = {
    isConnected: ref(true),
    request: vi.fn().mockResolvedValue({ acknowledged: 1 }),
    onPush: (name: string, handler: (payload: Record<string, unknown>) => void) => {
      handlers.set(name, handler)
    },
    offPush: (name: string) => {
      handlers.delete(name)
    },
  }
  wrappers.push(
    mount(
      defineComponent({
        setup() {
          useRemoteNotifications(gateway)
          return () => h('div')
        },
      }),
      { global: { plugins: [pinia] } },
    ),
  )
  return {
    gateway,
    store: useNotificationStore(),
    emit: (payload: Record<string, unknown>) => handlers.get('durable_notification')?.(payload),
  }
}

describe('远程通知恢复', () => {
  it('历史画布结果与重复补游标只汇总一次，展示后确认通知回执', async () => {
    const { store, emit, gateway } = setup()
    for (const [id, level] of [
      ['edit-1', 'error'],
      ['generate-1', 'success'],
      ['edit-2', 'error'],
    ]) {
      const notice = {
        notificationId: id,
        principalId: 'pero',
        revision: 1,
        level,
        title: '图像编辑',
        replayed: true,
      }
      emit(notice)
      emit(notice)
    }
    expect(store.toasts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]!.title).toBe('历史通知 · 3 条，2 条失败')
    expect(store.toasts[0]!.type).toBe('info')
    expect(gateway.request).toHaveBeenCalledWith('gateway.notifications.ack', {
      principalId: 'pero',
      receipts: [
        { notificationId: 'edit-1', revision: 1 },
        { notificationId: 'generate-1', revision: 1 },
        { notificationId: 'edit-2', revision: 1 },
      ],
    })
    emit({ notificationId: 'edit-1', principalId: 'pero', revision: 1, replayed: true })
    await vi.advanceTimersByTimeAsync(200)
    expect(store.toasts).toHaveLength(1)
  })

  it('真正的新失败仍即时显示原始标题，回执失败不追加错误弹窗', async () => {
    const { store, emit, gateway } = setup()
    gateway.request.mockRejectedValue(new Error('网络暂时不可用'))
    emit({
      notificationId: 'new-failure',
      principalId: 'pero',
      revision: 1,
      title: '任务失败 · 图像编辑',
      body: '接口返回失败',
      level: 'error',
      createdAt: new Date().toISOString(),
    })
    expect(store.toasts).toHaveLength(1)
    expect(store.toasts[0]).toMatchObject({
      title: '任务失败 · 图像编辑',
      type: 'error',
      message: '接口返回失败',
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(store.toasts).toHaveLength(1)
    emit({ notificationId: 'new-failure', principalId: 'pero', revision: 1, replayed: true })
    expect(store.toasts).toHaveLength(1)
  })

  it('旧投递在启动后补发，仍按任务原始完成时间归入历史', async () => {
    const { store, emit } = setup()
    emit({
      notificationId: 'old-delivery',
      principalId: 'pero',
      revision: 1,
      createdAt: '2026-10-01T00:00:00Z',
      title: '图像编辑',
      level: 'error',
    })
    expect(store.toasts).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(store.toasts[0]!.title).toBe('历史通知 · 1 条，1 条失败')
  })
})
