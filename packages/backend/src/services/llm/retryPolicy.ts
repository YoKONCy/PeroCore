import { AppError } from '../../lib/appError'

const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504])

/** 流内错误没有 HTTP 状态时，仅认领已知的临时服务商错误码。 */
export function temporaryUpstreamCode(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^(?:server_error|internal_server_error|overloaded_error|rate_limit_error|rate_limit_exceeded|temporarily_unavailable|service_unavailable)$/.test(
      value,
    )
  )
}

export function retryAfterMilliseconds(value: string | null): number | undefined {
  if (!value) return
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

/** 只接管临时网络故障，参数、鉴权、配额和主动取消不按网络抖动重试。 */
export function retryableLlmError(error: unknown): boolean {
  if (error instanceof AppError) {
    const data = error.data as { retryable?: unknown; status?: unknown } | undefined
    if (typeof data?.retryable === 'boolean') return data.retryable
    return typeof data?.status === 'number' && TEMPORARY_STATUSES.has(data.status)
  }
  if (!(error instanceof Error) || error.name === 'AbortError') return false
  const cause = error.cause as { code?: string } | undefined
  const code = cause?.code ?? (error as Error & { code?: string }).code
  return (
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_(?:SOCKET|CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT)/i.test(
      code ?? '',
    ) ||
    /fetch failed|failed to fetch|network error|socket hang up|connection (?:closed|reset)|terminated/i.test(
      error.message,
    )
  )
}

export function retryLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.max(0, Math.min(5, Math.trunc(value)))
}

export function retryDelay(error: unknown, attempt: number): number {
  const data =
    error instanceof AppError ? (error.data as { retryAfter?: unknown } | undefined) : undefined
  const requested =
    typeof data?.retryAfter === 'number' && Number.isFinite(data.retryAfter)
      ? data.retryAfter
      : undefined
  return Math.max(
    0,
    Math.min(30_000, requested ?? 1_000 * 2 ** attempt * (0.75 + Math.random() * 0.5)),
  )
}

/** 等待不持有无主定时器，停止任务会立即结束退避。 */
export async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

/** 所有尝试共用总预算；单次 Provider 心跳不能无限延长整个恢复过程。 */
export function retryScope(
  signal?: AbortSignal,
  timeoutMs = 30 * 60_000,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const stop = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', stop, { once: true })
  if (signal?.aborted) stop()
  const timer = setTimeout(
    () =>
      controller.abort(
        new AppError('LLM_TIMEOUT', {
          message: '模型请求与重试已达到总时间预算',
          data: { retryable: false },
        }),
      ),
    timeoutMs,
  )
  timer.unref?.()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
    },
  }
}
