/**
 * 请求日志中间件
 *
 * 记录方法、路径、状态码和耗时，
 * 仅在异常或慢请求时打 warn (08_LOGGING_SPEC.md)。
 *
 * @module packages/backend/src/middleware/requestLogger
 */

import type { MiddlewareHandler } from 'hono'
import { createLogger } from '../lib/logger'

const logger = createLogger('HTTP')

/** 请求日志中间件 — 记录方法、路径、状态码、耗时 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path

  await next()

  const elapsed = Date.now() - start
  const status = c.res.status

  // 语音/AI 类请求天然耗时较长，放宽阈值
  const isSlowAllowed = path.startsWith('/api/voice') || path.startsWith('/api/chat')
  const slowThreshold = isSlowAllowed ? 10_000 : 1000

  // 非 2xx 或超阈值慢请求 → warn; 成功请求 → trace (默认不显示)
  if (status >= 400 || elapsed > slowThreshold) {
    logger.warn(`${method} ${path} → ${status} (${elapsed}ms)`)
  } else {
    logger.trace(`${method} ${path} → ${status} (${elapsed}ms)`)
  }
}
