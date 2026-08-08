/**
 * PeroCore Daemon — 独立进程入口
 *
 * 第七阶段核心改造：Daemon 可独立运行，不依赖 Electron spawn。
 * - 复用 backend 的 DI 容器 / 路由 / 生命周期任务
 * - 额外启动 CapabilityBridge WS 服务端（:9121），接收能力节点注册
 * - 支持 pm2 / 系统服务 / 命令行直接运行
 *
 * 实际启动逻辑由 @perocore/backend/startup 中的 startServer() 统一处理，
 * 本文件仅保留 Daemon 专属 Banner 与启动调用。
 *
 * 与 backend/main.ts 的差异：
 * - backend/main.ts：保留为开发期入口（Electron spawn 兼容期用）
 * - daemon/main.ts：独立部署的权威入口，Banner 标注独立进程模式
 *
 * @module packages/daemon/src/main
 */

import { startServer } from '@perocore/backend/startup'
import { logger } from '@perocore/backend/lib/logger'

// 启动（公共启动逻辑统一委托给 startServer）
startServer({
  processName: 'PeroCore Daemon',
  printBanner: printBanner,
  onHttpReady: (address, port) => {
    // Daemon 入口保留 info 日志（与历史行为一致）
    logger.info(`业务 HTTP 已就绪 → http://${address}:${port}`)
  },
}).catch((err) => {
  logger.error(`Daemon 启动失败: ${err}`)
  if (err instanceof Error) {
    console.error(err.stack)
  }
  process.exit(1)
})

// ─────────────────────────────────────────────
// Daemon 专属启动 Banner
// ─────────────────────────────────────────────

function printBanner(): void {
  const banner = `
\x1b[38;5;213m╔══════════════════════════════════════════════════════╗
\x1b[38;5;183m║  \x1b[38;5;147m██████╗ \x1b[38;5;117m███████╗\x1b[38;5;87m██████╗ \x1b[38;5;123m ██████╗ \x1b[38;5;159m██████╗  \x1b[38;5;183m║
\x1b[38;5;183m║  \x1b[38;5;147m██╔══██╗\x1b[38;5;117m██╔════╝\x1b[38;5;87m██╔══██╗\x1b[38;5;123m██╔═══██╗\x1b[38;5;159m██╔═══██╗ \x1b[38;5;183m║
\x1b[38;5;183m║  \x1b[38;5;147m██████╔╝\x1b[38;5;117m█████╗  \x1b[38;5;87m██████╔╝\x1b[38;5;123m██║   ██║\x1b[38;5;159m██║   ██║ \x1b[38;5;183m║
\x1b[38;5;183m║  \x1b[38;5;147m██╔═══╝ \x1b[38;5;117m██╔══╝  \x1b[38;5;87m██╔══██╗\x1b[38;5;123m██║   ██║\x1b[38;5;159m██║   ██║ \x1b[38;5;183m║
\x1b[38;5;183m║  \x1b[38;5;147m██║     \x1b[38;5;117m███████╗\x1b[38;5;87m██║  ██║\x1b[38;5;123m╚██████╔╝\x1b[38;5;159m╚██████╔╝ \x1b[38;5;183m║
\x1b[38;5;183m║  \x1b[38;5;147m╚═╝     \x1b[38;5;117m╚══════╝\x1b[38;5;87m╚═╝  ╚═╝\x1b[38;5;123m ╚═════╝ \x1b[38;5;159m ╚═════╝  \x1b[38;5;183m║
\x1b[38;5;213m╚══════════════════════════════════════════════════════╝\x1b[0m

\x1b[38;5;219m          v     v
         ( > ‿ < )   < Daemon Mode
         /  |><|  \\
        (  _____  )\x1b[0m
`

  const separator = '\x1b[38;5;240m' + '='.repeat(60) + '\x1b[0m'
  const now = new Date().toLocaleString('zh-CN', { hour12: false })

  console.log(banner)
  console.log(separator)
  console.log(`\x1b[38;5;219m🚀 PeroCore Daemon (独立进程模式)\x1b[0m`)
  console.log(`\x1b[38;5;183m📅 时间: ${now}\x1b[0m`)
  console.log(`\x1b[38;5;147m📂 数据目录: ${process.env.PERO_DATA_DIR ?? '默认'}\x1b[0m`)
  console.log(`\x1b[38;5;117m💻 平台: ${process.platform} / Node ${process.version}\x1b[0m`)
  console.log(`\x1b[38;5;87m🔌 业务端口: ${process.env.PERO_PORT ?? '9120'}\x1b[0m`)
  console.log(`\x1b[38;5;123m🛠  能力通道端口: ${process.env.PERO_CAPABILITY_PORT ?? '9121'}\x1b[0m`)
  console.log(separator)
}
