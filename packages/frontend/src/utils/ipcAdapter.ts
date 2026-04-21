/**
 * @file IPC 适配层 — 前端唯一允许感知运行环境的文件
 * @description 遵循 07_DUAL_DEPLOYMENT.md 严格隔离原则:
 *              - Electron 模式 → window.electron.invoke/on/send
 *              - Browser/Docker 模式 → 降级处理 (HTTP替代 / 静默忽略)
 *
 *              ⚠️ 前端其他任何文件都不允许直接 import 'electron'
 *              所有系统能力必须通过本适配器访问
 *
 * @module packages/frontend/src/utils/ipcAdapter
 */

// ─── 类型声明 ─────────────────────────────────────────
declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, listener: (...args: unknown[]) => void) => () => void
    }
  }
}

// ─── 环境检测 ─────────────────────────────────────────

/** 检测当前是否在 Electron 环境中运行 */
export const isElectron = (): boolean => typeof window !== 'undefined' && !!window.electron

// ─── invoke (请求/响应式 IPC) ─────────────────────────

/**
 * 调用 Electron 主进程或执行降级操作
 *
 * @param cmd IPC 通道名 (kebab-case)
 * @param args 参数
 * @returns 主进程返回值
 *
 * @example
 * // 窗口操作
 * await invoke('window-minimize')
 * await invoke('open-pet-window')
 *
 * // 后端管理
 * await invoke('start-backend', { enableSocialMode: true })
 * const logs = await invoke('get-backend-logs')
 */
export async function invoke(cmd: string, args?: unknown): Promise<unknown> {
  if (isElectron()) {
    return window.electron!.invoke(cmd, args)
  }

  // ─── Browser/Docker 模式降级 ────────────────────
  // 窗口操作: 静默忽略 (浏览器不支持)
  if (cmd.startsWith('window-') || cmd.startsWith('set-') || cmd.startsWith('resize-')) {
    return null
  }

  // 导航操作: 静默忽略 (Docker 模式是单页面)
  if (cmd.startsWith('open-') || cmd.startsWith('hide-') || cmd.startsWith('close-')) {
    // open-root-folder 特殊处理
    if (cmd === 'open-root-folder') return null
    return null
  }

  // 获取版本号: 返回 Web 标识
  if (cmd === 'get-app-version') {
    return 'web'
  }

  // 退出: 无操作
  if (cmd === 'quit-app') {
    return null
  }

  // 系统通知: 使用 Web Notification API
  if (cmd === 'show-notification') {
    const payload = args as { title?: string; body?: string } | undefined
    if (payload && 'Notification' in window) {
      try {
        new Notification(payload.title ?? '', { body: payload.body })
      } catch {
        // 权限未授予，静默忽略
      }
    }
    return null
  }

  // Native 模块: 不可用
  if (cmd.startsWith('native-') || cmd.startsWith('scan-3d') || cmd === 'get-model-load-path') {
    console.warn(`[ipcAdapter] Native 功能在浏览器模式不可用: ${cmd}`)
    return null
  }

  // Steam: 不可用
  if (cmd.startsWith('steam-')) {
    return null
  }

  // NapCat: 不可用
  if (
    cmd.startsWith('napcat-') ||
    cmd.startsWith('start-napcat') ||
    cmd.startsWith('stop-napcat') ||
    cmd === 'get-napcat-logs' ||
    cmd === 'send-napcat-command' ||
    cmd === 'install-napcat' ||
    cmd === 'check-napcat'
  ) {
    console.warn(`[ipcAdapter] NapCat 在浏览器模式不可用: ${cmd}`)
    return null
  }

  // 桌面感知: Electron 专属 (截屏/剪贴板/前台窗口)
  if (
    cmd === 'capture-screen' ||
    cmd === 'get-active-window' ||
    cmd === 'read-clipboard-image' ||
    cmd === 'write-clipboard-image'
  ) {
    console.warn(`[ipcAdapter] 桌面感知功能在浏览器模式不可用: ${cmd}`)
    return null
  }

  // 剪贴板: Browser 模式降级到 Web Clipboard API
  if (cmd === 'read-clipboard') {
    try {
      const text = await navigator.clipboard.readText()
      return { text, hasImage: false, formats: ['text/plain'] }
    } catch {
      return { text: '', hasImage: false, formats: [] }
    }
  }
  if (cmd === 'write-clipboard') {
    try {
      await navigator.clipboard.writeText(args as string)
    } catch {
      // 权限未授予
    }
    return null
  }

  // 系统监控: 不可用
  if (cmd === 'get-system-stats' || cmd === 'start-system-monitor') {
    return null
  }

  // 后端管理: 在 Docker 模式下后端独立运行，不需要通过 Electron 管理
  if (cmd === 'start-backend' || cmd === 'stop-backend') {
    console.info(`[ipcAdapter] Docker 模式下后端独立运行，跳过: ${cmd}`)
    return null
  }

  // 后端日志: Docker 模式可通过 HTTP API 获取
  if (cmd === 'get-backend-logs') {
    console.info('[ipcAdapter] Docker 模式请通过 HTTP API 获取日志')
    return []
  }

  // 未知通道: 打印警告
  console.warn(`[ipcAdapter] 未处理的 IPC 通道: ${cmd}`)
  return null
}

// ─── listen (事件监听) ────────────────────────────────

/**
 * 监听主进程推送的事件
 *
 * @param event 事件名
 * @param handler 处理函数 (接收 payload)
 * @returns 注销函数
 *
 * @example
 * const unlisten = await listen('backend-log', (line) => {
 *   console.log('后端:', line)
 * })
 * // 组件卸载时调用 unlisten()
 */
export async function listen(
  event: string,
  handler: (payload: unknown) => void,
): Promise<() => void> {
  if (isElectron()) {
    return window.electron!.on(event, handler)
  }

  // Browser 模式: 不支持 Electron 推送事件
  // TerminalTab 等功能在 Docker 模式下应通过 Gateway WS 接收日志
  return () => {}
}

// ─── emit (跨窗口广播) ────────────────────────────────

/**
 * 向所有 Electron 窗口广播事件
 * Docker 模式下静默忽略 (单页面不需要跨窗口)
 *
 * @param event 事件名
 * @param payload 数据
 */
export async function emit(event: string, payload?: unknown): Promise<void> {
  if (isElectron()) {
    await window.electron!.invoke('emit-event', { event, payload })
    return
  }
  // Docker 模式: 静默忽略
}

// ─── send (单向消息) ──────────────────────────────────

/**
 * 向主进程发送单向消息 (fire-and-forget)
 * 用于窗口拖拽等高频操作
 */
export function send(channel: string, ...args: unknown[]): void {
  if (isElectron()) {
    window.electron!.send(channel, ...args)
    return
  }
  // Browser 模式: 静默忽略
}
