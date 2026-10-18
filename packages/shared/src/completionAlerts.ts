/** 完成提醒属于客户端偏好，与 Agent 的工具权限无关。 */
export interface CompletionAlertSettings {
  soundEnabled: boolean
  windowsNotificationsEnabled: boolean
}

export const DEFAULT_COMPLETION_ALERT_SETTINGS: Readonly<CompletionAlertSettings> = {
  soundEnabled: true,
  windowsNotificationsEnabled: true,
}

export interface CompletionAlert {
  id: string
  kind: 'conversation' | 'task'
  agentId: string
  agentName: string
  title: string
  completedAt: string
  threadId?: string
  messageId?: string
  taskId?: string
}
