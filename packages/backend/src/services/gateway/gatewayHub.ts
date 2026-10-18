/**
 * Gateway Hub — WebSocket 消息路由器
 *
 * 核心变化：
 * 1. Protobuf → JSON (后续可扩展 Protobuf 通道)
 * 2. FastAPI WebSocket → Hono WSContext
 * 3. 全局单例 → DI 注入
 *
 * B6-4 升级:
 * - 心跳循环 (30s 间隔, 自动检测死连接)
 * - Stale 连接清理 (90s 无心跳回复 → 自动注销)
 * - 任务进度推送
 * - 工具状态推送
 *
 * 功能：
 * - 客户端连接管理 (注册/注销)
 * - Hello 握手 + Token 认证
 * - 心跳响应
 * - 单播 / 广播路由
 * - 内部事件系统 (供后端 Service 注册回调)
 *
 * @module packages/backend/src/services/gateway/gatewayHub
 */

import { timingSafeEqual } from 'node:crypto'
import {
  GATEWAY_ACTION_CATALOG,
  negotiateKernelProtocol,
  validateVersionedMessage,
} from '@infos/shared'
import type {
  CataloguedGatewayAction,
  DeliveryAudience,
  KernelInputSeat,
  KernelNodeDescriptor,
  KernelNodeId,
  KernelNodeSessionId,
} from '@infos/shared'
import type { NodeRegistry } from '../../kernel/nodeRegistry'
import type { DurableNotificationRepository } from '../../repositories/durableNotification.repo'
import type { GatewayEnvelope } from './types'
import { createEnvelope } from './types'
import { DurableGatewayStream } from './durableGatewayStream'
import { createLogger } from '../../lib/logger'

const logger = createLogger('GatewayHub')

// ─────────────────────────────────────────────
// 常量
// ─────────────────────────────────────────────

/** 心跳检测间隔 (ms) */
const HEARTBEAT_INTERVAL_MS = 30_000
/** 连接超时阈值 (ms) — 超过此时间无心跳回复则视为 stale */
const STALE_TIMEOUT_MS = 90_000

// ─────────────────────────────────────────────
// Node (客户端连接)
// ─────────────────────────────────────────────

/** 已连接的客户端节点 */
interface GatewayNode {
  /** Transport 连接标识，握手后不可作为业务 Node Identity。 */
  id: string
  stableNodeId?: KernelNodeId
  sessionId?: KernelNodeSessionId
  generation?: number
  principalId?: string
  subscriptions: Set<string>
  authenticated: boolean
  /** HTTP 升级已经验证的凭据，可供浏览器无令牌的 hello 复用。 */
  transportAuthenticated?: boolean
  /** 发送 JSON 文本的函数 (由 WS 升级时注入) */
  send: (data: string) => void | Promise<void>
  close?: () => void
  /** 最后一次活跃时间 (心跳/消息) */
  lastActiveAt: number
  /** 设备名称 (Hello 握手时设置) */
  deviceName?: string
  petPresence?: { agentId: string; visible: boolean; updatedAt: number }
  notificationPrincipals?: Set<string>
}

/** 事件回调 */
type EventCallback = (envelope: GatewayEnvelope) => void | Promise<void>
export interface NotificationIdentity {
  notificationId: string
  revision: number
}
type NotificationSuppression = (
  principalId: string,
  notifications: NotificationIdentity[],
) => Promise<string[]>

// ─────────────────────────────────────────────
// Hub
// ─────────────────────────────────────────────

export class GatewayHub {
  /** 已连接的节点 Map */
  private nodes = new Map<string, GatewayNode>()

  /** 认证 Token */
  authToken: string

  /** 事件监听器 */
  private listeners = new Map<string, EventCallback[]>()

  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly durableStreams = new DurableGatewayStream()
  private readonly notificationSuppressions = new Set<NotificationSuppression>()

  addNotificationSuppression(filter: NotificationSuppression): () => void {
    this.notificationSuppressions.add(filter)
    return () => {
      this.notificationSuppressions.delete(filter)
    }
  }

