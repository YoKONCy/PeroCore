import type { PetConversationTarget } from './petControls'

/** Electron 桌面标签只描述界面实例，不接管应用 Host 和后台任务。 */
export type DesktopTabKind = 'home' | 'new' | 'browser' | 'application' | 'tarot'

export interface DesktopTab {
  id: string
  kind: DesktopTabKind
  title: string
  icon: string
  appId?: string
  targetId?: string
  url?: string
  loading?: boolean
  locked?: boolean
  dirty?: boolean
  error?: string
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface DesktopApplication {
  id: string
  title: string
  description: string
  icon: string
}

export interface DesktopTabsState {
  revision: number
  activeTabId: string
  tabs: DesktopTab[]
  applications: DesktopApplication[]
  homeNavigation?: { section: string; revision: number; conversation?: PetConversationTarget }
}

/** 前端提供 CSS 坐标，主进程转换为原生视图坐标。 */
export interface DesktopTabBounds {
  x: number
  y: number
  width: number
  height: number
}
