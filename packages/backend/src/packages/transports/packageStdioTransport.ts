import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import { createLogger } from '../../lib/logger'
import type {
  PackageProcessTransport,
  PackageRpcNotification,
  PackageRpcRequest,
  PackageRpcResponse,
} from './packageProcessTransport'

const logger = createLogger('PackageStdioTransport')
const DEFAULT_TIMEOUT_MS = 30_000

/** Package Service Process 的逐行 JSON-RPC Transport。 */
export class PackageStdioTransport implements PackageProcessTransport {
  private nextId = 1
  private readonly pendingCalls = new Map<
    number | string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private notificationHandler?: (method: string, params: unknown) => void
  private alive = true

  constructor(
    private readonly stdin: Writable,
    stdout: Readable,
  ) {
    const lines = createInterface({ input: stdout })
    lines.on('line', (line) => this.onLine(line))
    lines.on('close', () => this.rejectPending('Package Process Transport 已关闭'))
  }

  async call(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    context?: PackageRpcRequest['context'],
  ): Promise<unknown> {
    if (!this.alive) throw new Error('Package Process Transport 已关闭')
    const id = this.nextId++
    const request: PackageRpcRequest = { jsonrpc: '2.0', id, method, params, context }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`Package RPC 调用超时 (${timeoutMs}ms): ${method}`))
      }, timeoutMs)
      this.pendingCalls.set(id, { resolve, reject, timer })
      this.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return
        this.pendingCalls.delete(id)
        clearTimeout(timer)
        reject(new Error(`写入 Package Process 失败: ${error.message}`))
      })
    })
  }

  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler
  }

  isAlive(): boolean {
    return this.alive
  }

  async dispose(): Promise<void> {
    this.rejectPending('Package Process Transport 正在关闭')
  }

  private onLine(line: string): void {
    const text = line.trim()
    if (!text) return
    let message: PackageRpcResponse | PackageRpcNotification
    try {
      message = JSON.parse(text) as PackageRpcResponse | PackageRpcNotification
    } catch {
      logger.debug(`忽略 Package Process 非 JSON 输出: ${text.slice(0, 100)}`)
      return
    }
    if ('id' in message && message.id !== null) {
      const pending = this.pendingCalls.get(message.id)
      if (!pending) return
      this.pendingCalls.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new Error(`Package RPC 错误: ${message.error.message} (${message.error.code})`),
        )
      } else {
        pending.resolve(message.result)
      }
    } else if ('method' in message) {
      this.notificationHandler?.(message.method, message.params)
    }
  }

  private rejectPending(message: string): void {
    this.alive = false
    for (const pending of this.pendingCalls.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }
    this.pendingCalls.clear()
  }
}
