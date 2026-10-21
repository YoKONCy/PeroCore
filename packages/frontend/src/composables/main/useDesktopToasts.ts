import { t as __t } from '../../i18n/index'
import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import type { DesktopToastAction, DesktopToastSnapshot } from '@infos/shared'
import { invoke, isElectron, listen } from '../../utils/ipcAdapter'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { useTaskToastStore } from '../../stores/taskToastStore'
import { logger } from '../../lib/logger'

/** 主窗口保留唯一的通知队列和计时器，原生层只镜像展示。 */
export function useDesktopToasts(theme: Ref<'light' | 'dark'>): void {
  const notification = useNotificationStore(),
    tasks = useTaskToastStore()
  let mounted = false,
    disposed = false,
    revision = 0
  const cleanup: Array<() => void> = []
  function publish(): void {
    if (!mounted || disposed) return
    const snapshot: DesktopToastSnapshot = {
      revision: ++revision,
      theme: theme.value,
      normal: notification.toasts.map(
        ({ id, type, severity, title, message, duration, createdAt }) => ({
          id,
          type,
          severity,
          title,
          message,
          duration,
          createdAt,
        }),
      ),
      tasks: tasks.toasts.map((toast) => ({ ...toast })),
    }
    void invoke('desktop-toasts:update', snapshot).catch((error) =>
      logger.warn('DesktopToasts', __t('logs.frontend.navigation', '通知层同步失败'), error),
    )
  }
  watch([() => notification.toasts, () => tasks.toasts, theme], publish, {
    deep: true,
    flush: 'post',
  })
  onMounted(async () => {
    if (!isElectron()) return
    for (const [event, handler] of [
      [
        'desktop-toasts:visibility',
        (active: unknown) => {
          notification.nativeOverlayActive = active === true
        },
      ],
      [
        'desktop-toasts:action',
        (value: unknown) => {
          const action = value as DesktopToastAction
          if (action.kind === 'normal') notification.removeToast(action.id)
          else if (action.kind === 'task') tasks.dismiss(action.id)
          else if (action.kind === 'hover') tasks.setHovered(action.id, action.hovered)
        },
      ],
    ] as const) {
      const stop = await listen(event, handler)
      if (disposed) {
        stop()
        return
      }
      cleanup.push(stop)
    }
    mounted = true
    publish()
  })
  onUnmounted(() => {
    disposed = true
    for (const stop of cleanup) stop()
    notification.nativeOverlayActive = false
    tasks.hoveredIds.clear()
    if (mounted)
      void invoke('desktop-toasts:update', {
        revision: ++revision,
        theme: theme.value,
        normal: [],
        tasks: [],
      }).catch(() => {})
  })
}
