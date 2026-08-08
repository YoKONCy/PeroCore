/**
 * CapabilityBridge — Daemon 侧能力调用 WebSocket 服务端
 *
 * 第七阶段核心组件：在 :9121 端口监听 WS 连接，实现：
 * 1. 节点注册：Electron/Mobile 等节点连接后发送 register 消息注册能力
 * 2. 心跳维护：节点定期发送 heartbeat，超时标记离线
 * 3. 工具调用转发：ToolExecutor 调用平台工具时，通过此 Bridge 转发到提供者节点
 * 4. 结果回传：节点执行完工具后，通过 WS 返回结果
 *
 * 消息协议（JSON）：
 * - 节点 → Daemon:
 *   { type: 'register', nodeId, nodeType, capabilities: string[], url? }
 *   { type: 'heartbeat', nodeId }
 *   { type: 'tool_result', callId, result, success, errorMsg? }
 * - Daemon → 节点:
 *   { type: 'tool_call', callId, toolName, args }
 *   { type: 'registered', success, message? }
 *
 * @module packages/backend/src/capabilities/capabilityBridge
 */

import { WebSocketServer, WebSocket } from 'ws'
import type { CapabilityRegistry } from './capabilityRegistry'
import type { NodeCapabilityRegistration } from '../repositories/nodeCapability.repo'
import { createLogger } from '../lib/logger'

const logger = createLogger('CapabilityBridge')

/**
 * 工具调用超时（ms）
 *
 * 节点收到 tool_call 后应在此时间内返回 tool_result。
 * 超时后 Bridge 返回错误给调用方（ToolExecutor）。
 */
const TOOL_CALL_TIMEOUT_MS = 30_000

/**
 * 心跳清理间隔（ms）
 *
 * 每 30 秒清理一次超时节点。
 */
const HEARTBEAT_CLEANUP_INTERVAL_MS = 30_000

/** 节点 → Daemon 消息类型 */
type NodeMessage =
  | { type: 'register'; nodeId: string; nodeType: string; capabilities: string[]; url?: string }
  | { type: 'heartbeat'; nodeId: string }
  | {
      type: 'tool_result'
      callId: string
      result: unknown
      success: boolean
      errorMsg?: string
    }
  // 第七阶段修复（批次 E3）：鉴权握手消息
  | { type: 'auth'; token: string }

/** Daemon → 节点消息类型 */
type DaemonMessage =
  | { type: 'tool_call'; callId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'registered'; success: boolean; message?: string }
  // 第七阶段修复（批次 E3）：错误消息（含鉴权失败）
  | { type: 'error'; message: string }

/** 待处理的工具调用（等待节点返回结果） */
interface PendingCall {
  resolve: (result: ToolCallResult) => void
  timer: NodeJS.Timeout
  /** 第七阶段修复（批次 E4）：记录调用发起时间，用于计算真实 durationMs */
  startTime: number
}

/** 工具调用结果 */
export interface ToolCallResult {
  /** 工具输出（字符串化后的结果） */
  output: string
  /** 是否出错 */
  isError: boolean
  /** 耗时 ms */
  durationMs: number
}

/**
 * CapabilityBridge — 能力调用 WebSocket 服务端
 *
 * 单例，由 Daemon 启动时创建。ToolExecutor 通过此实例转发平台工具调用。
 *
 * 注意：构造函数只依赖 CapabilityRegistry（避免与 AppContext 循环依赖）。
 * WS 服务端的启动由 Daemon 包调用 start() 触发。
 */
export class CapabilityBridge {
  private wss: WebSocketServer | null = null
  /** nodeId → WebSocket 连接映射 */
  private nodeConnections = new Map<string, WebSocket>()
  /** callId → 待处理调用 */
  private pendingCalls = new Map<string, PendingCall>()
  /** 心跳清理定时器 */
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(
    private capabilityRegistry: CapabilityRegistry,
    /**
     * 第七阶段修复（批次 E3）：WS 鉴权 token
     * 来自 process.env.PEROCORE_API_TOKEN，未设置时为空字符串（跳过鉴权）
     */
    private authToken: string = '',
  ) {}