  private async visibleNotifications<T extends NotificationIdentity>(
    principalId: string,
    items: T[],
  ): Promise<T[]> {
    if (!items.length || !this.notificationSuppressions.size) return items
    const hidden = new Set<string>()
    for (const filter of this.notificationSuppressions) {
      try {
        for (const id of await filter(principalId, items)) hidden.add(id)
      } catch (error) {
        logger.warn('通知移除状态暂时无法读取，保留原通知', { error: String(error) })
      }
    }
    const suppressed = items.filter((item) => hidden.has(item.notificationId))
    if (suppressed.length) {
      try {
        this.notifications?.acknowledge(
          principalId,
          suppressed.map(({ notificationId, revision }) => ({ notificationId, revision })),
        )
      } catch (error) {
        logger.warn('已移除通知的回执暂未保存，下次恢复时继续过滤', { error: String(error) })
      }
    }
    return items.filter((item) => !hidden.has(item.notificationId))
  }

  constructor(
    private readonly nodeRegistry?: NodeRegistry,
    private readonly notifications?: DurableNotificationRepository,
    authToken = '',
  ) {
    this.authToken = authToken
  }

  acceptsToken(token: string): boolean {
    if (!this.authToken) return true
    const expected = Buffer.from(this.authToken)
    const supplied = Buffer.from(token)
    return expected.length === supplied.length && timingSafeEqual(expected, supplied)
  }

  isAuthenticated(nodeId: string): boolean {
    return this.nodes.get(nodeId)?.authenticated === true
  }

  /** 已连接节点数 */
  get connectedCount(): number {
    return this.nodes.size
  }

  /** 桌宠显示状态只属于当前连接，过期或断线后自动失效，不作为持久化偏好。 */
  hasVisiblePet(agentId: string): boolean {
    const now = Date.now()
    return [...this.nodes.values()].some(
      (node) =>
        node.authenticated &&
        node.principalId === agentId &&
        node.petPresence?.agentId === agentId &&
        node.petPresence.visible &&
        now - node.petPresence.updatedAt < STALE_TIMEOUT_MS,
    )
  }

  // ── 生命周期 ──

  /** 启动心跳循环 (B6-4) */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return

    this.heartbeatTimer = setInterval(() => {
      this.cleanStaleConnections()
    }, HEARTBEAT_INTERVAL_MS)

