/**
 * 后端服务启动入口（开发期 / Electron spawn 兼容期）
 *
 * 实际启动逻辑由 @perocore/backend/startup 中的 startServer() 统一处理，
 * 本文件仅保留 Banner 与启动调用，确保 `pnpm start` 默认路径下行为
 * 与 daemon/main.ts 完全对齐。
 *
 * 独立部署请使用 @perocore/daemon（packages/daemon/src/main.ts）。
 *
 * @module packages/backend/src/main
 */

import { startServer } from './startup'
import { logger } from './lib/logger'

// 启动（公共启动逻辑统一委托给 startServer）
startServer({
  processName: 'PeroCore 后端',
  printBanner: printBanner,
  onHttpReady: (address, port) => {
    // backend 入口保留 success 日志（绿色对勾），与历史行为一致
    logger.success(`PeroCore 后端已就绪 → http://${address}:${port}`)
  },
}).catch((err) => {
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
