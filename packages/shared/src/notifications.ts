/** 原生接收服务与界面共用设备凭据，连接标识分别生成。 */
export type NotificationReceiptState = 'received' | 'presented' | 'read'

export interface NotificationTarget {
  kind: 'conversation' | 'task' | 'reminder' | 'application'
  agentId: string
  threadId?: string
  messageId?: string
  taskId?: string
  scheduleId?: number
  applicationCallId?: string
}

export interface NotificationMetadata {
  source?: string
  target?: NotificationTarget
  /** 只向原生通知服务投递，避免重复触发已有桌面完成提醒。 */
  delivery?: 'all' | 'background'
}

export interface DeviceNotification {
  sequence: number
  notificationId: string
  principalId: string
  revision: number
  title: string
  body?: string
  level: 'info' | 'success' | 'warning' | 'error'
  createdAt: string
  expiresAt: string
  source?: string
  target?: NotificationTarget
  /** 同设备界面正在显示目标会话时，接收服务只落盘，不弹系统横幅。 */
  presentation: 'notify' | 'silent'
}

export interface DeviceNotificationPage {
  notifications: DeviceNotification[]
  nextSequence: number
  latestSequence: number
  hasMore: boolean
  /** 数据库恢复到旧快照等情况下，客户端需要从零重新补收并按 ID 去重。 */
  resetRequired: boolean
}

export interface NotificationReceipt {
  notificationId: string
  revision: number
  state: NotificationReceiptState
}

export type DeviceNotificationRequest =
  | { action: 'gateway.notifications.pull'; afterSequence?: number; limit?: number }
  | { action: 'gateway.notifications.receipt'; receipts: NotificationReceipt[] }
  | { action: 'gateway.notifications.presence'; foreground: boolean; threadId?: string }

export interface NotificationAvailablePayload {
  action: 'notification_available'
  latestSequence: number
}
