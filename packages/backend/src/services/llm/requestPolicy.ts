import { AppError } from '../../lib/appError'
import type { ChatOptions } from './types'
import { geminiReasoningEffort } from './geminiThinking'

/** 正文额度和思考预留分开计算；等级模型的预留是估算，不限制实际思考长度。 */
export function reasoningAllowance(opts: ChatOptions, thinkingByDefault = false): number {
  if (opts.reasoningEffort === 'off') return 0
  const budgets = { low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768 }
  return opts.reasoningEffort ? budgets[opts.reasoningEffort] : thinkingByDefault ? 16384 : 0
}

export function combinedOutputLimit(
  opts: ChatOptions,
  thinkingByDefault = false,
): number | undefined {
  return typeof opts.maxTokens === 'number'
    ? opts.maxTokens + reasoningAllowance(opts, thinkingByDefault)
    : undefined
}

/** 上下文预留需和 Provider 的正文＋思考口径一致。 */
export function modelOutputReservation(
  model?: {
    maxTokens?: number
    reasoningEffort?: ChatOptions['reasoningEffort']
    provider: string
    modelId: string
    wireApi?: string
  } | null,
): number {
  if (!model?.maxTokens) return 0
  const automatic =
    model.wireApi === 'responses' ||
    /^(?:o\d|gpt-[56])(?:[.-]|$)|reasoner|thinking|gemini-(?:2\.5|[3-9])/i.test(model.modelId)
  return (
    model.maxTokens +
    reasoningAllowance(
      { ...model, reasoningEffort: geminiReasoningEffort(model.modelId, model.reasoningEffort) },
      automatic && model.provider !== 'anthropic',
    )
  )
}

/** 超时覆盖响应体读取，并随上游数据重置；不能把持续思考当作超时。 */
export async function fetchLlmResponse(
  url: string,
  init: RequestInit,
  opts: ChatOptions,
  provider: string,
): Promise<Response> {
  const controller = new AbortController()
  const idleMs = opts.timeout ?? 10 * 60_000
  let idleTimer: ReturnType<typeof setTimeout>
  const timeoutError = () =>
    new AppError('LLM_TIMEOUT', {
      message: `模型连续 ${Math.round(idleMs / 60_000)} 分钟未返回数据，请稍后重试`,
      data: { provider, retryable: true },
    })
  const touch = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(timeoutError()), idleMs)
    idleTimer.unref?.()
  }
  // 持续心跳也不能让一个模型请求永久占用执行槽。
  const totalTimer = setTimeout(
    () =>
      controller.abort(
        new AppError('LLM_TIMEOUT', {
          message: `本次模型请求已持续 ${Math.round(Math.max(idleMs, opts.totalTimeout ?? 30 * 60_000) / 60_000)} 分钟，暂时停止，请稍后重试`,
          data: { provider, retryable: false },
        }),
      ),
    Math.max(idleMs, opts.totalTimeout ?? 30 * 60_000),
  )
  totalTimer.unref?.()
  const cancel = () => controller.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', cancel, { once: true })
  if (opts.signal?.aborted) cancel()
  const cleanup = () => {
    clearTimeout(idleTimer)
    clearTimeout(totalTimer)
    opts.signal?.removeEventListener('abort', cancel)
  }
  touch()
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    touch()
    if (!response.body) {
      cleanup()
      return response
    }
    const reader = response.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(sink) {
        try {
          const result = await reader.read()
          if (result.done) {
            cleanup()
            reader.releaseLock()
            sink.close()
          } else {
            touch()
            sink.enqueue(result.value)
          }
        } catch (error) {
          cleanup()
          reader.releaseLock()
          sink.error(controller.signal.aborted ? controller.signal.reason : error)
        }
      },
      async cancel(reason) {
        cleanup()
        controller.abort(reason)
        await reader.cancel(reason).catch(() => {})
      },
    })
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    cleanup()
    throw controller.signal.aborted ? controller.signal.reason : error
  }
}