    logger.info(`心跳循环已启动 (${HEARTBEAT_INTERVAL_MS / 1000}s 间隔)`)
  }

  /** 停止心跳循环 */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      logger.info('心跳循环已停止')
    }
  }

  /** 清理 stale 连接 (B6-4) */
  private cleanStaleConnections(): void {
    const now = Date.now()
    const staleIds: string[] = []

    for (const [nodeId, node] of this.nodes) {
      if (now - node.lastActiveAt > STALE_TIMEOUT_MS) {
        staleIds.push(nodeId)
      }
    }

    for (const nodeId of staleIds) {
      logger.warn(`清理 stale 连接: ${nodeId} (超过 ${STALE_TIMEOUT_MS / 1000}s 无响应)`)
      const node = this.nodes.get(nodeId)
      this.disconnectNodeSession(node)
      this.nodes.delete(nodeId)
      // 真正关闭 Transport，客户端才能感知失效并重新握手，不能留下假在线连接。
      try {
        node?.close?.()
      } catch (error) {
        logger.warn('关闭失效连接失败', { error })
      }
    }

    if (staleIds.length > 0) {
      logger.info(`已清理 ${staleIds.length} 个 stale 连接，剩余 ${this.nodes.size} 个`)
    }
  }

  // ── 事件系统 ──

  /** 注册事件回调 */
  on(event: string, callback: EventCallback): void {
    const list = this.listeners.get(event) ?? []
    list.push(callback)
    this.listeners.set(event, list)
  }

  /** 移除事件回调 */
  off(event: string, callback: EventCallback): void {
    const list = this.listeners.get(event)
    if (!list) return
    this.listeners.set(
      event,
      list.filter((cb) => cb !== callback),
    )
  }

  /** 触发事件 */
  private emit(event: string, envelope: GatewayEnvelope): void {
    const callbacks = this.listeners.get(event)
    if (!callbacks) return
    for (const cb of callbacks) {
      try {
        const result = cb(envelope)
        // 如果是 Promise 就 fire-and-forget
        if (result instanceof Promise) {
          result.catch((err) => logger.warn(`事件 ${event} 回调错误`, { error: err }))
        }
      } catch (err) {
        logger.warn(`事件 ${event} 回调错误`, { error: err })
      }
    }
  }

  // ── 连接管理 ──

  /** 注册节点 */
  registerNode(
    nodeId: string,
    sendFn: (data: string) => void | Promise<void>,
    closeFn?: () => void,
    transportAuthenticated = false,
  ): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      send: sendFn,
      close: closeFn,
      lastActiveAt: Date.now(),
      subscriptions: new Set(),
      authenticated: !this.nodeRegistry && !this.authToken,
      transportAuthenticated,
    })
    logger.info(`节点已注册: ${nodeId} (在线: ${this.nodes.size})`)
  }

  /** 注销节点 */
  unregisterNode(nodeId: string): void {
    this.disconnectNodeSession(this.nodes.get(nodeId))
    this.nodes.delete(nodeId)
    logger.info(`节点已断开: ${nodeId} (在线: ${this.nodes.size})`)
  }

  private disconnectNodeSession(node?: GatewayNode): void {
    if (node?.sessionId) this.nodeRegistry?.disconnect(node.sessionId)
  }

  /**
   * 处理收到的 WS 消息
   *
   * 统一入口：解析 JSON → 分发到对应处理逻辑
   */
  async handleMessage(raw: string, nodeId: string): Promise<void> {
    // 更新活跃时间
    const node = this.nodes.get(nodeId)
    if (node) {
      node.lastActiveAt = Date.now()
    }

    let envelope: GatewayEnvelope
    try {
      envelope = JSON.parse(raw) as GatewayEnvelope
      validateVersionedMessage(envelope)
      if (
        !envelope.id ||
        !envelope.type ||
        !envelope.sourceId ||
        !envelope.targetId ||
        !Number.isFinite(envelope.timestamp) ||
        !envelope.payload ||
        typeof envelope.payload !== 'object'
      ) {
        throw new Error('GATEWAY_ENVELOPE_INVALID')
      }
    } catch (error) {
      logger.warn(`无效Gateway消息: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    if (!node) return
    // 未完成握手的连接不能借 abort、push 或直接路由绕过请求鉴权。
    if (!node.authenticated && !['hello', 'heartbeat', 'ping'].includes(envelope.type)) {
      await this.sendTransportError(envelope.id, nodeId, 'GATEWAY_HELLO_REQUIRED')
      return
    }
    switch (envelope.type) {
      case 'hello':
        await this.handleHello(envelope, nodeId)
        break
      case 'heartbeat':
        await this.handleHeartbeat(nodeId)
        break
      case 'request':
        if (!node?.authenticated) {
          await this.sendTransportError(envelope.id, nodeId, 'GATEWAY_HELLO_REQUIRED')
          break
        }
        envelope.sourceId = node.stableNodeId ?? nodeId
        if (envelope.payload.action === 'gateway.pet_presence') {
          const agentId = String(envelope.payload.agentId ?? '').trim()
          if (
            !agentId ||
            agentId !== node.principalId ||
            typeof envelope.payload.visible !== 'boolean'
          ) {
            await this.sendTransportError(envelope.id, nodeId, 'GATEWAY_PET_PRESENCE_INVALID')
          } else {
            node.petPresence = { agentId, visible: envelope.payload.visible, updatedAt: Date.now() }
            await this.sendRpcValue(envelope.id, node.id, { visible: node.petPresence.visible })
          }
          break
        }
        if (envelope.payload.action === 'gateway.select_principal') {
          const principalId = String(envelope.payload.principalId ?? '').trim()
          if (!principalId || principalId.length > 200) {
            await this.sendTransportError(envelope.id, nodeId, 'GATEWAY_PRINCIPAL_INVALID')
          } else {
            const changed = node.principalId !== principalId
            if (changed) node.petPresence = undefined
            node.principalId = principalId
            await this.sendRpcValue(envelope.id, node.id, { principalId })
            if (changed) await this.replayNotifications(node, principalId)
          }
          break
        }
        if (envelope.payload.action === 'gateway.notifications.ack') {
          const principalId = String(envelope.payload.principalId ?? '')
          const receipts = envelope.payload.receipts
          if (
            !node.notificationPrincipals?.has(principalId) ||
            !Array.isArray(receipts) ||
            receipts.length > 200 ||
            receipts.some(
              (receipt) =>
                !receipt ||
                typeof receipt.notificationId !== 'string' ||
                !receipt.notificationId ||
                receipt.notificationId.length > 300 ||
                !Number.isSafeInteger(receipt.revision) ||
                receipt.revision < 1,
            )
          ) {
            await this.sendTransportError(envelope.id, node.id, 'GATEWAY_NOTIFICATION_ACK_INVALID')
          } else {
            const acknowledged = this.notifications?.acknowledge(principalId, receipts) ?? 0
            await this.sendRpcValue(envelope.id, node.id, { acknowledged })
          }
          break
        }
        if (envelope.payload.action === 'gateway.subscribe') {
          await this.handleSubscribe(envelope, node)
          break
        }
        if (envelope.payload.action === 'input_seat.acquire') {
          await this.handleInputSeatAcquire(envelope, node)
          break
        }
        if (envelope.payload.action === 'input_seat.renew') {
          await this.handleInputSeatRenew(envelope, node)
          break
        }
        if (envelope.payload.action === 'input_seat.release') {
          await this.handleInputSeatRelease(envelope, node)
          break
        }
        this.emit('request', envelope)
        this.emit(`action:${envelope.payload.action as string}`, envelope)
        // 路由: 无 targetId 或 targetId=backend → 仅触发事件 (由后端 Service 处理)
        if (envelope.targetId === 'broadcast') {
          await this.broadcast(envelope, nodeId)
        } else if (envelope.targetId && envelope.targetId !== 'backend') {
          await this.unicast(envelope)
        }
        // else: targetId 为空/backend → 事件已触发, 由后端 Service 自行响应
        break
      case 'abort':
        // 前端中断思考 (fire-and-forget)
        this.emit('abort', envelope)
        break
      case 'ping':
        // 前端心跳探测 → 等同 heartbeat
        await this.handleHeartbeat(nodeId)
        break
      default:
        // push / response / error 直接路由
        if (envelope.targetId === 'broadcast') {
          await this.broadcast(envelope, nodeId)
        } else if (envelope.targetId) {
          await this.unicast(envelope)
        }
      // else: 无目标的推送消息，静默忽略
    }
  }

  // ── 路由 ──

  /** 广播 (排除发送者) */
  async broadcast(envelope: GatewayEnvelope, excludeNodeId?: string): Promise<void> {
    const data = JSON.stringify(envelope)
    for (const [nodeId, node] of this.nodes) {
      if (nodeId === excludeNodeId) continue
      try {
        await node.send(data)
      } catch (err) {
        logger.warn(`发送至 ${nodeId} 失败`, { error: err })
      }
    }
  }

  /** 按 Audience 投递业务消息。 */
  async deliver(envelope: GatewayEnvelope): Promise<void> {
    const data = JSON.stringify(envelope)
    for (const node of this.nodes.values()) {
      if (!node.authenticated || !this.matchesAudience(node, envelope.audience)) continue
      try {
        await node.send(data)
      } catch (err) {
        logger.warn(`发送至 ${node.stableNodeId ?? node.id} 失败`, { error: err })
      }
    }
  }

  private matchesAudience(node: GatewayNode, audience?: DeliveryAudience): boolean {
    if (!audience) return false
    if (!this.nodeRegistry) return true
    if (audience.type === 'specific_node') return node.stableNodeId === audience.nodeId
    if (audience.type === 'active_input_seat') {
      const seat = this.nodeRegistry?.getInputSeat(audience.principalId)
      return Boolean(seat && seat.nodeId === node.stableNodeId && seat.sessionId === node.sessionId)
    }
    if (audience.type === 'all_principal_clients') return node.principalId === audience.principalId
    const streamId =
      audience.type === 'thread_subscribers'
        ? `thread:${audience.threadId}`
        : `execution:${audience.executionId}`
    return node.subscriptions.has(streamId)
  }

  /** 单播 */
  async unicast(envelope: GatewayEnvelope): Promise<void> {
    const node = this.nodes.get(envelope.targetId)
    if (!node) {
      logger.debug(`目标节点未找到: ${envelope.targetId}`)
      return
    }
    try {
      await node.send(JSON.stringify(envelope))
    } catch (err) {
      logger.warn(`发送至 ${envelope.targetId} 失败`, { error: err })
    }
  }

  async pushBusiness(
    action: CataloguedGatewayAction,
    payload: Record<string, unknown>,
    audience: DeliveryAudience,
    streamId?: string,
  ): Promise<GatewayEnvelope> {
    const policy = GATEWAY_ACTION_CATALOG[action]
    let envelope = createEnvelope(
      'push',
      { action, ...payload },
      audience.type === 'specific_node' ? audience.nodeId : 'audience',
      { audience, durability: policy.durability, streamId },
    )
    if (policy.durability === 'durable') {
      if (!streamId) throw new Error(`GATEWAY_DURABLE_STREAM_REQUIRED: ${action}`)
      envelope = this.durableStreams.append(streamId, envelope)
    }
    await this.deliver(envelope)
    return envelope
  }

  // ── 便捷广播方法 ──

  /** 推送 PetState 更新 */
  async pushStateUpdate(state: Record<string, unknown>): Promise<void> {
    await this.broadcast(createEnvelope('push', { action: 'state_update', ...state }))
  }

  /** 推送统一 Internal Surface 帧。 */
  async pushSurface(frame: import('@infos/shared').SurfaceFrame): Promise<void> {
    await this.broadcast(createEnvelope('push', { action: 'surface', frame }))
  }

  /** 推送任务进度 (B6-4) */
  async pushTaskProgress(params: {
    sessionId: string
    turn: number
    state: 'running' | 'paused' | 'completed' | 'cancelled' | 'error'
    message?: string
  }): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'task_progress',
        ...params,
      }),
    )
  }

  /** 推送通知；默认只投递当前 Input Seat，重要通知使用 Durable Stream。 */
  async pushNotification(params: {
    title: string
    body?: string
    level?: 'info' | 'success' | 'warning' | 'error'
    duration?: number
    source?: string
    principalId?: string
    important?: boolean
    notificationId?: string
    createdAt?: string
  }): Promise<void> {
    const principalId = params.principalId ?? 'pero'
    const notificationId = params.notificationId ?? crypto.randomUUID()
    const createdAt =
      params.createdAt && Number.isFinite(Date.parse(params.createdAt))
        ? new Date(params.createdAt).toISOString()
        : new Date().toISOString()
    if (!this.nodeRegistry) {
      await this.broadcast(
        createEnvelope('push', { action: 'notification', ...params, notificationId }),
      )
      return
    }
    if (params.important) {
      const created = this.notifications?.create({
        notificationId,
        principalId,
        audience: { type: 'all_principal_clients', principalId },
        title: params.title,
        body: params.body,
        level: params.level ?? 'info',
        status: 'unread',
        revision: 1,
        createdAt,
      })
      if (created === false) return
      if (!(await this.visibleNotifications(principalId, [{ notificationId, revision: 1 }])).length)
        return
      await this.pushBusiness(
        'durable_notification',
        { ...params, principalId, notificationId, important: true, revision: 1, createdAt },
        { type: 'all_principal_clients', principalId },
        `notification:${principalId}`,
      )
      return
    }
    await this.pushBusiness(
      'notification',
      { ...params, notificationId, important: false },
      { type: 'active_input_seat', principalId },
    )
  }

  /** 旧 Gateway 音频广播已退役；音频必须通过 Audio Asset 与 audio.output Capability 定向播放。 */
  async pushAudioChunk(_audioData: ArrayBuffer, _sessionId: string): Promise<void> {
    throw new Error('AUDIO_CHUNK_RETIRED: 请使用 AudioDeliveryService 定向播放')
  }

  /** 推送语音管道状态变更 */
  async pushVoiceState(sessionId: string, state: string): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'voice_state',
        sessionId,
        state,
      }),
    )
  }

  /** 推送系统错误 */
  async pushError(message: string, title = '错误'): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'system_error',
        message,
        title,
      }),
    )
  }

  /**
   * RPC 响应回送 — 对应前端 request() 的 response
   *
   * @param requestId - 原始请求的 id (用于前端 pendingRequests 配对)
   * @param targetNodeId - 目标节点 ID
   * @param payload - 响应负载
   */
  async sendResponse(
    requestId: string,
    targetNodeId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope = createEnvelope('response', payload, targetNodeId)
    envelope.id = requestId // 保持 id 与 request 一致
    await this.unicast(envelope)
  }

  /**
   * RPC 错误回送
   *
   * @param requestId - 原始请求的 id
   * @param targetNodeId - 目标节点 ID
   * @param message - 错误消息
   */
  async sendError(requestId: string, targetNodeId: string, message: string): Promise<void> {
    const envelope = createEnvelope('error', { message }, targetNodeId)
    envelope.id = requestId
    await this.unicast(envelope)
  }

  // ── 握手 / 心跳 ──

  private async handleHello(envelope: GatewayEnvelope, connectionId: string): Promise<void> {
    const node = this.nodes.get(connectionId)
    if (!node) return
    const token = String(envelope.payload.token ?? '')
    if (
      this.authToken &&
      ((!token && !node.transportAuthenticated) || (token && !this.acceptsToken(token)))
    ) {
      logger.warn(`连接 ${connectionId} Token 不匹配`)
      await this.sendTransportError(envelope.id, connectionId, 'GATEWAY_UNAUTHORIZED')
      node.authenticated = false
      node.close?.()
      this.unregisterNode(connectionId)
      return
    }

    const stableNodeId = String(envelope.payload.nodeId ?? '').trim() as KernelNodeId
    const principalId = String(envelope.payload.principalId ?? 'pero').trim()
    if (this.nodeRegistry) {
      if (!stableNodeId) {
        await this.sendTransportError(envelope.id, connectionId, 'GATEWAY_NODE_ID_REQUIRED')
        return
      }
      const descriptor = this.toClientDescriptor(stableNodeId, envelope.payload)
      const existing = this.nodeRegistry.getNode(stableNodeId)
      // Electron 的界面与能力连接共享 Node ID；界面握手只建立 Session，不能覆盖能力 Host 的身份。
      // 不合并或提升 Gateway 声明的权限，保留已注册能力客户端的 Facet、信任和平台信息。
      if (
        !existing ||
        !existing.facets.includes('client') ||
        !existing.facets.includes('capability')
      ) {
        this.nodeRegistry.registerNode(descriptor)
      }
      const session = this.nodeRegistry.connect({
        nodeId: stableNodeId,
        connectionId,
        carrier: 'websocket',
        leaseMs: STALE_TIMEOUT_MS,
      })
      node.stableNodeId = stableNodeId
      node.sessionId = session.sessionId
      node.generation = session.generation
      node.principalId = principalId
    } else {
      node.stableNodeId = stableNodeId || (connectionId as KernelNodeId)
      node.principalId = principalId
    }
    node.authenticated = true
    node.deviceName = String(envelope.payload.deviceName ?? '') || undefined

    const supportedVersions = Array.isArray(envelope.payload.supportedVersions)
      ? envelope.payload.supportedVersions.map(Number)
      : [envelope.protocolVersion]
    const agreedVersion = negotiateKernelProtocol(supportedVersions)
    const ack = createEnvelope(
      'hello_ack',
      {
        nodeId: node.stableNodeId,
        sessionId: node.sessionId,
        generation: node.generation,
        agreedVersion,
        features: ['surface-v1', 'audience-v1', 'cursor-v1', 'input-seat-v1'],
      },
      connectionId,
    )
    await node.send(JSON.stringify(ack))
    await this.replayNotifications(node, principalId)
  }

  private async replayNotifications(node: GatewayNode, principalId: string): Promise<void> {
    node.notificationPrincipals ??= new Set()
    node.notificationPrincipals.add(principalId)
    // WebSocket 游标只覆盖当前进程；重连后从数据库补送未读的重要通知。
    for (const notification of await this.visibleNotifications(
      principalId,
      this.notifications?.list(principalId, 'unread') ?? [],
    )) {
      await node.send(
        JSON.stringify(
          createEnvelope('push', {
            action: 'durable_notification',
            notificationId: notification.notificationId,
            principalId,
            title: notification.title,
            body: notification.body,
            level: notification.level,
            important: true,
            revision: notification.revision,
            createdAt: notification.createdAt,
            replayed: true,
          }),
        ),
      )
    }
  }

  private toClientDescriptor(
    nodeId: KernelNodeId,
    payload: Record<string, unknown>,
  ): KernelNodeDescriptor {
    const platform = (payload.platform ?? {}) as Record<string, unknown>
    const os = String(platform.os ?? 'web')
    const runtime = String(platform.runtime ?? 'browser')
    return {
      nodeId,
      displayName: String(payload.deviceName ?? 'Client Node'),
      facets: ['client', 'device'],
      trust: this.authToken ? 'paired' : 'local',
      platform: {
        os: ['windows', 'linux', 'macos', 'android', 'ios', 'web'].includes(os)
          ? (os as KernelNodeDescriptor['platform']['os'])
          : 'unknown',
        runtime: ['node', 'bun', 'electron', 'tauri', 'browser', 'native'].includes(runtime)
          ? (runtime as KernelNodeDescriptor['platform']['runtime'])
          : 'unknown',
        arch: typeof platform.arch === 'string' ? platform.arch : undefined,
      },
      protocolVersion: 1,
      registeredAt: new Date().toISOString(),
    }
  }

  private async handleSubscribe(envelope: GatewayEnvelope, node: GatewayNode): Promise<void> {
    const streamId = String(envelope.payload.streamId ?? '').trim()
    const lastSequence = Number(envelope.payload.lastSequence ?? 0)
    if (!streamId || !Number.isInteger(lastSequence) || lastSequence < 0) {
      await this.sendTransportError(envelope.id, node.id, 'GATEWAY_SUBSCRIPTION_INVALID')
      return
    }
    node.subscriptions.add(streamId)
    const recovery = this.durableStreams.read(streamId, lastSequence)
    if (this.notifications && streamId.startsWith('notification:')) {
      const ids = recovery.events
        .filter((event) => event.payload.action === 'durable_notification')
        .map((event) => String(event.payload.notificationId ?? ''))
      const unread = this.notifications.unreadIds(streamId.slice('notification:'.length), ids)
      recovery.events = recovery.events.filter(
        (event) =>
          event.payload.action !== 'durable_notification' ||
          unread.has(String(event.payload.notificationId ?? '')),
      )
      const visible = await this.visibleNotifications(
        streamId.slice('notification:'.length),
        recovery.events
          .filter((event) => event.payload.action === 'durable_notification')
          .map((event) => ({
            notificationId: String(event.payload.notificationId ?? ''),
            revision: Number(event.payload.revision ?? 1),
          })),
      )
      const visibleIds = new Set(visible.map((item) => item.notificationId))
      recovery.events = recovery.events.filter(
        (event) =>
          event.payload.action !== 'durable_notification' ||
          visibleIds.has(String(event.payload.notificationId ?? '')),
      )
    }
    // 补游标只恢复状态，不能把历史通知伪装成刚发生的新事件。
    recovery.events = recovery.events.map((event) => ({
      ...event,
      payload: { ...event.payload, replayed: true },
    }))
    const response = createEnvelope('response', { streamId, ...recovery }, node.id)
    response.id = envelope.id
    await node.send(JSON.stringify(response))
  }

  private async handleInputSeatAcquire(
    envelope: GatewayEnvelope,
    node: GatewayNode,
  ): Promise<void> {
    if (!node.sessionId || !this.nodeRegistry) return
    try {
      const principalId = String(envelope.payload.principalId ?? node.principalId ?? 'pero')
      const seat = this.nodeRegistry.issueInputSeat({
        sessionId: node.sessionId,
        principalId,
        windowId: String(envelope.payload.windowId ?? 'main'),
        leaseMs: Number(envelope.payload.leaseMs ?? 60_000),
        capabilities: ['surface', 'approval', 'input', 'audio-output'],
      })
      await this.sendRpcValue(envelope.id, node.id, { seat })
    } catch (error) {
      await this.sendTransportError(envelope.id, node.id, (error as Error).message)
    }
  }

  private async handleInputSeatRenew(envelope: GatewayEnvelope, node: GatewayNode): Promise<void> {
    if (!this.nodeRegistry) return
    try {
      const seat = this.nodeRegistry.renewInputSeat(
        String(envelope.payload.seatId) as KernelInputSeat['seatId'],
        Number(envelope.payload.leaseMs ?? 60_000),
      )
      if (seat.sessionId !== node.sessionId) throw new Error('INPUT_SEAT_IDENTITY_MISMATCH')
      await this.sendRpcValue(envelope.id, node.id, { seat })
    } catch (error) {
      await this.sendTransportError(envelope.id, node.id, (error as Error).message)
    }
  }

  private async handleInputSeatRelease(
    envelope: GatewayEnvelope,
    node: GatewayNode,
  ): Promise<void> {
    if (!this.nodeRegistry) return
    const seatId = String(envelope.payload.seatId) as KernelInputSeat['seatId']
    const seat = this.nodeRegistry.listInputSeats().find((value) => value.seatId === seatId)
    if (!seat || seat.sessionId !== node.sessionId) {
      await this.sendTransportError(envelope.id, node.id, 'INPUT_SEAT_IDENTITY_MISMATCH')
      return
    }
    await this.sendRpcValue(envelope.id, node.id, {
      released: this.nodeRegistry.revokeInputSeat(seatId),
    })
  }

  private async sendRpcValue(
    requestId: string,
    targetId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const response = createEnvelope('response', payload, targetId)
    response.id = requestId
    const node = this.nodes.get(targetId)
    if (node) await node.send(JSON.stringify(response))
  }

  private async sendTransportError(
    requestId: string,
    targetId: string,
    code: string,
  ): Promise<void> {
    const error = createEnvelope('error', { code, message: code }, targetId)
    error.id = requestId
    const node = this.nodes.get(targetId)
    if (node) await node.send(JSON.stringify(error))
  }

  private async handleHeartbeat(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return
    node.lastActiveAt = Date.now()
    if (node.sessionId) this.nodeRegistry?.heartbeat(node.sessionId, STALE_TIMEOUT_MS)
    const ack = createEnvelope('heartbeat_ack', {}, nodeId)
    ack.targetId = nodeId
    try {
      await node.send(JSON.stringify(ack))
    } catch {
      // 心跳失败静默处理
    }
  }
}
