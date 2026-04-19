/**
 * Gateway Router — Hono WebSocket 端点
 *
 * 将 Hono 的 WebSocket 升级与 GatewayHub 对接。
 * 使用 hono/ws 的 createWebSocket 方式处理。
 *
 * @module packages/backend/src/routers/gateway.router
 */

import { Hono } from 'hono'
import type { GatewayHub } from '../services/gateway/gatewayHub'
import { createLogger } from '../lib/logger'

const logger = createLogger('GatewayRouter')

/**
 * 创建 Gateway WS Router
 *
 * 注意：Hono 原生不支持 WS，需通过 adapter (Bun/Node) 处理。
 * 这里提供 HTTP 升级 fallback：
 * - GET /ws/gateway 返回 WS 升级信息
 * - 实际 WS 由 app 层的 upgrade 处理
 */
export function createGatewayRouter(hub: GatewayHub) {
  const router = new Hono()

  // WS 健康检查 / 状态端点
  router.get('/status', (c) => {
    return c.json({
      code: 'OK',
      message: '获取成功',
      data: {
        connectedNodes: hub.connectedCount,
        uptime: process.uptime(),
      },
    })
  })

  return router
}

/**
 * WebSocket 升级处理器
 *
 * 供 Node.js / Bun 的 WS 适配层调用。
 * 例如在 Bun 中：
 * ```ts
 * Bun.serve({
 *   fetch: app.fetch,
 *   websocket: {
 *     open(ws) { handleWsOpen(hub, ws) },
 *     message(ws, msg) { handleWsMessage(hub, ws, msg) },
 *     close(ws) { handleWsClose(hub, ws) },
 *   }
 * })
 * ```
 */

/** WS 连接打开时 */
export function handleWsOpen(
  hub: GatewayHub,
  ws: { send: (data: string) => void },
  nodeId: string,
): void {
  hub.registerNode(nodeId, (data) => ws.send(data))
  logger.info(`WS 连接建立: ${nodeId}`)
}

/** WS 收到消息时 */
export async function handleWsMessage(
  hub: GatewayHub,
  nodeId: string,
  data: string | ArrayBuffer,
): Promise<void> {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
  await hub.handleMessage(text, nodeId)
}

/** WS 连接关闭时 */
export function handleWsClose(hub: GatewayHub, nodeId: string): void {
  hub.unregisterNode(nodeId)
  logger.info(`WS 连接断开: ${nodeId}`)
}
