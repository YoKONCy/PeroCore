/**
 * Transport 抽象接口
 *
 * 定义 Service 扩展与核心之间的通信协议。
 * Layer 2: StdioTransport (JSON-RPC over stdio)
 * Layer 3: HttpTransport (预留)
 *
 * @module packages/backend/src/extensions/transports/transport
 */

/** JSON-RPC 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/** JSON-RPC 通知 (无 id) */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/**
 * Service Transport 抽象
 *
 * 通信层接口，支持正向调用 (Core → Service) 和反向通知 (Service → Core)。
 */
export interface ServiceTransport {
  /** 正向: 调用远程方法 (带超时) */
  call(method: string, params: unknown, timeoutMs?: number): Promise<unknown>

  /** 注册反向通知处理器 */
  onNotification(handler: (method: string, params: unknown) => void): void

  /** 传输层是否就绪 */
  isAlive(): boolean

  /** 关闭连接 */
  dispose(): Promise<void>
}
