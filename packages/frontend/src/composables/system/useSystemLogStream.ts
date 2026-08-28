/**
 * useSystemLogStream — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { getApiBaseUrl } from '../../api/transport'

export type SystemLogStreamLevel =
  | 'stdout'
  | 'stderr'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'system'

export interface SystemLogStreamEvent {
  level: SystemLogStreamLevel
  tag: string
  line: string
  timestamp: string
}

export interface UseSystemLogStreamOptions {
  onLog: (event: SystemLogStreamEvent) => void
  onOpen?: (url: string) => void
  onReconnect?: () => void
}

const RECONNECT_DELAY_MS = 5000

export function useSystemLogStream(options: UseSystemLogStreamOptions) {
  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(): void {
    disconnect()

    const url = `${getApiBaseUrl()}/system/logs/stream`
    const eventSource = new EventSource(url)
    source = eventSource

    eventSource.addEventListener('open', () => {
      options.onOpen?.(url)
    })

    eventSource.addEventListener('log', (event) => {
      try {
        options.onLog(JSON.parse(event.data) as SystemLogStreamEvent)
      } catch {
        // 解析失败时忽略异常日志
      }
    })

    eventSource.addEventListener('error', () => {
      if (eventSource.readyState !== EventSource.CLOSED) {
        return
      }

      options.onReconnect?.()
      reconnectTimer = setTimeout(() => {
        if (source === eventSource) {
          connect()
        }
      }, RECONNECT_DELAY_MS)
    })
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    source?.close()
    source = null
  }

  return {
    connect,
    disconnect,
  }
}
