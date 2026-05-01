/**
 * Prometheus Metrics 路由
 *
 * 暴露 Prometheus 文本格式指标，供 Prometheus、Grafana Agent 或本地排查直接抓取。
 * 路径建议挂载在 `/metrics`，不放入 `/api`，符合常见 Prometheus scrape 约定。
 *
 * @module packages/backend/src/routers/metrics.router
 */

import { Hono } from 'hono'
import { getMetricsContentType, renderMetrics } from '../lib/metrics'

/** 创建 metrics 路由。 */
export function createMetricsRouter() {
  const router = new Hono()

  router.get('/', async (c) => {
    const body = await renderMetrics()
    return c.body(body, 200, {
      'Content-Type': getMetricsContentType(),
    })
  })

  return router
}
