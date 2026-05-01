/**
 * Hono 应用入口
 *
 * 负责中间件注册、路由挂载与健康检查端点。
 * 使用 createApp() 工厂模式，便于测试。
 *
 * @module packages/backend/src/app
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CODE_MESSAGES, CLIENT_ERROR_CODES } from '@perocore/shared'
import { errorHandler } from './middleware/errorHandler'
import { metricsMiddleware } from './middleware/metrics'
import { requestContextMiddleware } from './middleware/requestContext'
import { requestLogger } from './middleware/requestLogger'
import { createHealthRouter } from './routers/health.router'
import { createMetricsRouter } from './routers/metrics.router'
import type { AppContext } from './container'
import {
  createChatRouter,
  createMemoryRouter,
  createConfigRouter,
  createModelRouter,
  createSystemRouter,
  createAgentRouter,
  createSchedulerRouter,
  createAssetRouter,
  createGatewayRouter,
  createMaintenanceRouter,
  createSocialRouter,
  createVoiceRouter,
  createMcpRouter,
} from './routers'

/**
 * 创建并配置 Hono 应用实例
 * @param ctx - 依赖注入上下文
 */
export function createApp(ctx: AppContext) {
  const app = new Hono()

  // ── 全局中间件 ──
  app.use('*', cors())
  // metrics 需要包住后续中间件与路由，才能统计包含日志、业务处理和错误响应在内的完整耗时
  app.use('*', metricsMiddleware)
  // request context 必须早于 requestLogger 注册，否则 HTTP 日志拿不到 requestId
  app.use('*', requestContextMiddleware)
  app.use('*', requestLogger)

  // ── 全局错误处理 ──
  app.onError(errorHandler)

  // ── 健康检查 (白名单，无需鉴权) ──
  app.route('/api/health', createHealthRouter())

  // ── Prometheus 指标端点 (白名单，供 scrape 使用) ──
  app.route('/metrics', createMetricsRouter())

  // ── API 路由挂载 ──
  // 资源用复数名词, 路径 2-4 层
  app.route('/api/chat', createChatRouter(ctx))
  app.route('/api/memories', createMemoryRouter(ctx))
  app.route('/api/configs', createConfigRouter(ctx))
  app.route('/api/models', createModelRouter(ctx))
  app.route('/api/system', createSystemRouter(ctx))
  app.route('/api/agents', createAgentRouter(ctx))
  app.route('/api/scheduler', createSchedulerRouter(ctx))
  app.route('/api/assets', createAssetRouter(ctx))
  app.route('/api/maintenance', createMaintenanceRouter(ctx))
  app.route('/api/social', createSocialRouter(ctx))
  app.route(
    '/api/voice',
    createVoiceRouter({ ttsService: ctx.ttsService, asrService: ctx.asrService }),
  )
  app.route('/api/mcp', createMcpRouter(ctx))
  app.route('/ws', createGatewayRouter(ctx.gatewayHub))

  // ── 404 兜底 ──
  const notFoundCode = CLIENT_ERROR_CODES.NOT_FOUND
  app.notFound((c) =>
    c.json(
      {
        code: notFoundCode,
        message: CODE_MESSAGES[notFoundCode],
      },
      404,
    ),
  )

  return app
}
