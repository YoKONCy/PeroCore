/**
 * Token 鉴权中间件
 *
 * 第六阶段 #8: 给本机 HTTP 路由加 token 鉴权层。
 *
 * 设计要点：
 * - 通过 PEROCORE_API_TOKEN 环境变量配置鉴权 token
 * - 未配置 token 时中间件不生效（开发环境默认开放）
 * - 公共路径（健康检查、Prometheus 指标、登录鉴权等）跳过鉴权
 * - 客户端通过 `Authorization: Bearer <token>` 请求头传递 token
 * - WebSocket 升级请求通过 query 参数 `?token=<token>` 传递
 *
 * @module packages/backend/src/middleware/auth
 */

import type { MiddlewareHandler } from 'hono'

/** 鉴权失败响应体 */
interface AuthErrorResponse {
  code: 'UNAUTHORIZED'
  message: string
}

/** 创建鉴权中间件选项 */
export interface AuthMiddlewareOptions {
  /** 鉴权 token（从环境变量或配置读取），为空字符串时中间件不生效 */
  token: string
  /** 不需要鉴权的路径前缀列表 */
  publicPaths?: string[]
}

/** 默认公共路径（健康检查、Prometheus 指标、登录） */
export const DEFAULT_PUBLIC_PATHS = [
  '/api/health',
  '/metrics',
  '/api/auth/login',
]

/**
 * 创建 Token 鉴权中间件
 *
 * 用法：
 * ```ts
 * app.use('*', createAuthMiddleware({
 *   token: process.env.PEROCORE_API_TOKEN ?? '',
 * }))
 * ```
 *
 * 校验逻辑：
 * 1. token 为空 → 直接放行（未配置鉴权）
 * 2. 路径命中 publicPaths → 放行
 * 3. Authorization: Bearer <token> 与配置一致 → 放行
 * 4. WebSocket 升级请求的 query 参数 ?token=<token> 与配置一致 → 放行
 * 5. 其他情况返回 401
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareHandler {
  const { token } = options
  const publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS

  return async (c, next) => {
    // 未配置 token → 中间件不生效（开发环境默认开放）
    if (!token) {
      return await next()
    }

    const path = c.req.path

    // 公共路径跳过鉴权
    if (publicPaths.some((p) => path === p || path.startsWith(p + '/'))) {
      return await next()
    }

    // 优先从 Authorization: Bearer <token> 读取
    const authHeader = c.req.header('authorization') ?? c.req.header('Authorization')
    const bearerToken = authHeader?.replace(/^Bearer\s+/i, '')

    if (bearerToken && bearerToken === token) {
      return await next()
    }

    // WebSocket 升级请求支持 ?token=<token>（浏览器 WS 客户端无法设置自定义 header）
    const queryToken = c.req.query('token')
    if (queryToken && queryToken === token) {
      return await next()
    }

    // 鉴权失败
    const body: AuthErrorResponse = {
      code: 'UNAUTHORIZED',
      message: '未授权：缺少或无效的 token',
    }
    return c.json(body, 401)
  }
}
