/**
 * Stdio Transport — JSON-RPC over stdio
 *
 * Layer 2 通信实现。
 * 通过子进程的 stdin/stdout 交换 JSON-RPC 消息。
 *
 * 协议：每行一个 JSON 对象，\n 分隔。
 *
 * @module packages/backend/src/extensions/transports/stdioTransport
 */

import type { Writable, Readable } from 'node:stream'
import { createInterface } from 'node:readline'
import type {
  ServiceTransport,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from './transport'
import { createLogger } from '../../lib/logger'

const logger = createLogger('StdioTransport')

/** 默认调用超时 (毫秒) */
const DEFAULT_TIMEOUT_MS = 30_000

export class StdioTransport implements ServiceTransport {
  private nextId = 1
  private pendingCalls = new Map<
    number | string,
    {
      resolve: (value: unknown) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private notificationHandler?: (method: string, params: unknown) => void
  private alive = true

  constructor(
    private stdin: Writable,
    stdout: Readable,
  ) {
    // 逐行读取 stdout
    const rl = createInterface({ input: stdout })
    rl.on('line', (line) => this.onLine(line))
    rl.on('close', () => {
      this.alive = false
      // 拒绝所有待解决的调用
      for (const [id, pending] of this.pendingCalls) {
        pending.reject(new Error('Transport 已关闭'))
        clearTimeout(pending.timer)
        this.pendingCalls.delete(id)
      }
    })
  }

  /**
   * 正向调用 Service 方法
   */
  async call(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    if (!this.alive) throw new Error('Transport 已关闭')

    const id = this.nextId++
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise<unknown>((resolve, reject) => {
      const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`JSON-RPC 调用超时 (${timeout}ms): ${method}`))
      }, timeout)

      this.pendingCalls.set(id, { resolve, reject, timer })

      // 写入 stdin
      const line = JSON.stringify(request) + '\n'
      this.stdin.write(line, (err) => {
        if (err) {
          this.pendingCalls.delete(id)
          clearTimeout(timer)
          reject(new Error(`写入 stdin 失败: ${err.message}`))
        }
      })
    })
  }

  /**
   * 注册反向通知处理器 (Service → Core)
   */
  onNotification(handler: (method: string, params: unknown) => void): void {
    this.notificationHandler = handler
  }

  /**
   * 传输层是否存活
   */
  isAlive(): boolean {
    return this.alive
  }

  /**
   * 关闭连接
   */
  async dispose(): Promise<void> {
    this.alive = false
    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Transport 正在关闭'))
    }
    this.pendingCalls.clear()
  }

  // ── 内部方法 ──

  /** 处理 stdout 的每一行 */
  private onLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    let msg: JsonRpcResponse | JsonRpcNotification
    try {
      msg = JSON.parse(trimmed)
    } catch {
      logger.debug(`忽略非 JSON 行: ${trimmed.slice(0, 100)}`)
      return
    }

    // 区分响应 vs 通知
    if ('id' in msg && msg.id !== undefined && msg.id !== null) {
      // 这是对正向调用的响应
      this.handleResponse(msg as JsonRpcResponse)
    } else if ('method' in msg) {
      // 这是反向通知 (Service → Core)
      this.handleNotification(msg as JsonRpcNotification)
    }
  }

  /** 处理 JSON-RPC 响应 */
  private handleResponse(resp: JsonRpcResponse): void {
    const pending = this.pendingCalls.get(resp.id!)
    if (!pending) {
      logger.warn(`收到未知 ID 的响应: ${resp.id}`)
      return
    }

    this.pendingCalls.delete(resp.id!)
    clearTimeout(pending.timer)

    if (resp.error) {
      pending.reject(new Error(`JSON-RPC 错误: ${resp.error.message} (${resp.error.code})`))
    } else {
      pending.resolve(resp.result)
    }
  }

  /** 处理反向通知 */
  private handleNotification(notif: JsonRpcNotification): void {
    if (this.notificationHandler) {
      try {
        this.notificationHandler(notif.method, notif.params)
      } catch (err) {
        logger.warn(`通知处理失败: ${notif.method}`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    } else {
      logger.debug(`未注册通知处理器，忽略: ${notif.method}`)
    }
  }
}
