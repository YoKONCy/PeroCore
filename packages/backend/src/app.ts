/**
 * Hono 应用入口
 *
 * 负责中间件注册、路由挂载与健康检查端点。
 * 使用 createApp() 工厂模式，便于测试 (04_BACKEND_ARCHITECTURE.md)。
 *
 * @module packages/backend/src/app
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { CODE_MESSAGES, CLIENT_ERROR_CODES } from '@perocore/shared'
import { errorHandler } from './middleware/errorHandler'
import { requestLogger } from './middleware/requestLogger'
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
} from './routers'

/**
 * 创建并配置 Hono 应用实例
 * @param ctx - 依赖注入上下文 (04_BACKEND_ARCHITECTURE.md §5)
 */
export function createApp(ctx: AppContext) {
  const app = new Hono()

  // ── 全局中间件 ──
  app.use('*', cors())
  app.use('*', requestLogger)

  // ── 全局错误处理 (02_API_RESPONSE_SPEC.md §7.2) ──
  app.onError(errorHandler)

  // ── API 路由挂载 (04_BACKEND_ARCHITECTURE.md §2) ──
  // 资源用复数名词, 路径 2-4 层 (01_NAMING_CONVENTIONS.md §3)
  app.route('/api/chat', createChatRouter(ctx))
  app.route('/api/memories', createMemoryRouter(ctx))
  app.route('/api/configs', createConfigRouter(ctx))
  app.route('/api/models', createModelRouter(ctx))
  app.route('/api/system', createSystemRouter(ctx))
  app.route('/api/agents', createAgentRouter(ctx))
  app.route('/api/scheduler', createSchedulerRouter(ctx))
  app.route('/api/assets', createAssetRouter(ctx))
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
