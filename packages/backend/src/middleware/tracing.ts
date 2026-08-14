import type { MiddlewareHandler } from 'hono'
import { SpanKind, SpanStatusCode, context, trace } from '@opentelemetry/api'
import { extractTraceContext, getTracer } from '../lib/telemetry'
import { getRequestContext } from '../lib/requestContext'

/**
 * HTTP 根 Span 中间件。
 *
 * 采用 W3C Trace Context 与上游链路衔接，并将响应 traceId 回写到响应头，
 * 方便前端日志、HTTP 请求和 LLM 子 Span 通过同一 traceId 关联。
 */
export const tracingMiddleware: MiddlewareHandler = async (c, next) => {
  const parentContext = extractTraceContext(c.req.raw.headers)
  const route = new URL(c.req.url).pathname
  const span = getTracer().startSpan(
    `${c.req.method} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': c.req.method,
        'url.path': route,
        'url.scheme': new URL(c.req.url).protocol.replace(':', ''),
        'user_agent.original': c.req.header('user-agent') ?? '',
      },
    },
    parentContext,
  )

  await context.with(trace.setSpan(parentContext, span), async () => {
    try {
      await next()
      span.setAttribute('http.response.status_code', c.res.status)
      span.setStatus({ code: c.res.status >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.OK })
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)))
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      throw error
    } finally {
      const spanContext = span.spanContext()
      c.header('x-trace-id', spanContext.traceId)
      const request = getRequestContext()
      if (request) request.traceId = spanContext.traceId
      span.end()
    }
  })
}
