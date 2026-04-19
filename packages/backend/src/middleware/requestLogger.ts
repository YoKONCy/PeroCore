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

  // 只有非 2xx 或耗时 > 1s 时才打 warn
  if (status >= 400 || elapsed > 1000) {
    logger.warn(`${method} ${path} → ${status} (${elapsed}ms)`)
  } else {
    logger.debug(`${method} ${path} → ${status} (${elapsed}ms)`)
  }
}
