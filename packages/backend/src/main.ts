/**
 * 后端服务启动入口
 *
 * 初始化 DI 容器 → 创建 Hono 应用 → 启动 HTTP 服务器。
 * 默认监听 127.0.0.1:9120。
 *
 * @module packages/backend/src/main
 */

import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAppContext, createDefaultConfig } from './container'
import { logger, initLogFile } from './lib/logger'
import { SERVER_HOST, SERVER_PORT } from './lib/env'

// 0. 初始化日志文件持久化 (越早越好)
initLogFile()

// 1. 初始化 DI 容器
const config = createDefaultConfig()
const ctx = createAppContext(config)

// 2. 创建 Hono 应用
const app = createApp(ctx)

// 3. 启动 HTTP 服务器
logger.info(`PeroCore 后端启动中... → http://${SERVER_HOST}:${SERVER_PORT}`)

serve(
  {
    fetch: app.fetch,
    hostname: SERVER_HOST,
    port: SERVER_PORT,
  },
  (info) => {
    logger.success(`PeroCore 后端已就绪 → http://${info.address}:${info.port}`)
  },
)
