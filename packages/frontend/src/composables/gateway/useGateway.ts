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

import { ref, computed, onUnmounted } from 'vue'
import {
  validateSurfaceFrame,
  validateVersionedMessage,
  type GatewayEnvelope as SharedGatewayEnvelope,
  type KernelInputSeat,
  type SurfaceFrame,
} from '@infos/shared'
import { getGatewayWsUrl } from '../../api/transport'
import { logger } from '../../lib/logger'

/** WS 连接状态 */
export type GatewayState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** 后端推送的消息类型 */
export interface GatewayMessage {
  type: string
  payload: Record<string, unknown>
}

const sharedGateway = createGatewayClient()

export function useGateway(events: GatewayEvents = {}) {
  const unsubscribeEvents = sharedGateway.subscribeEvents(events)
  onUnmounted(unsubscribeEvents)
  return { ...sharedGateway, disconnect: unsubscribeEvents }
}

export interface GatewayEnvelope extends GatewayMessage {
  protocolVersion: 1
  id?: string
  sourceId?: string
  targetId?: string
  streamId?: string
  sequence?: number
  timestamp?: number
}

type PushHandler = (payload: Record<string, unknown>) => void

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
  onSurface?: (frame: SurfaceFrame) => void
  onStateUpdate?: (data: Record<string, unknown>) => void
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

const CLIENT_NODE_KEY = 'infos.clientNodeId'
function getOrCreateStableNodeId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_NODE_KEY)
    if (existing) return existing
    const nodeId = `client-${crypto.randomUUID()}`
    localStorage.setItem(CLIENT_NODE_KEY, nodeId)
    return nodeId
  } catch {
    return `client-${crypto.randomUUID()}`
  }
}

function isElectronClient(): boolean {
  return typeof window !== 'undefined' && 'electron' in window
}

function detectClientOs(): 'windows' | 'linux' | 'macos' | 'android' | 'ios' | 'web' {
  const platform = navigator.userAgent.toLowerCase()
  if (platform.includes('windows')) return 'windows'
  if (platform.includes('android')) return 'android'
  if (platform.includes('iphone') || platform.includes('ipad')) return 'ios'
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('linux')) return 'linux'
  return 'web'
}

