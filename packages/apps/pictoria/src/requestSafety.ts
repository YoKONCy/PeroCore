export class ServiceRequestError extends Error {
  constructor(
    message: string,
    readonly detail: {
      retryable?: boolean
      notSent?: boolean
      definitiveRejection?: boolean
      ambiguousSubmission?: boolean
      status?: number
      retryAfterMs?: number
    } = {},
  ) {
    super(message)
    Object.assign(this, detail)
  }
}
export function requestError(error: unknown) {
  return error as Error &
    ServiceRequestError['detail'] & { persistenceFailure?: boolean; receiptResponse?: unknown }
}
export function transient(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (requestError(error).retryable || (error instanceof Error && error.name === 'TimeoutError')),
  )
}
export function connectionNotSent(error: unknown) {
  const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : undefined
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(code))
}
export function retryAfter(value: string | null) {
  if (!value) return 0
  const milliseconds = /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now()
  return Number.isFinite(milliseconds) ? Math.min(300000, Math.max(0, milliseconds)) : 0
}
export function backoff(attempt: number, minimum = 1000, maximum = 60000) {
  return Math.min(maximum, minimum * 2 ** Math.min(attempt, 10)) * (0.8 + Math.random() * 0.4)
}
export function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export function persistenceError(error: unknown, receiptResponse?: unknown) {
  const failure = error instanceof Error ? error : new Error('请求记录保存失败')
  return Object.assign(failure, {
    persistenceFailure: true,
    ...(receiptResponse !== undefined ? { receiptResponse } : {}),
  })
}
