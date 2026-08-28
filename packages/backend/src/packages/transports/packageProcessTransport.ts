export interface PackageRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
  context?: { executionId?: string; processId?: string; correlationId?: string }
}

export interface PackageRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface PackageRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface PackageProcessTransport {
  call(
    method: string,
    params: unknown,
    timeoutMs?: number,
    context?: PackageRpcRequest['context'],
  ): Promise<unknown>
  onNotification(handler: (method: string, params: unknown) => void): void
  isAlive(): boolean
  dispose(): Promise<void>
}
