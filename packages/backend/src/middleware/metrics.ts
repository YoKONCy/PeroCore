/**
 * HTTP Metrics 中间件
 *
 * 记录每个 HTTP 请求的计数与耗时，并按 method、route、status 聚合。
 * route 会做规范化处理，避免 `/api/items/1`、`/api/items/2` 这类动态路径撑爆 Prometheus 标签基数。
 *
 * @module packages/backend/src/middleware/metrics
 */

import type { MiddlewareHandler } from 'hono'
import { httpRequestDurationSeconds, httpRequestsTotal } from '../lib/metrics'

/** UUID / 数字 ID 等动态片段统一替换为 :id，控制 route 标签基数。 */
const DYNAMIC_SEGMENT_RE = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,})$/i

/** 规范化请求路径，用作 Prometheus route 标签。 */
export function normalizeMetricsRoute(path: string): string {
  if (path === '/') return '/'

  return path
    .split('/')
    .map((segment) => {
      if (!segment) return segment
      return DYNAMIC_SEGMENT_RE.test(segment) ? ':id' : segment
    })
    .join('/')
}

/** HTTP 指标中间件 — 必须包住后续路由，以便在 finally 中记录异常和正常响应。 */
export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const start = performance.now()
  const method = c.req.method
  const route = normalizeMetricsRoute(c.req.path)

  try {
    await next()
  } finally {
    const status = String(c.res.status || 500)
    const durationSeconds = (performance.now() - start) / 1000

    httpRequestsTotal.inc({ method, route, status })
    httpRequestDurationSeconds.observe({ method, route, status }, durationSeconds)
  }
}