function createGatewayClient() {
  const eventSubscribers = new Set<GatewayEvents>()
  const events: GatewayEvents = {
    onNotification: (data) => eventSubscribers.forEach((item) => item.onNotification?.(data)),
    onTaskProgress: (data) => eventSubscribers.forEach((item) => item.onTaskProgress?.(data)),
    onSurface: (frame) => eventSubscribers.forEach((item) => item.onSurface?.(frame)),
    onStateUpdate: (data) => eventSubscribers.forEach((item) => item.onStateUpdate?.(data)),
    onAudioChunk: (data) => eventSubscribers.forEach((item) => item.onAudioChunk?.(data)),
    onVoiceState: (data) => eventSubscribers.forEach((item) => item.onVoiceState?.(data)),
    onHeartbeat: () => eventSubscribers.forEach((item) => item.onHeartbeat?.()),
  }
  const state = ref<GatewayState>('disconnected')
  const retryCount = ref(0)
  const lastError = ref<string | null>(null)
  const isConnected = computed(() => state.value === 'connected')
  let stableNodeId = getOrCreateStableNodeId()
  const sessionId = ref<string | null>(null)
  const sessionGeneration = ref(0)
  const inputSeat = ref<KernelInputSeat | null>(null)
  const subscriptions = new Map<string, number>()
  const seenMessageIds = new Set<string>()

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let seatRenewTimer: ReturnType<typeof setInterval> | null = null
  let seatRecovery: Promise<void> | null = null
  let isManualClose = false

  /** RPC 请求/响应配对 Map */
  const pendingRequests = new Map<string, PendingRequest>()
  /** 按 action 精确订阅的推送回调，适合页面或组件只监听自己关心的事件。 */
  const pushHandlers = new Map<string, PushHandler[]>()
  /** 通配订阅回调，主要用于调试面板或日志面板观察所有 Gateway 推送。 */
  const wildcardHandlers: PushHandler[] = []

  function createEnvelope(
    type: string,
    payload: Record<string, unknown> = {},
    targetId = 'backend',
  ): GatewayEnvelope {
    return {
      protocolVersion: 1,
      id: crypto.randomUUID(),
      type,
      sourceId: 'frontend',
      targetId,
      timestamp: Date.now(),
      payload,
    }
  }

  function onPush(action: string, handler: PushHandler): void {
    if (action === '*') {
      wildcardHandlers.push(handler)
      return
    }

    const list = pushHandlers.get(action) ?? []
    list.push(handler)
    pushHandlers.set(action, list)
  }

  function offPush(action: string, handler: PushHandler): void {
    if (action === '*') {
      const index = wildcardHandlers.indexOf(handler)
      if (index >= 0) {
        wildcardHandlers.splice(index, 1)
      }
      return
    }

    const list = pushHandlers.get(action)
    if (!list) {
      return
    }

    pushHandlers.set(
      action,
      list.filter((item) => item !== handler),
    )
  }

  // ═══ 连接管理 ═══

  /** Electron 渲染层与主进程能力提供者必须共享 Node ID，确保 Input Seat 能定向到 audio.output Offer。 */
  async function resolveStableNodeId(): Promise<void> {
    if (!isElectronClient() || !window.electron) return
    try {
      const capabilityNodeId = await window.electron.invoke('get-capability-node-id')
      if (typeof capabilityNodeId === 'string' && capabilityNodeId.trim()) {
        stableNodeId = capabilityNodeId.trim()
      }
    } catch (error) {
      logger.warn('Gateway', `读取 Electron 能力节点 ID 失败: ${(error as Error).message}`)
    }
  }

  /** 建立 WebSocket 连接 */
  async function connect(): Promise<void> {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    await resolveStableNodeId()
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return
    }

    isManualClose = false
    state.value = retryCount.value > 0 ? 'reconnecting' : 'connecting'

    try {
      ws = new WebSocket(getGatewayWsUrl())
    } catch (error) {
      lastError.value = (error as Error).message
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      state.value = 'connected'
      retryCount.value = 0
      lastError.value = null
      sendEnvelope(
        createEnvelope('hello', {
          nodeId: stableNodeId,
          principalId: 'pero',
          deviceName: isElectronClient() ? 'Electron Client' : 'Web Client',
          platform: {
            os: detectClientOs(),
            runtime: isElectronClient() ? 'electron' : 'browser',
          },
          supportedVersions: [1],
          features: ['surface-v1', 'audience-v1', 'cursor-v1', 'input-seat-v1', 'audio-output-v1'],
        }),
      )
      startHeartbeat()
      logger.info('Gateway', 'WS 已连接')
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
      stopSeatRenewal()
      inputSeat.value = null
      sessionId.value = null

      if (!isManualClose) {
        scheduleReconnect()
      }
    }

    ws.onerror = () => {
      lastError.value = '连接错误'
    }
  }

  function sendEnvelope(envelope: GatewayEnvelope): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Gateway', 'WS 未连接，无法发送消息')
      return
    }

    ws.send(JSON.stringify(envelope))
  }

  /** 断开连接 */
  function disconnect(): void {
    isManualClose = true
    clearReconnectTimer()
    stopHeartbeat()
    stopSeatRenewal()
    inputSeat.value = null
    sessionId.value = null

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
      logger.warn('Gateway', 'WS 未连接，无法发送消息')
      return
    }
    sendEnvelope(createEnvelope(type, payload))
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
      sendEnvelope({
        ...createEnvelope('request', { action, ...payload }),
        id,
      })
    })
  }

  async function subscribe(streamId: string): Promise<void> {
    if (!subscriptions.has(streamId)) subscriptions.set(streamId, 0)
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionId.value) return
    const result = await request('gateway.subscribe', {
      streamId,
      lastSequence: subscriptions.get(streamId) ?? 0,
    })
    subscriptions.set(streamId, Number(result.latestSequence ?? 0))
    if (result.snapshotRequired === true) {
      window.dispatchEvent(
        new CustomEvent('infos:gateway-snapshot-required', { detail: { streamId } }),
      )
      return
    }
    for (const event of (result.events ?? []) as SharedGatewayEnvelope[]) {
      handleMessage(JSON.stringify(event))
    }
  }

  async function restoreSubscriptions(): Promise<void> {
    await Promise.all([...subscriptions.keys()].map((streamId) => subscribe(streamId)))
  }

  async function acquireInputSeat(): Promise<void> {
    const response = await request('input_seat.acquire', {
      principalId: 'pero',
      windowId: stableNodeId,
      leaseMs: 60_000,
    })
    inputSeat.value = response.seat as unknown as KernelInputSeat
    startSeatRenewal()
  }

  function recoverInputSeat(): Promise<void> {
    if (seatRecovery) return seatRecovery
    if (!document.hasFocus()) return Promise.resolve()
    inputSeat.value = null
    seatRecovery = acquireInputSeat().finally(() => {
      seatRecovery = null
    })
    return seatRecovery
  }

  function handleWindowFocus(): void {
    if (sessionId.value) {
      void recoverInputSeat().catch((error) => {
        logger.warn('Gateway', `聚焦窗口获取 Input Seat 失败: ${(error as Error).message}`)
      })
    }
  }

  function handleWindowBlur(): void {
    stopSeatRenewal()
    inputSeat.value = null
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('blur', handleWindowBlur)
  }

  function startSeatRenewal(): void {
    stopSeatRenewal()
    seatRenewTimer = setInterval(() => {
      const seat = inputSeat.value
      if (!seat) return
      void request('input_seat.renew', { seatId: seat.seatId, leaseMs: 60_000 })
        .then((response) => {
          inputSeat.value = response.seat as unknown as KernelInputSeat
        })
        .catch((error: Error & { code?: string }) => {
          if (
            error.code === 'INPUT_SEAT_EXPIRED' ||
            error.code === 'INPUT_SEAT_IDENTITY_MISMATCH'
          ) {
            void recoverInputSeat().catch((recoveryError) => {
              logger.warn('Gateway', `Input Seat 重新获取失败: ${(recoveryError as Error).message}`)
            })
            return
          }
          logger.warn('Gateway', `Input Seat 续租失败: ${error.message}`)
        })
    }, 30_000)
  }

  function stopSeatRenewal(): void {
    if (seatRenewTimer) clearInterval(seatRenewTimer)
    seatRenewTimer = null
  }

  function seatProof(): NonNullable<import('@infos/shared').SurfaceInput['seat']> | undefined {
    const seat = inputSeat.value
    if (!seat) return undefined
    return {
      seatId: seat.seatId,
      sessionId: seat.sessionId,
      windowId: seat.windowId,
      epoch: seat.epoch,
    }
  }

  /**
   * 发送二进制音频流 sendStream()
   *
   * @param audioData - PCM/Opus 音频 ArrayBuffer
   */
  function sendStream(audioData: ArrayBuffer): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      logger.warn('Gateway', 'WS 未连接，无法发送音频流')
      return
    }
    ws.send(audioData)
  }

  // ═══ 消息分发 ═══

  /**
   * 分发后端主动推送。
   *
   * onPush 注册的是额外监听器；GatewayEvents 是常用事件的强类型快捷回调。
   * 两者都会收到同一条推送，因此页面应避免在两边重复执行有副作用的逻辑。
   */
  function dispatchPush(action: string, payload: Record<string, unknown>): void {
    for (const handler of wildcardHandlers) {
      try {
        handler(payload)
      } catch (error) {
        logger.error('Gateway', '通配符回调错误', error)
      }
    }

    const handlers = pushHandlers.get(action)
    if (!handlers) {
      return
    }

    for (const handler of handlers) {
      try {
        handler(payload)
      } catch (error) {
        logger.error('Gateway', `回调错误 (${action})`, error)
      }
    }
  }

  function handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as GatewayEnvelope & {
        payload: Record<string, unknown>
      }
      validateVersionedMessage(msg)
      if (msg.type === 'hello_ack') {
        if (msg.payload.agreedVersion !== 1) throw new Error('KERNEL_PROTOCOL_AGREEMENT_REQUIRED')
        sessionId.value = typeof msg.payload.sessionId === 'string' ? msg.payload.sessionId : null
        sessionGeneration.value = Number(msg.payload.generation ?? 0)
        if (document.hasFocus()) {
          void acquireInputSeat().catch((error) => {
            logger.error('Gateway', 'Input Seat 获取失败', error)
          })
        }
        void restoreSubscriptions().catch((error) => {
          logger.error('Gateway', 'Durable Stream 恢复失败', error)
        })
      }
      if (msg.id && msg.type === 'push') {
        if (seenMessageIds.has(msg.id)) return
        seenMessageIds.add(msg.id)
        if (seenMessageIds.size > 2_000)
          seenMessageIds.delete(seenMessageIds.values().next().value!)
      }
      if (msg.streamId && Number.isInteger(msg.sequence)) {
        subscriptions.set(
          msg.streamId,
          Math.max(subscriptions.get(msg.streamId) ?? 0, msg.sequence ?? 0),
        )
      }
      // 后端推送通常把业务动作放在 payload.action；没有 action 时退回使用 envelope.type。
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

      // ── RPC 错误 (携带 code，方便上层区分错误类型) ──
      if (msg.type === 'error' && msg.id) {
        const pending = pendingRequests.get(msg.id)
        if (pending) {
          clearTimeout(pending.timer)
          pendingRequests.delete(msg.id)
          const errMsg = (msg.payload?.message as string) ?? '未知网关错误'
          const errCode = (msg.payload?.code as string) ?? 'GATEWAY_ERROR'
          const error = new Error(errMsg) as Error & { code?: string }
          error.code = errCode
          pending.reject(error)
          return
        }
      }

      dispatchPush(action ?? msg.type, msg.payload)

      // ── 推送事件分发 ──
      switch (action ?? msg.type) {
        case 'notification':
          events.onNotification?.(msg.payload as unknown as GatewayNotification)
          break
        case 'task_progress':
          events.onTaskProgress?.(msg.payload as unknown as TaskProgress)
          break
        case 'surface': {
          const frame = msg.payload.frame as SurfaceFrame | undefined
          if (frame) {
            validateSurfaceFrame(frame)
            events.onSurface?.(frame)
          }
          break
        }
        case 'state_update':
          events.onStateUpdate?.(msg.payload)
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
          logger.debug('Gateway', `未知消息: type=${msg.type} action=${action}`)
      }
    } catch {
      // JSON 解析失败，忽略
    }
  }

  // ═══ 重连逻辑（指数退避） ═══

  function scheduleReconnect(): void {
    if (retryCount.value >= DEFAULT_RECONNECT.maxRetries) {
      logger.error('Gateway', `已达最大重连次数 (${DEFAULT_RECONNECT.maxRetries})，停止重连`)
      state.value = 'disconnected'
      return
    }

    // 指数退避 + 随机抖动
    const delay = Math.min(
      DEFAULT_RECONNECT.baseDelay * 2 ** retryCount.value + Math.random() * 500,
      DEFAULT_RECONNECT.maxDelay,
    )

    logger.info('Gateway', `${delay.toFixed(0)}ms 后重连 (第 ${retryCount.value + 1} 次)`)
    state.value = 'reconnecting'

    reconnectTimer = setTimeout(() => {
      retryCount.value++
      void connect()
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
      sendEnvelope(createEnvelope('heartbeat'))
    }, 30_000)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  // 应用级共享客户端由应用生命周期管理，不随单个组件卸载而断开。

  return {
    subscribeEvents(events: GatewayEvents): () => void {
      eventSubscribers.add(events)
      return () => eventSubscribers.delete(events)
    },
    /** 连接状态 */
    state,
    /** WS 是否已连接 */
    isConnected,
    /** 最后一次错误 */
    lastError,
    /** 重连次数 */
    retryCount,
    /** 建立连接 */
    connect,
    /** 断开连接 */
    disconnect,
    /** 注册 push 回调 */
    onPush,
    /** 移除 push 回调 */
    offPush,
    /** 手动重连 */
    reconnect: connect,
    /** 发送消息 (fire-and-forget) */
    send,
    /** RPC 请求/响应 */
    request,
    /** 订阅 Durable Stream 并从 Cursor 恢复 */
    subscribe,
    /** 当前稳定 Client Node ID */
    stableNodeId,
    sessionId,
    sessionGeneration,
    inputSeat,
    seatProof,
    /** 发送二进制音频流 */
    sendStream,
  }
}
