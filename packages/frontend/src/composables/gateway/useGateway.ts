/**
 * Gateway WebSocket Composable
 *
 * 管理与后端 GatewayHub 的 WebSocket 连接：
 * - 自动连接 / 断线重连（指数退避）
 * - 事件分发（通知、任务进度、流结束、心跳）
 * - RPC 请求/响应配对 (pendingRequests Map + timeout)
 * - 二进制音频流传输 (sendStream)
 * - 发送消息
 *
 * @module packages/frontend/src/composables/gateway/useGateway
 */

import { ref, onUnmounted } from 'vue'

/** WS 连接状态 */
export type GatewayState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** 后端推送的消息类型 */
export interface GatewayMessage {
  type: string
  payload: Record<string, unknown>
}

/** 通知推送 */
export interface GatewayNotification {
  title: string
  body: string
  severity?: 'info' | 'warn' | 'error'
}

/** 任务进度推送 */
export interface TaskProgress {
  taskId: string
  progress: number
  status: string
  message?: string
}

/** 事件回调 */
export interface GatewayEvents {
  onNotification?: (data: GatewayNotification) => void
  onTaskProgress?: (data: TaskProgress) => void
  onStreamEnd?: (data: { sessionId: string }) => void
  onStreamDelta?: (data: { content: string; sessionId: string }) => void
  onStateUpdate?: (data: Record<string, unknown>) => void
  onToolStatus?: (data: { name: string; state: string; result?: string }) => void
  onAudioChunk?: (data: ArrayBuffer) => void
  onVoiceState?: (data: { sessionId: string; state: string }) => void
  onHeartbeat?: () => void
}

/** RPC 请求超时 (ms) */
const RPC_TIMEOUT_MS = 30_000

/** 等待中的 RPC 请求 */
interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** 重连配置 */
interface ReconnectConfig {
  /** 最大重连次数 */
  maxRetries: number
  /** 初始延迟（毫秒） */
  baseDelay: number
  /** 最大延迟（毫秒） */
  maxDelay: number
}

const DEFAULT_RECONNECT: ReconnectConfig = {
  maxRetries: 10,
  baseDelay: 1000,
  maxDelay: 30000,
}

