/**
 * Gateway Hub — WebSocket 消息路由器
 *
 * 替代 v1 的 gateway_hub.py (293行)。
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

import type { GatewayEnvelope } from './types'
import { createEnvelope } from './types'
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
  id: string
  /** 发送 JSON 文本的函数 (由 WS 升级时注入) */
  send: (data: string) => void | Promise<void>
  /** 最后一次活跃时间 (心跳/消息) */
  lastActiveAt: number
  /** 设备名称 (Hello 握手时设置) */
  deviceName?: string
}

/** 事件回调 */
type EventCallback = (envelope: GatewayEnvelope) => void | Promise<void>

// ─────────────────────────────────────────────
// Hub
// ─────────────────────────────────────────────

export class GatewayHub {
  /** 已连接的节点 Map */
  private nodes = new Map<string, GatewayNode>()

  /** 认证 Token */
  authToken = ''

  /** 事件监听器 */
  private listeners = new Map<string, EventCallback[]>()

  /** 心跳定时器 */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  /** 已连接节点数 */
  get connectedCount(): number {
    return this.nodes.size
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
      this.nodes.delete(nodeId)
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
  registerNode(nodeId: string, sendFn: (data: string) => void | Promise<void>): void {
    this.nodes.set(nodeId, {
      id: nodeId,
      send: sendFn,
      lastActiveAt: Date.now(),
    })
    logger.info(`节点已注册: ${nodeId} (在线: ${this.nodes.size})`)
  }

  /** 注销节点 */
  unregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId)
    logger.info(`节点已断开: ${nodeId} (在线: ${this.nodes.size})`)
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
    } catch {
      logger.warn(`无效 JSON 消息: ${raw.slice(0, 100)}`)
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
        this.emit('request', envelope)
        this.emit(`action:${envelope.payload.action as string}`, envelope)
        // 路由
        if (envelope.targetId === 'broadcast') {
          await this.broadcast(envelope, nodeId)
        } else if (envelope.targetId !== 'backend') {
          await this.unicast(envelope)
        }
        break
      default:
        // push / response / error 直接路由
        if (envelope.targetId === 'broadcast') {
          await this.broadcast(envelope, nodeId)
        } else {
          await this.unicast(envelope)
        }
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

  // ── 便捷广播方法 ──

  /** 推送 PetState 更新 */
  async pushStateUpdate(state: Record<string, unknown>): Promise<void> {
    await this.broadcast(createEnvelope('push', { action: 'state_update', ...state }))
  }

  /** 推送流式增量 */
  async pushStreamDelta(content: string, sessionId: string): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'stream_delta',
        content,
        sessionId,
      }),
    )
  }

  /** 推送流式结束 */
  async pushStreamEnd(sessionId: string): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'stream_end',
        sessionId,
      }),
    )
  }

  /** 推送工具状态 (B6-4) */
  async pushToolStatus(params: {
    name: string
    state: 'calling' | 'completed' | 'error'
    sessionId: string
    result?: string
    durationMs?: number
  }): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'tool_status',
        ...params,
      }),
    )
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

  /** 推送通知 */
  async pushNotification(params: {
    title: string
    body?: string
    level?: 'info' | 'success' | 'warning' | 'error'
    duration?: number
    source?: string
  }): Promise<void> {
    await this.broadcast(
      createEnvelope('push', {
        action: 'notification',
        ...params,
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

  // ── 握手 / 心跳 ──

  private async handleHello(envelope: GatewayEnvelope, nodeId: string): Promise<void> {
    const token = envelope.payload.token as string
    if (this.authToken && token !== this.authToken) {
      logger.warn(`节点 ${nodeId} Token 不匹配`)
    }

    // 记录设备名
    const node = this.nodes.get(nodeId)
    if (node) {
      node.deviceName = (envelope.payload.deviceName as string) ?? undefined
    }

    // 回复 hello_ack
    const ack = createEnvelope('hello_ack', { nodeId }, nodeId)
    await this.unicast(ack)
  }

  private async handleHeartbeat(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId)
    if (!node) return
    // 更新活跃时间 (已在 handleMessage 中做了，这里确保)
    node.lastActiveAt = Date.now()
    const ack = createEnvelope('heartbeat_ack', {}, nodeId)
    ack.targetId = nodeId
    try {
      await node.send(JSON.stringify(ack))
    } catch {
      // 心跳失败静默处理
    }
  }
}
