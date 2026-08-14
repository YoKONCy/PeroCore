/**
 * Prometheus Metrics 注册中心
 *
 * 统一管理后端进程内的 Prometheus 指标。
 * 当前先覆盖 HTTP 请求维度与 Node.js 默认运行时指标，后续 LLM、工具、记忆检索等业务指标
 * 也应在这里注册，避免各模块各自创建 Registry 导致 /metrics 输出不完整。
 *
 * @module packages/backend/src/lib/metrics
 */

import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client'

/** 全局唯一 Registry；测试和应用都从这里读取指标文本。 */
export const metricsRegistry = new Registry()

/** 指标名前缀，避免与宿主环境或未来 sidecar 指标重名。 */
const METRIC_PREFIX = 'infos_'

collectDefaultMetrics({
  register: metricsRegistry,
  prefix: METRIC_PREFIX,
})

/** HTTP 请求总数；按方法、规范化路由和状态码聚合。 */
export const httpRequestsTotal = new Counter({
  name: `${METRIC_PREFIX}http_requests_total`,
  help: 'Total number of HTTP requests handled by infOS backend.',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [metricsRegistry],
})

/** HTTP 请求耗时；单位为秒，桶覆盖普通 API、LLM/语音慢接口和异常慢请求。 */
export const httpRequestDurationSeconds = new Histogram({
  name: `${METRIC_PREFIX}http_request_duration_seconds`,
  help: 'HTTP request duration in seconds for infOS backend.',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [metricsRegistry],
})

/** 获取 Prometheus 文本格式的 content-type。 */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType
}

/** 导出当前 Registry 的 Prometheus 文本。 */
export async function renderMetrics(): Promise<string> {
  return metricsRegistry.metrics()
}

/** 测试专用：清空运行时采集值，但保留已注册的指标定义。 */
export function resetMetricsForTest(): void {
  metricsRegistry.resetMetrics()
}
