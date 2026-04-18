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

import { getRuntimeCapabilities } from '@/utils/runtimeCapabilities'

export const isElectron = () => !!window.electron

// Web Bridge 支持
const listeners = new Map<string, Set<(payload: any) => void>>()

const initWs = () => {
  if (isElectron()) return
}

const emitBrowserEvent = (event: string, payload: any) => {
  const handlers = listeners.get(event)
  if (!handlers) {
    return
  }

  handlers.forEach((handler) => {
    try {
      handler(payload)
    } catch (error) {
      console.error(`[IPC Adapter] 浏览器事件 '${event}' 处理失败:`, error)
    }
  })
}

const readBrowserIpcResponse = async (response: Response): Promise<any> => {
  if (response.status === 204) {
    return null
  }

  try {
    return await response.json()
  } catch {
    return null
  }
}

const unwrapBrowserIpcResponse = (data: any): any => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('error' in data && data.error) {
      throw new Error(String(data.error))
    }

    if ('result' in data) {
      return data.result
    }
  }

  return data ?? null
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

  if (cmd === 'emit_event') {
    const payload = Array.isArray(args) ? args[0] : args
    if (payload?.event) {
      emitBrowserEvent(payload.event, payload.payload)
    }
    return null
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

    const data = await readBrowserIpcResponse(response)
    return unwrapBrowserIpcResponse(data)
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

  if (getRuntimeCapabilities().eventTransport !== 'browser-local') {
    return () => {}
  }

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
  emitBrowserEvent(event, payload)
  return null
}
