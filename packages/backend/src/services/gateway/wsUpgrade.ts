/**
 * WebSocket 升级处理器 (Gateway + 社交适配器)
 *
 * 在 Node.js HTTP Server 上监听 upgrade 事件，
 * 分路由处理两种 WebSocket 端点:
 * 1. /ws/gateway     — 前端 Dashboard 实时通信 (GatewayHub)
 * 2. /api/social/ws  — NapCat 反向 WebSocket 连接 (OneBot v11)
 *
 * 符合 A02 §7: Gateway 与 HTTP 共用 :9120 端口
 *
 * @platform ELECTRON | DOCKER
 * @module packages/backend/src/services/gateway/wsUpgrade
 */

import type { Server, IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { GatewayHub } from './gatewayHub'
import { getSocialNapcatAdapter, createWsSender } from '../../applications/socialWsBridge'
import { createLogger } from '../../lib/logger'
import { createArcaBrowserSocket } from '../../applications/arcaBrowserSocket'
import type { AppContext } from '../../container'

const logger = createLogger('WebSocketUpgrade')

/** WS 升级路径 */
const WS_GATEWAY_PATH = '/ws/gateway'
const WS_SOCIAL_PATH = '/api/social/ws'

/** 节点 ID 计数器 */
let nodeCounter = 0

/**
 * 在已有 HTTP Server 上挂载 WebSocket 升级
 *
 * @param server - @hono/node-server 的 serve() 返回的 HTTP Server
 * @param hub - GatewayHub 实例 (DI 注入)
 * @param _ctx - 已废弃（社交适配器现在通过 socialWsBridge 全局注册表获取）
 */
export function setupGatewayWebSocket(
  server: Server,
  hub: GatewayHub,
  ctx?: Pick<AppContext, 'arcaApplication'>,
): void {
  const gatewayWss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 })
  const socialWss = new WebSocketServer({ noServer: true })
  const arca = createArcaBrowserSocket(() => ctx?.arcaApplication.status())
  server.once('close', () => arca.close())

  // 监听 HTTP upgrade 事件 → 按路径分派到对应 WSS
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

    if (url.pathname === '/api/applications/arca/transport') {
      arca.upgrade(request, socket, head)
      return
    }

    if (url.pathname === WS_GATEWAY_PATH) {
      // 原生客户端使用 Bearer，浏览器使用查询凭据；升级和 hello 共用同一鉴权策略。
      const authorization = request.headers.authorization
      const token = authorization
        ? authorization.replace(/^Bearer\s+/i, '')
        : (url.searchParams.get('token') ?? '')
      if (!hub.acceptsToken(token)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        return
      }
      gatewayWss.handleUpgrade(request, socket, head, (ws) => {
        gatewayWss.emit('connection', ws, request)
      })
      return
    }

    if (url.pathname === WS_SOCIAL_PATH) {
      socialWss.handleUpgrade(request, socket, head, (ws) => {
        socialWss.emit('connection', ws, request)
      })
      return
    }

    // 未知路径，销毁连接
    socket.destroy()
  })

  // ── Gateway WS 连接 ──
  gatewayWss.on('connection', (ws: WebSocket) => {
    const nodeId = `node-${++nodeCounter}-${Date.now()}`
    logger.info(`Gateway WS 连接建立: ${nodeId}`)

    hub.registerNode(
      nodeId,
      (data: string) => ws.send(data),
      () => ws.close(1001, '会话已过期，请重新连接'),
      !!hub.authToken,
    )
    const handshakeDeadline = setTimeout(() => {
      if (!hub.isAuthenticated(nodeId)) ws.close(1008, '握手超时')
    }, 10_000)
    handshakeDeadline.unref()

    ws.on('message', (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8')
      hub.handleMessage(text, nodeId).catch((err) => {
        logger.warn(`Gateway 消息处理失败: ${err}`)
      })
    })

    ws.on('close', () => {
      clearTimeout(handshakeDeadline)
      hub.unregisterNode(nodeId)
      logger.info(`Gateway WS 连接断开: ${nodeId}`)
    })

    ws.on('error', (err) => {
      logger.warn(`Gateway WS 错误 (${nodeId}): ${err.message}`)
    })
  })

  // ── 社交适配器 WS 连接 (NapCat OneBot v11 反向 WS) ──
  // 通过 socialWsBridge 全局注册表获取 SocialAppRuntime 注入的 NapcatAdapter
  socialWss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const adapter = getSocialNapcatAdapter()
    if (!adapter) {
      logger.warn('收到社交 WS 连接但无 NapCat 适配器注册（社交应用未启动），关闭连接')
      ws.close(1013, '社交服务尚未就绪，请稍后重连')
      return
    }

    // 从 NapCat 的 X-Self-ID header 获取 Bot QQ 号
    const selfId = request.headers['x-self-id'] as string | undefined
    logger.info(`NapCat 反向 WS 连接建立: selfId=${selfId ?? '未知'}`)

    // 注册连接到适配器
    const sender = createWsSender({
      send: (data: string) => ws.send(data),
      close: () => ws.close(),
    })
    adapter.registerConnection(selfId, sender)

    // 转发消息到适配器处理
    ws.on('message', (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf-8')
      adapter.handleRawEvent(text).catch((err) => {
        logger.warn(`NapCat 事件处理失败: ${err}`)
      })
    })

    ws.on('close', () => {
      adapter.unregisterConnection(selfId, sender)
      logger.info(`NapCat 反向 WS 连接断开: selfId=${selfId ?? '未知'}`)
    })

    ws.on('error', (err) => {
      logger.warn(`NapCat WS 错误: ${err.message}`)
    })
  })

  logger.info(`社交 WS 端点已挂载: ${WS_SOCIAL_PATH}`)
  logger.info(`Gateway WS 端点已挂载: ${WS_GATEWAY_PATH}`)
}