export function useGateway(events: GatewayEvents = {}) {
  const state = ref<GatewayState>('disconnected')
  const retryCount = ref(0)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let isManualClose = false

  /** RPC 请求/响应配对 Map */
  const pendingRequests = new Map<string, PendingRequest>()

  // ═══ WS URL 计算 ═══

  function getWsUrl(): string {
    const isElectron = (window as unknown as Record<string, unknown>).electron !== undefined
    if (isElectron) {
      return 'ws://localhost:9120/ws/gateway'
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws/gateway`
  }

  // ═══ 连接管理 ═══

  /** 建立 WebSocket 连接 */
  function connect(): void {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    isManualClose = false
    state.value = retryCount.value > 0 ? 'reconnecting' : 'connecting'

    try {
      ws = new WebSocket(getWsUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      state.value = 'connected'
      retryCount.value = 0
      startHeartbeat()
      console.log('[Gateway] WS 已连接')
    }

    ws.onmessage = (event) => {
      // 二进制消息 → 音频 chunk
      if (event.data instanceof ArrayBuffer) {
        events.onAudioChunk?.(event.data)
        return
      }
      if (event.data instanceof Blob) {
        void event.data.arrayBuffer().then((buf) => events.onAudioChunk?.(buf))
        return
      }
      handleMessage(event.data as string)
    }

    ws.onclose = () => {
      state.value = 'disconnected'
      stopHeartbeat()

      if (!isManualClose) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      // onclose 会自动触发，这里不重复处理
    }
  }

  /** 断开连接 */
  function disconnect(): void {
    isManualClose = true
    clearReconnectTimer()
    stopHeartbeat()

    // 清理等待中的 RPC 请求
    for (const [id, pending] of pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('[Gateway] 连接已断开'))
      pendingRequests.delete(id)
    }

    if (ws) {
      ws.close()
      ws = null
    }

    state.value = 'disconnected'
    retryCount.value = 0
  }

  /** 发送消息 (fire-and-forget) */
  function send(type: string, payload: Record<string, unknown> = {}): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Gateway] WS 未连接，无法发送消息')
      return
    }
    ws.send(JSON.stringify({ type, payload }))
  }

  /**
   * RPC 请求 — 发送 request 并等待匹配的 response
   *
   * 基于 pendingRequests Map + timeout 模式。
   * 后端返回 type='response' 且 id 匹配时自动 resolve。
   *
   * @param action - 请求动作名
   * @param payload - 请求负载
   * @param timeoutMs - 超时时间 (默认 30s)
   * @returns 响应负载
   * @throws 超时或连接断开时 reject
   */
  function request(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('[Gateway] WS 未连接，无法发送 RPC 请求'))
        return
      }

      const id = crypto.randomUUID()
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`[Gateway] RPC 超时: ${action} (${timeoutMs}ms)`))
      }, timeoutMs)

      pendingRequests.set(id, { resolve, reject, timer })
      ws.send(JSON.stringify({ id, type: 'request', payload: { action, ...payload } }))
    })
  }

  /**
   * 发送二进制音频流 sendStream()
   *
   * @param audioData - PCM/Opus 音频 ArrayBuffer
   */
  function sendStream(audioData: ArrayBuffer): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[Gateway] WS 未连接，无法发送音频流')
      return
    }
    ws.send(audioData)
  }

  // ═══ 消息分发 ═══

  function handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as GatewayMessage & {
        id?: string
        payload: Record<string, unknown>
      }
      const action = msg.payload?.action as string | undefined

      // ── RPC 响应配对 ──
      if (msg.type === 'response' && msg.id) {
        const pending = pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(msg.id)
          pending.resolve(msg.payload)
          return
        }
      }

      // ── RPC 错误 ──
      if (msg.type === 'error' && msg.id) {
        const pending = pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(msg.id)
          pending.reject(new Error((msg.payload?.message as string) ?? '未知网关错误'))
          return
        }
      }

      // ── 推送事件分发 ──
      switch (action ?? msg.type) {
        case 'notification':
          events.onNotification?.(msg.payload as unknown as GatewayNotification)
          break
        case 'task_progress':
          events.onTaskProgress?.(msg.payload as unknown as TaskProgress)
          break
        case 'stream_delta':
          events.onStreamDelta?.(msg.payload as unknown as { content: string; sessionId: string })
          break
        case 'stream_end':
          events.onStreamEnd?.(msg.payload as unknown as { sessionId: string })
          break
        case 'state_update':
          events.onStateUpdate?.(msg.payload)
          break
        case 'tool_status':
          events.onToolStatus?.(
            msg.payload as unknown as { name: string; state: string; result?: string },
          )
          break
        case 'audio_chunk': {
          // base64 编码的音频 chunk → ArrayBuffer
          const b64 = msg.payload.audio as string
          if (b64 && events.onAudioChunk) {
            const bin = window.atob(b64)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            events.onAudioChunk(bytes.buffer)
          }
          break
        }
        case 'voice_state':
          events.onVoiceState?.(msg.payload as unknown as { sessionId: string; state: string })
          break
        case 'heartbeat':
        case 'heartbeat_ack':
        case 'pong':
          events.onHeartbeat?.()
          break
        default:
          console.debug(`[Gateway] 未知消息: type=${msg.type} action=${action}`)
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  // ═══ 重连逻辑（指数退避） ═══

  function scheduleReconnect(): void {
    if (retryCount.value >= DEFAULT_RECONNECT.maxRetries) {
      console.error(`[Gateway] 已达最大重连次数 (${DEFAULT_RECONNECT.maxRetries})，停止重连`)
      state.value = 'disconnected'
      return
    }

    // 指数退避 + 随机抖动
    const delay = Math.min(
      DEFAULT_RECONNECT.baseDelay * 2 ** retryCount.value + Math.random() * 500,
      DEFAULT_RECONNECT.maxDelay,
    )

    console.log(`[Gateway] ${delay.toFixed(0)}ms 后重连 (第 ${retryCount.value + 1} 次)`)
    state.value = 'reconnecting'

    reconnectTimer = setTimeout(() => {
      retryCount.value++
      connect()
    }, delay)
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  // ═══ 心跳 ═══

  function startHeartbeat(): void {
    stopHeartbeat()
    // 每 30 秒发送 ping，与后端 GatewayHub 心跳周期对齐
    heartbeatTimer = setInterval(() => {
      send('ping')
    }, 30_000)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  // ═══ 生命周期 ═══
  onUnmounted(disconnect)

  return {
    /** 连接状态 */
    state,
    /** 重连次数 */
    retryCount,
    /** 建立连接 */
    connect,
    /** 断开连接 */
    disconnect,
    /** 发送消息 (fire-and-forget) */
    send,
    /** RPC 请求/响应 */
    request,
    /** 发送二进制音频流 */
    sendStream,
  }
}
