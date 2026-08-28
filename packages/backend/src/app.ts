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
import { CODE_MESSAGES, CLIENT_ERROR_CODES } from '@infos/shared'
import { createObserverRouter } from './observer'
import { StaticAssetService } from './services/system/staticAssetService'
import { apiContractMiddleware } from './middleware/apiContract'
import { errorHandler } from './middleware/errorHandler'
import { metricsMiddleware } from './middleware/metrics'
import { requestContextMiddleware } from './middleware/requestContext'
import { tracingMiddleware } from './middleware/tracing'
import { requestLogger } from './middleware/requestLogger'
import { createAuthMiddleware, DEFAULT_PUBLIC_PATHS } from './middleware/auth'
import { createHealthRouter } from './routers/health.router'
import { createMetricsRouter } from './routers/metrics.router'
import type { AppContext } from './container'
import { initTelemetry } from './lib/telemetry'
import {
  createArcaRouter,
  createArcaCollaborationRouter,
  createArcaUiRouter,
  createApplicationsRouter,
  createChatRouter,
  createAttachmentRouter,
  createMemoryRouter,
  createKnowledgeRouter,
  createConfigRouter,
  createModelRouter,
  createSystemRouter,
  createDistributedRouter,
  createAgentRouter,
  createRuntimeRouter,
  createApprovalRouter,
  createAgentInputRouter,
  createSurfaceRouter,
  createWorkspaceRouter,
  createTerminalRouter,
  createSchedulerRouter,
  createAssetRouter,
  createGatewayRouter,
  createMaintenanceRouter,
  createResetRouter,
  // 注意：createSocialRouter 已迁移到 packages/apps/social/runtime/social.router.ts
  // （由 SocialAppRuntime.initialize 通过 ctx.mountRouter 动态挂载）
  createInboundRouteRouter,
  createBackgroundTaskRouter,
  createVoiceRouter,
  createMcpRouter,
  createStrongholdRouter,
} from './routers'

/**
 * 创建并配置 Hono 应用实例
 * @param ctx - 依赖注入上下文
 */
export function createApp(ctx: AppContext) {
  // 测试和嵌入式调用可能绕过 startServer，工厂本身也保证 Provider 已初始化。
  initTelemetry()
  const app = new Hono()

  // ── 全局中间件 ──
  app.use('*', cors())
  // metrics 需要包住后续中间件与路由，才能统计包含日志、业务处理和错误响应在内的完整耗时
  app.use('*', metricsMiddleware)
  // request context 必须早于 tracing/logger，确保业务日志和 Span 可共享请求字段
  app.use('*', requestContextMiddleware)
  app.use('*', tracingMiddleware)
  app.use('*', requestLogger)
  app.use('*', apiContractMiddleware)

  // 第六阶段 #8: Token 鉴权中间件
  // - 通过 INFOS_API_TOKEN 环境变量配置 token
  // - 未配置时中间件自动放行（开发环境默认开放）
  // - 健康检查、Prometheus 指标、登录接口等公共路径跳过鉴权
  // - 必须在 requestLogger 之后注册，以便 401 响应也能被日志记录
  const apiToken = process.env.INFOS_API_TOKEN ?? ''
  app.use(
    '*',
    createAuthMiddleware({
      token: apiToken,
      publicPaths: [...DEFAULT_PUBLIC_PATHS, '/applications/arca'],
    }),
  )

  // ── 全局错误处理 ──
  app.onError(errorHandler)

  // ── 健康检查 (白名单，无需鉴权) ──
  app.route('/api/health', createHealthRouter(ctx.logQueryService))

  // ── Prometheus 指标端点 (白名单，供 scrape 使用) ──
  app.route('/metrics', createMetricsRouter())

  // ── API 路由挂载 ──
  // 资源用复数名词, 路径 2-4 层
  if (ctx.arcaApplication) {
    app.route(
      '/applications/arca',
      createArcaUiRouter(new StaticAssetService(ctx.arcaApplication.uiRoot)),
    )
    app.route('/api/applications/arca', createArcaRouter(ctx))
  }
  if (ctx.arcaCollaboration) {
    app.route('/api/applications/arca/collaboration', createArcaCollaborationRouter(ctx))
  }
  app.route('/api/applications', createApplicationsRouter(ctx))
  app.route('/api/chat', createChatRouter(ctx))
  app.route('/api/attachments', createAttachmentRouter(ctx))
  app.route('/api/memories', createMemoryRouter(ctx))
  app.route('/api/knowledge', createKnowledgeRouter(ctx))
  app.route('/api/configs', createConfigRouter(ctx))
  app.route('/api/models', createModelRouter(ctx))
  app.route('/api/system', createSystemRouter(ctx))
  app.route('/api/distributed', createDistributedRouter(ctx))
  app.route('/api/agents', createAgentRouter(ctx))
  app.route('/api/runtime', createRuntimeRouter(ctx))
  app.route('/api/approvals', createApprovalRouter(ctx))
  app.route('/api/agent-inputs', createAgentInputRouter(ctx))
  app.route('/api/surfaces', createSurfaceRouter(ctx))
  if (ctx.agentStateService) {
    app.route('/api/observer', createObserverRouter(ctx.agentStateService))
  }
  app.route('/api/workspace', createWorkspaceRouter(ctx))
  app.route('/api/terminals', createTerminalRouter(ctx))
  app.route('/api/scheduler', createSchedulerRouter(ctx))
  app.route('/api/assets', createAssetRouter(ctx))
  app.route('/api/maintenance', createMaintenanceRouter(ctx))
  // 危险区域重置（清空对话/记忆/恢复出厂，均需确认短语）
  app.route('/api/reset', createResetRouter(ctx))
  // 注意：社交 HTTP 路由已迁移到 packages/apps/social/runtime/social.router.ts
  // （由 SocialAppRuntime 管理，不再通过主 AppContext 挂载）
  app.route('/api/inbound-routes', createInboundRouteRouter(ctx))
  // M05: 统一任务中心（派发/查询/控制 + Gateway 事件桥接）
  app.route('/api/background-tasks', createBackgroundTaskRouter(ctx))
  app.route(
    '/api/voice',
    createVoiceRouter({ ttsService: ctx.ttsService, asrService: ctx.asrService }),
  )
  app.route('/api/mcp', createMcpRouter(ctx))
  // 据点（群聊）路由：群聊房间管理、Agent 位置、管家配置等
  app.route('/api/stronghold', createStrongholdRouter(ctx))
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
