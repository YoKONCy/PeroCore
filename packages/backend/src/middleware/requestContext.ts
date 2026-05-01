import type { MiddlewareHandler } from 'hono'
import { createRequestId, runWithRequestContext } from '../lib/requestContext'

/** requestId 请求头；外部传入时透传，缺省时由后端生成 */
const REQUEST_ID_HEADER = 'x-request-id'
/** W3C Trace Context 请求头；当前只解析 traceId，为后续接入 tracing 留好字段 */
const TRACE_ID_HEADER = 'traceparent'

/** 从 traceparent 中解析 traceId；格式不合法时返回 undefined，避免污染日志字段 */
function parseTraceId(traceparent: string | undefined): string | undefined {
  if (!traceparent) return undefined
  const parts = traceparent.split('-')
  const traceId = parts[1]
  return traceId && /^[a-f0-9]{32}$/i.test(traceId) ? traceId : undefined
}

/**
 * 请求上下文中间件。
 *
 * 职责：
 * - 确保每个 HTTP 请求都有 requestId；
 * - 将 requestId 写回响应头，方便前端、网关和日志之间互相对齐；
 * - 用 AsyncLocalStorage 包住后续中间件和路由，使 logger 能自动读取链路字段。
 */
export const requestContextMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header(REQUEST_ID_HEADER) || createRequestId()
  const traceId = parseTraceId(c.req.header(TRACE_ID_HEADER))

  c.header(REQUEST_ID_HEADER, requestId)

  await runWithRequestContext({ requestId, traceId }, next)
}
