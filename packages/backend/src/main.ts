/**
 * 后端服务启动入口
 *
 * 初始化 DI 容器 → 异步初始化 → 创建 Hono 应用 → 启动 HTTP 服务器。
 * 默认监听 127.0.0.1:9120。
 *
 * @module packages/backend/src/main
 */

import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createAppContext, createDefaultConfig, initAppContext } from './container'
import { runStartupTasks } from './lifecycle'
import { logger, initLogFile } from './lib/logger'
import { SERVER_HOST, SERVER_PORT } from './lib/env'
import { registerProcessGuards, onShutdown } from './lib/processGuards'

// 0. 启动 Banner (最早输出，在任何初始化之前)
printBanner()

// 1. 初始化日志文件持久化 (越早越好)
initLogFile()

// 2. 注册进程守护 (日志就绪后立即注册)
registerProcessGuards()

async function main() {
  // 1. 初始化 DI 容器 (同步阶段)
  const config = createDefaultConfig()
  const ctx = createAppContext(config)

  // 2. 异步初始化 (工具注册 + 扩展加载 + 资产扫描)
  await initAppContext(ctx)

  // 3. 启动后任务 (调度器启动 + 任务恢复)
  await runStartupTasks(ctx)

  // 4. 创建 Hono 应用
  const app = createApp(ctx)

  // 5. 启动 HTTP 服务器
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

  // 注册优雅退出回调
  onShutdown(async () => {
    logger.info('正在关闭数据库连接...')
    // TODO: ctx.db.close() 等资源清理
    logger.info('资源清理完成')
  })
}

// 启动
main().catch((err) => {
  logger.error(`启动失败: ${err}`)
  if (err instanceof Error) {
    console.error(err.stack)
  }
  process.exit(1)
})

// ─────────────────────────────────────────────
// 启动 Banner
// ─────────────────────────────────────────────

function printBanner(): void {
  const banner = `
\x1b[38;5;213m██████╗ \x1b[38;5;183m███████╗\x1b[38;5;147m██████╗ \x1b[38;5;117m ██████╗ \x1b[38;5;87m ██████╗ \x1b[38;5;123m██████╗ \x1b[38;5;159m██████╗ \x1b[38;5;195m███████╗
\x1b[38;5;213m██╔══██╗\x1b[38;5;183m██╔════╝\x1b[38;5;147m██╔══██╗\x1b[38;5;117m██╔═══██╗\x1b[38;5;87m██╔════╝ \x1b[38;5;123m██╔═══██╗\x1b[38;5;159m██╔══██╗\x1b[38;5;195m██╔════╝
\x1b[38;5;213m██████╔╝\x1b[38;5;183m█████╗  \x1b[38;5;147m██████╔╝\x1b[38;5;117m██║   ██║\x1b[38;5;87m██║      \x1b[38;5;123m██║   ██║\x1b[38;5;159m██████╔╝\x1b[38;5;195m█████╗
\x1b[38;5;213m██╔═══╝ \x1b[38;5;183m██╔══╝  \x1b[38;5;147m██╔══██╗\x1b[38;5;117m██║   ██║\x1b[38;5;87m██║      \x1b[38;5;123m██║   ██║\x1b[38;5;159m██╔══██╗\x1b[38;5;195m██╔══╝
\x1b[38;5;213m██║     \x1b[38;5;183m███████╗\x1b[38;5;147m██║  ██║\x1b[38;5;117m╚██████╔╝\x1b[38;5;87m╚██████╗\x1b[38;5;123m╚██████╔╝\x1b[38;5;159m██║  ██║\x1b[38;5;195m███████╗
\x1b[38;5;213m╚═╝     \x1b[38;5;183m╚══════╝\x1b[38;5;147m╚═╝  ╚═╝\x1b[38;5;117m ╚═════╝ \x1b[38;5;87m ╚═════╝\x1b[38;5;123m ╚═════╝ \x1b[38;5;159m╚═╝  ╚═╝\x1b[38;5;195m╚══════╝\x1b[0m

\x1b[38;5;219m          v     v
         ( > ‿ < )   < Hi~ Master!
         /  |><|  \\
        (  _____  )\x1b[0m
`

  const separator = '\x1b[38;5;240m' + '='.repeat(60) + '\x1b[0m'
  const now = new Date().toLocaleString('zh-CN', { hour12: false })

  console.log(banner)
  console.log(separator)
  console.log(`\x1b[38;5;219m🚀 萌动链接：PeroperoChat!\x1b[0m`)
  console.log(`\x1b[38;5;183m📅 时间: ${now}\x1b[0m`)
  console.log(`\x1b[38;5;147m📂 数据目录: ${process.env.PERO_DATA_DIR ?? 'Default'}\x1b[0m`)
  console.log(`\x1b[38;5;117m💻 平台: ${process.platform} / Node ${process.version}\x1b[0m`)
  console.log(separator)
}
