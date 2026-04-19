/**
 * Hook 事件注册与触发
 *
 * 管理所有 Hook 的注册和串行触发 (09_EXTENSION_SYSTEM.md §7)。
 *
 * 执行规则：
 * - 同一事件多个 Hook 按注册顺序串行执行
 * - before* Hook 返回值替换原始数据传给下一个 Hook
 * - ctx.abort() 可中断后续 Hook
 * - 单个 Hook 异常不阻断后续，记录日志
 * - 每个 Hook 最长 5 秒超时
 *
 * @module packages/backend/src/extensions/hookRegistry
 */

import type { HookEvent, HookHandler, HookContext } from './types'
import { createLogger } from '../lib/logger'

const logger = createLogger('HookRegistry')

/** Hook 超时 (毫秒) */
const HOOK_TIMEOUT_MS = 5_000

/** 已注册的 Hook 条目 */
interface HookEntry {
  /** 来源扩展 ID */
  extensionId: string
  /** 处理函数 */
  handler: HookHandler
}

export class HookRegistry {
  /** 事件 → Hook 列表 */
  private hooks = new Map<HookEvent, HookEntry[]>()

  /** 已注册 Hook 总数 */
  get count(): number {
    let total = 0
    for (const entries of this.hooks.values()) {
      total += entries.length
    }
    return total
  }

  /**
   * 注册 Hook
   *
   * @param event - Hook 事件名
   * @param extensionId - 来源扩展 ID
   * @param handler - 处理函数
   */
  register(event: HookEvent, extensionId: string, handler: HookHandler): void {
    const entries = this.hooks.get(event) ?? []
    entries.push({ extensionId, handler })
    this.hooks.set(event, entries)
    logger.debug(`Hook 已注册: ${event} ← ${extensionId}`)
  }

  /**
   * 触发 Hook 事件
   *
   * 串行执行所有注册的 Handler，支持数据修改和中断。
   *
   * @param event - Hook 事件名
   * @param data - 要传递/可修改的数据
   * @returns 经过所有 Hook 处理后的数据
   */
  async emit<T>(event: HookEvent, data: T): Promise<T> {
    const entries = this.hooks.get(event)
    if (!entries?.length) return data

    let currentData = data
    let aborted = false
    let abortReason = ''

    // 创建 Hook 上下文
    const ctx: HookContext = {
      logger: {
        info: (msg, meta) => logger.info(`[Hook:${event}] ${msg}`, meta),
        warn: (msg, meta) => logger.warn(`[Hook:${event}] ${msg}`, meta),
        error: (msg, meta) => logger.error(`[Hook:${event}] ${msg}`, meta),
      },
      abort(reason?: string) {
        aborted = true
        abortReason = reason ?? ''
      },
    }

    for (const entry of entries) {
      if (aborted) {
        logger.debug(`Hook 链已中断 (${event}): ${abortReason}`)
        break
      }

      try {
        // 带超时执行
        const result = await Promise.race([
          entry.handler(currentData, ctx),
          this.timeout(entry.extensionId, event),
        ])

        // 如果 handler 返回了值，用它替换当前数据
        if (result !== undefined && result !== null) {
          currentData = result as T
        }
      } catch (err) {
        // 单个 Hook 异常不阻断后续
        logger.warn(`Hook 执行异常 (${event} ← ${entry.extensionId})`, {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return currentData
  }

  /**
   * 移除指定扩展的所有 Hook
   */
  removeByExtension(extensionId: string): void {
    for (const [event, entries] of this.hooks) {
      const filtered = entries.filter((e) => e.extensionId !== extensionId)
      if (filtered.length === 0) {
        this.hooks.delete(event)
      } else {
        this.hooks.set(event, filtered)
      }
    }
    logger.debug(`已移除扩展 ${extensionId} 的所有 Hook`)
  }

  /**
   * 清除所有 Hook
   */
  clear(): void {
    this.hooks.clear()
  }

  /**
   * 列出某事件的所有 Hook 来源
   */
  listHooks(event: HookEvent): string[] {
    return (this.hooks.get(event) ?? []).map((e) => e.extensionId)
  }

  // ── 内部方法 ──

  /** 超时 Promise */
  private timeout(extensionId: string, event: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Hook 超时 (${HOOK_TIMEOUT_MS}ms): ${event} ← ${extensionId}`))
      }, HOOK_TIMEOUT_MS)
    })
  }
}
