import { AppError } from './appError'
import type { ResponseCode } from '@infos/shared'

/** 上游网页响应不能直接打印进日志，也不能当作模型 JSON 或可重试服务错误。 */
export function upstreamWebPage(response: Response, body = ''): 'challenge' | 'html' | undefined {
  if (response.headers?.get('cf-mitigated')?.toLowerCase() === 'challenge') return 'challenge'
  const prefix = body.slice(0, 16_384)
  const html =
    /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers?.get('content-type') ?? '') ||
    /^\s*(?:<!doctype\s+html|<html\b)/i.test(prefix)
  if (!html) return
  return /<title>\s*Just a moment|cf-chl-|challenge-platform/i.test(prefix) ? 'challenge' : 'html'
}

export function upstreamHttpError(
  response: Response,
  body: string,
  service: string,
  code: ResponseCode,
): AppError {
  const kind = upstreamWebPage(response, body)
  let detail = body
  if (!kind) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: unknown }; message?: unknown }
      const message = parsed?.error?.message ?? parsed?.message
      if (typeof message === 'string') detail = message
    } catch {
      /* 普通文本错误只保留有限摘要。 */
    }
    detail = detail.replace(/\s+/g, ' ').slice(0, 280)
  }
  const message =
    kind === 'challenge'
      ? `${service} 被 Cloudflare 人机验证拦截，请联系服务商放行 API 路径或使用专用 API 地址`
      : kind === 'html'
        ? `${service} 返回了网页而非 API JSON，请检查 API 基址和反向代理配置`
        : `${service} 请求失败 (${response.status})${detail ? `：${detail}` : ''}`
  return new AppError(code, {
    message,
    data: {
      status: response.status,
      kind: kind ?? 'http',
      ...(kind ? { retryable: false } : {}),
      ...(kind === 'challenge' ? { rayId: response.headers?.get('cf-ray')?.slice(0, 100) } : {}),
    },
  })
}
