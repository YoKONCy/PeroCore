import { AsyncLocalStorage } from 'node:async_hooks'
import type { SocialStoragePort, SocialTurnRecord } from '@infos/shared'

export const SOCIAL_TURN_DURATION_MS = 6 * 60 * 60_000

/** 每个固定消息批次共用恢复预算和取消信号，工具与发送共享同一执行现场。 */
export interface SocialRecovery {
  record: SocialTurnRecord
  signal: AbortSignal
  save(): Promise<void>
}

const current = new AsyncLocalStorage<SocialRecovery>()
export const currentSocialRecovery = () => current.getStore()
export function assertSocialActive(): void {
  current.getStore()?.signal.throwIfAborted()
}
export function runSocialRecovery<T>(recovery: SocialRecovery, run: () => Promise<T>): Promise<T> {
  return current.run(recovery, run)
}

export function socialFailure(error: unknown): {
  retryable: boolean
  cancelled: boolean
  message: string
} {
  const value = error as {
    code?: string
    message?: string
    data?: { retryable?: boolean; status?: number }
    name?: string
  }
  const message = value?.message || String(error)
  const cancelled =
    value?.name === 'AbortError' ||
    /SOCIAL_EXECUTION_(?:CANCELLED|TIMED_OUT)|社交任务已取消|社交任务已超时/.test(message)
  const retryable =
    !cancelled &&
    value?.data?.retryable !== false &&
    (value?.data?.retryable === true ||
      [408, 429, 500, 502, 503, 504].includes(value?.data?.status ?? 0) ||
      ['LLM_TIMEOUT', 'LLM_RATE_LIMITED', 'NETWORK_ERROR'].includes(value?.code ?? '') ||
      /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|网络连接/.test(message))
  return { retryable, cancelled, message }
}

export async function finishSocialTurn(
  storage: SocialStoragePort,
  record: SocialTurnRecord,
  status: SocialTurnRecord['status'],
  error?: string,
): Promise<void> {
  record.status = status
  record.error = error?.slice(0, 500)
  record.updatedAt = new Date().toISOString()
  // 终态不保存聊天内容、工具正文和图片，只留下防重复标识。
  record.checkpoint =
    status === 'waiting'
      ? {
          inbound: record.checkpoint.inbound,
          policy: record.checkpoint.policy,
          outcome: record.checkpoint.outcome,
        }
      : {}
  await storage.saveTurn(record)
}

export async function socialDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new Error('社交任务已取消'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}