  /**
   * 启动 WS 服务端
   *
   * @param port 能力通道端口（默认 9121）
   */
  async start(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port })

      this.wss.on('connection', (ws, req) => {
        const clientAddr = req.socket.remoteAddress ?? 'unknown'
        logger.info(`能力节点连接: ${clientAddr}`)

        // 第七阶段修复（批次 E3）：WS 鉴权握手
        // 连接建立后第一条消息必须是 { type: 'auth', token }
        // 验证通过后标记 _authed=true，后续才允许 register/heartbeat/tool_result
        // 未配置 PEROCORE_API_TOKEN 时（开发环境）跳过鉴权，打印 warn
        ;(ws as unknown as { _authed: boolean })._authed = !this.authToken
        if (!this.authToken) {
          logger.warn(
            'CapabilityBridge 未配置鉴权 token（PEROCORE_API_TOKEN 未设置），' +
              '任何本机进程均可注册能力。生产环境必须设置此环境变量。',
          )
        }

        ws.on('message', (data) => this.handleMessage(ws, data.toString()))
        ws.on('close', () => this.handleDisconnect(ws))
        ws.on('error', (err) => logger.warn(`节点连接错误: ${err.message}`))
      })

      // 启动心跳清理定时器
      this.cleanupTimer = setInterval(() => {
        this.capabilityRegistry.cleanupStaleNodes().catch((err) => {
          logger.warn(`心跳清理失败: ${err}`)
        })
      }, HEARTBEAT_CLEANUP_INTERVAL_MS)

      logger.info(`CapabilityBridge WS 服务端已启动 → ws://127.0.0.1:${port}`)
      resolve()
    })
  }

  /** 关闭 Bridge */
  async stop(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    // 拒绝所有待处理调用
    for (const [callId, pending] of this.pendingCalls) {
      clearTimeout(pending.timer)
      pending.resolve({
        output: 'CapabilityBridge 已关闭，工具调用被中断',
        isError: true,
        durationMs: 0,
      })
      this.pendingCalls.delete(callId)
    }
    // 关闭所有连接
    for (const ws of this.nodeConnections.values()) {
      ws.close()
    }
    this.nodeConnections.clear()
    // 关闭 WS 服务端
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }
    logger.info('CapabilityBridge 已停止')
  }

  /**
   * 调用平台工具（由 ToolExecutor 调用）
   *
   * 查找能提供 toolName 的在线节点，通过 WS 转发调用请求，
   * 等待节点返回 tool_result。
   *
   * @returns 工具调用结果（成功或错误）
   */
  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const startTime = Date.now()

    // 1. 查找能力提供者
    const provider = await this.capabilityRegistry.findProvider(toolName)
    if (!provider) {
      return {
        output: `工具 "${toolName}" 当前没有可用的能力节点。请检查相关客户端（如 Electron 桌面端）是否已启动。`,
        isError: true,
        durationMs: Date.now() - startTime,
      }
    }

    // 2. 找到节点的 WS 连接
    const ws = this.nodeConnections.get(provider.nodeId)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // 连接断开，标记节点离线
      await this.capabilityRegistry.unregister(provider.nodeId)
      return {
        output: `工具 "${toolName}" 的提供节点 ${provider.nodeId} 已断开连接`,
        isError: true,
        durationMs: Date.now() - startTime,
      }
    }

    // 3. 发送 tool_call 消息，等待 tool_result
    const callId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const message: DaemonMessage = {
      type: 'tool_call',
      callId,
      toolName,
      args,
    }

    return new Promise<ToolCallResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId)
        resolve({
          output: `工具 "${toolName}" 调用超时（节点 ${provider.nodeId} 未在 ${TOOL_CALL_TIMEOUT_MS}ms 内响应）`,
          isError: true,
          durationMs: Date.now() - startTime,
        })
      }, TOOL_CALL_TIMEOUT_MS)

      this.pendingCalls.set(callId, { resolve, timer, startTime })

      ws.send(JSON.stringify(message), (err) => {
        if (err) {
          clearTimeout(timer)
          this.pendingCalls.delete(callId)
          resolve({
            output: `工具 "${toolName}" 调用发送失败: ${err.message}`,
            isError: true,
            durationMs: Date.now() - startTime,
          })
        }
      })

      // 当 tool_result 返回时，handleMessage 会调用 pending.resolve 并清除 timer
      // 注意：ws.send 的回调仅处理发送错误，正常发送后 resolve 由 handleMessage 触发
    })
  }

  // ── 内部：消息处理 ──

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let msg: NodeMessage
    try {
      msg = JSON.parse(raw) as NodeMessage
    } catch {
      logger.warn(`收到非法 JSON 消息: ${raw.slice(0, 200)}`)
      return
    }

    // 第七阶段修复（批次 E3）：auth 握手
    if (msg.type === 'auth') {
      const authed = (ws as unknown as { _authed: boolean })._authed
      if (authed) {
        // 已认证过，忽略重复 auth
        return
      }
      if (this.authToken && msg.token === this.authToken) {
        ;(ws as unknown as { _authed: boolean })._authed = true
        logger.info('能力节点鉴权成功')
        ws.send(JSON.stringify({ type: 'registered', success: true, message: 'authed' }))
      } else {
        logger.warn('能力节点鉴权失败：token 不匹配')
        ws.send(
          JSON.stringify({
            type: 'error',
            message: '鉴权失败：token 不匹配',
          }),
        )
        ws.close()
      }
      return
    }

    // 未认证时拒绝所有其他消息
    const authed = (ws as unknown as { _authed: boolean })._authed
    if (!authed) {
      logger.warn(`未鉴权的节点发送了 ${msg.type} 消息，已忽略`)
      ws.send(JSON.stringify({ type: 'error', message: '未鉴权，请先发送 auth 消息' }))
      return
    }

    switch (msg.type) {
      case 'register':
        await this.handleRegister(ws, msg)
        break
      case 'heartbeat':
        await this.handleHeartbeat(msg)
        break
      case 'tool_result':
        this.handleToolResult(msg)
        break
      default:
        logger.warn(`未知消息类型: ${(msg as { type: string }).type}`)
    }
  }

  private async handleRegister(
    ws: WebSocket,
    msg: Extract<NodeMessage, { type: 'register' }>,
  ): Promise<void> {
    try {
      const reg: NodeCapabilityRegistration = await this.capabilityRegistry.register(
        msg.nodeId,
        msg.nodeType as NodeCapabilityRegistration['nodeType'],
        msg.capabilities,
        msg.url ?? null,
      )
      // 绑定 nodeId → WebSocket
      this.nodeConnections.set(msg.nodeId, ws)
      // 在 ws 上标记 nodeId（用于断开时清理）
      ;(ws as unknown as { _nodeId: string })._nodeId = msg.nodeId

      logger.info(`节点注册成功: ${msg.nodeId} (${msg.nodeType}), 能力: [${msg.capabilities.join(', ')}]`)

      // 回复注册成功
      const reply: DaemonMessage = {
        type: 'registered',
        success: true,
        message: `已注册 ${reg.capabilities.length} 个能力`,
      }
      ws.send(JSON.stringify(reply))
    } catch (err) {
      logger.error(`节点注册失败: ${err}`)
      const reply: DaemonMessage = {
        type: 'registered',
        success: false,
        message: String(err),
      }
      ws.send(JSON.stringify(reply))
    }
  }

  private async handleHeartbeat(
    msg: Extract<NodeMessage, { type: 'heartbeat' }>,
  ): Promise<void> {
    await this.capabilityRegistry.heartbeat(msg.nodeId)
  }

  private handleToolResult(msg: Extract<NodeMessage, { type: 'tool_result' }>): void {
    const pending = this.pendingCalls.get(msg.callId)
    if (!pending) {
      logger.warn(`收到未匹配的 tool_result: callId=${msg.callId}`)
      return
    }
    clearTimeout(pending.timer)
    this.pendingCalls.delete(msg.callId)

    // 序列化结果
    let output: string
    try {
      output =
        typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result)
    } catch {
      output = String(msg.result)
    }

    pending.resolve({
      output,
      isError: !msg.success,
      // 第七阶段修复（批次 E4）：用 pending.startTime 计算真实耗时，而非返回 0
      durationMs: Date.now() - pending.startTime,
    })
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const nodeId = (ws as unknown as { _nodeId?: string })._nodeId
    if (!nodeId) return

    this.nodeConnections.delete(nodeId)
    await this.capabilityRegistry.unregister(nodeId)
    logger.info(`节点断开连接: ${nodeId}`)
  }
}
