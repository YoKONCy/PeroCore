import path from 'node:path'
import { app, Notification } from 'electron'
import { paths } from '../utils/env'
import { logger } from '../utils/logger'
import { CompletionAlertController } from './completionAlertController'
import { playCompletionTone, stopCompletionTone } from './completionTone'
import { isApplicationFocused } from './notificationVisibility'
import type { CompletionAlert } from '@infos/shared'

function openResult(alert: CompletionAlert): void {
  void import('../windows/manager')
    .then(async ({ windowManager }) => {
      const { desktopTabs } = await import('../windows/desktopTabs')
      const win = windowManager.createDashboardWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      desktopTabs.openHome(alert.kind === 'task' ? 'tasks' : 'chat', {
        agentId: alert.agentId,
        threadId: alert.threadId,
        messageId: alert.messageId,
        taskId: alert.taskId,
      })
    })
    .catch((error) => logger.warn('完成通知结果跳转失败', String(error)))
}

export const completionAlerts = new CompletionAlertController(
  path.join(paths.userData, 'completion-alerts.json'),
  path.join(paths.userData, 'completion-alerts-seen.json'),
  {
    applicationFocused: isApplicationFocused,
    petVisible: async () =>
      (await import('../windows/manager')).windowManager.getPetWindowState().visible,
    playSound: playCompletionTone,
    stopSound: stopCompletionTone,
    windowsNotificationsSupported: () =>
      process.platform === 'win32' && app.isReady() && Notification.isSupported(),
    showNotification: (alert) => {
      const notification = new Notification({
        title: `${alert.agentName} 完成了任务`,
        body: alert.title,
        silent: true,
      })
      notification.on('click', () => openResult(alert))
      notification.on('failed', (_event, error) =>
        logger.warn('Windows 完成通知发送失败', String(error)),
      )
      notification.show()
    },
    warn: (message, error) => logger.warn(message, String(error)),
  },
)
