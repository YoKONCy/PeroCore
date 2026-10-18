/** 通知层只接收展示数据；关闭与悬停动作返回主窗口的原始队列。 */
export interface DesktopToast {
  id: number
  type: 'info' | 'success' | 'warning' | 'error'
  severity: 'silent' | 'toast' | 'modal'
  title?: string
  message: string
  duration: number
  createdAt: number
}

export interface DesktopTaskToast {
  id: string
  type:
    | 'task_started'
    | 'task_progress'
    | 'task_approval_requested'
    | 'task_completed'
    | 'task_failed'
    | 'info'
  agentId?: string
  avatarUrl?: string
  actorName?: string
  title: string
  message: string
  progress?: number | null
  taskId?: string
  createdAt: number
}

export interface DesktopToastSnapshot {
  revision: number
  theme: 'light' | 'dark'
  normal: DesktopToast[]
  tasks: DesktopTaskToast[]
}

export type DesktopToastAction =
  | { kind: 'normal'; id: number }
  | { kind: 'task'; id: string }
  | { kind: 'hover'; id: string; hovered: boolean }
