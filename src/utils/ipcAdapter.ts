declare global {
  interface Window {
    electron?: {
      invoke: (channel: string, ...args: any[]) => Promise<any>
      send: (channel: string, ...args: any[]) => void
      getBackendConnectionConfigSync: () => {
        mode: 'local' | 'remote'
        baseUrl: string
        apiBase: string
        wsBase: string
        configured: boolean
      }
      on: (channel: string, listener: (event: any, ...args: any[]) => void) => () => void
      scanLocalModels: () => Promise<any[]>
    }
  }
}

import { buildAuthenticatedWebSocketUrl, desktopAuthState } from '@/api/runtimeAuth'

export const isElectron = () => !!window.electron

// Web Bridge 支持
let ws: WebSocket | null = null
const listeners = new Map<string, Set<(payload: any) => void>>()

const initWs = () => {
  if (isElectron() || ws) return
  if (!desktopAuthState.bootstrapped) return
  if (desktopAuthState.required && !desktopAuthState.authorized) return

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = buildAuthenticatedWebSocketUrl(`${protocol}//${window.location.host}/ws/browser`)

  console.log('[IPC Adapter] 正在连接到 Web Bridge:', wsUrl)
  ws = new WebSocket(wsUrl)

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'event' && data.channel) {
        const handlers = listeners.get(data.channel)
        if (handlers) {
          // WebBridge 发送数组参数，取首个作为 payload
          const payload = data.args && data.args.length > 0 ? data.args[0] : undefined
          handlers.forEach((h) => h(payload))
        }
      }
    } catch (e) {
      console.error('[IPC Adapter] WS 消息解析错误:', e)
    }
  }

  ws.onclose = () => {
    console.log('[IPC Adapter] Web Bridge 已断开连接。3秒后重连...')
    ws = null
    setTimeout(initWs, 3000)
  }

  ws.onerror = (err) => {
    console.error('[IPC Adapter] Web Bridge 连接错误:', err)
  }
}

export const invoke = async (cmd: string, args?: any) => {
  if (isElectron()) {
    return window.electron!.invoke(cmd, args)
  }

  // 浏览器模式: 本地拦截特定指令
  if (cmd.startsWith('window-')) {
    console.log('[IPC Adapter] 模拟窗口指令:', cmd)
    return null
  }

  if (cmd === 'open-external' || cmd === 'shell:open') {
    const url = Array.isArray(args) ? args[0] : args
    if (url && (url.startsWith('http') || url.startsWith('mailto'))) {
      window.open(url, '_blank')
      return true
    }
    console.warn('[IPC Adapter] 无法在浏览器中打开非 Web URL:', url)
    return false
  }

  if (cmd === 'get-platform') {
    return 'web' // 或者 'docker'
  }

  // 浏览器模式 (HTTP Bridge)
  try {
    // 包装参数适配 WebBridge
    const response = await fetch(`/api/ipc/${cmd}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args !== undefined ? [args] : [])
    })

    if (!response.ok) {
      throw new Error(`HTTP 错误: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    if (data.error) {
      throw new Error(data.error)
    }
    return data.result
  } catch (e) {
    console.error(`[IPC Adapter] 调用 '${cmd}' 失败:`, e)

    // UI 指令安全回退
    if (cmd.startsWith('window-')) return null

    throw e
  }
}

export const listen = async (event: string, handler: (payload: any) => void) => {
  if (isElectron()) {
    return window.electron!.on(event, (_e: any, ...args: any[]) => handler(args[0]))
  }

  initWs()

  // 浏览器模式 (WebSocket)
  if (!listeners.has(event)) {
    listeners.set(event, new Set())
  }
  listeners.get(event)!.add(handler)

  // 返回取消订阅函数
  return () => {
    const handlers = listeners.get(event)
    if (handlers) {
      handlers.delete(handler)
      if (handlers.size === 0) {
        listeners.delete(event)
      }
    }
  }
}

export const emit = async (event: string, payload?: any) => {
  if (isElectron()) {
    return window.electron!.invoke('emit_event', { event, payload })
  }

  // 浏览器模式: emit 映射为 invoke
  return invoke('emit_event', { event, payload })
}
