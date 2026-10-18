/** 桌面执行状态仅描述控制权，不表示业务任务已经完成。 */
export interface DesktopControlState {
  phase: 'idle' | 'running' | 'paused' | 'unavailable'
  epoch: number
  reason?: string
  agentId?: string
  threadId?: string
  taskId?: string
  targetTitle?: string
  stopShortcut: string
}

export interface DesktopControlSettings {
  enabled: boolean
  stopShortcut: string
}

export interface DesktopWindowInfo {
  windowId: string
  title: string
  processName: string
  pid: number
  bounds: { x: number; y: number; width: number; height: number }
}

export interface DesktopElementInfo {
  id: string
  name: string
  role: string
  enabled: boolean
  patterns: string[]
  bounds: { x: number; y: number; width: number; height: number }
}
