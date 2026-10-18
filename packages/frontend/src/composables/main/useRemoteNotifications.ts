import { onUnmounted, watch, type Ref } from 'vue'
import { useNotificationStore, type NotificationType } from '../../stores/useNotificationStore'
import { logger } from '../../lib/logger'

type Payload = Record<string, unknown>
interface Gateway {
  isConnected: Ref<boolean>
  onPush: (action: string, callback: (payload: Payload) => void) => void
  offPush: (action: string, callback: (payload: Payload) => void) => void
  request: (action: string, payload?: Payload) => Promise<Payload>
}
type Receipt = { notificationId: string; revision: number }

/** 实时通知立即显示；离线与历史补送汇总展示，展示后再确认通知回执。 */
export function useRemoteNotifications(gateway: Gateway) {
  const store = useNotificationStore()
  const openedAt = Date.now()
  const history = new Map<string, Payload>()
  const receipts = new Map<string, Map<string, Receipt>>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let sending = false
  let disposed = false

  function schedule(delay = 180) {
    if (disposed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, delay)
  }
  function receipt(payload: Payload) {
    const principalId = typeof payload.principalId === 'string' ? payload.principalId : ''
    const notificationId = typeof payload.notificationId === 'string' ? payload.notificationId : ''
    const revision = Number(payload.revision ?? 1)
    if (!principalId || !notificationId || !Number.isSafeInteger(revision) || revision < 1) return
    const group = receipts.get(principalId) ?? new Map<string, Receipt>()
    group.set(notificationId, { notificationId, revision })
    receipts.set(principalId, group)
  }
  async function flush() {
    if (disposed) return
    if (history.size) {
      const batch = [...history.entries()]
      history.clear()
      const failures = batch.filter(([, payload]) => payload.level === 'error').length
      store.toast('详情见任务中心或画布', {
        title: `历史通知 · ${batch.length} 条${failures ? `，${failures} 条失败` : ''}`,
        type: 'info',
        onPresented: () => {
          for (const [id, payload] of batch) {
            store.rememberRemote(id)
            pending.delete(id)
            receipt(payload)
          }
          schedule()
        },
      })
    }
    if (sending || !gateway.isConnected.value || !receipts.size) return
    sending = true
    try {
      for (const [principalId, group] of receipts) {
        while (group.size && !disposed) {
          const batch = [...group.values()].slice(0, 200)
          await gateway.request('gateway.notifications.ack', { principalId, receipts: batch })
          for (const item of batch)
            if (group.get(item.notificationId)?.revision === item.revision)
              group.delete(item.notificationId)
        }
        if (!group.size) receipts.delete(principalId)
      }
    } catch (error) {
      // 回执失败只留待重连或稍后重试，不制造新的错误弹窗。
      logger.debug('NotificationInbox', '通知回执暂未确认', error)
    } finally {
      sending = false
      if (receipts.size && gateway.isConnected.value) schedule(5000)
    }
  }
  function receive(payload: Payload, durable: boolean) {
    const id = typeof payload.notificationId === 'string' ? payload.notificationId : ''
    if (id && store.wasRemotePresented(id)) {
      if (durable) receipt(payload)
      schedule()
      return
    }
    if (id && pending.has(id)) return
    if (id) pending.add(id)
    const createdAt = typeof payload.createdAt === 'string' ? Date.parse(payload.createdAt) : NaN
    if (
      durable &&
      id &&
      (payload.replayed === true || (Number.isFinite(createdAt) && createdAt < openedAt))
    ) {
      history.set(id, payload)
    } else {
      const level = ['info', 'success', 'warning', 'error'].includes(String(payload.level))
        ? (payload.level as NotificationType)
        : 'info'
      store.toastRemote(id, String(payload.body || payload.title || '系统通知'), {
        title: typeof payload.title === 'string' ? payload.title : undefined,
        type: level,
        duration: Number(payload.duration ?? 4000),
        onPresented: () => {
          pending.delete(id)
          if (durable) receipt(payload)
          schedule()
        },
      })
    }
    schedule()
  }
  const regular = (payload: Payload) => receive(payload, false)
  const durable = (payload: Payload) => receive(payload, true)
  gateway.onPush('notification', regular)
  gateway.onPush('durable_notification', durable)
  const stop = watch(gateway.isConnected, (connected) => {
    if (connected) schedule()
  })
  onUnmounted(() => {
    disposed = true
    if (timer) clearTimeout(timer)
    stop()
    gateway.offPush('notification', regular)
    gateway.offPush('durable_notification', durable)
  })
}
