import { t as __t } from './lib/i18n'
/**
 * 后端服务启动入口（开发期 / Electron spawn 兼容期）
 *
 * 实际启动逻辑由 @infos/backend/startup 中的 startServer() 统一处理，
 * 本文件仅保留 Banner 与启动调用，确保 `pnpm start` 默认路径下行为
 * 与 daemon/main.ts 完全对齐。
 *
 * 独立部署请使用 @infos/daemon（packages/daemon/src/main.ts）。
 *
 * @module packages/backend/src/main
 */

import { startServer } from './startup'
import { getDataDir } from './lib/env'
import { logger } from './lib/logger'

// 启动（公共启动逻辑统一委托给 startServer）
startServer({
  processName: 'infOS 后端',
  printBanner: printBanner,
  onHttpReady: (address, port) => {
    // backend 入口保留 success 日志（绿色对勾），与历史行为一致
    logger.success(__t('logs.main.ts', 'infOS 后端已就绪 → http://{0}:{1}', [address, port]))
  },
}).catch((err) => {
  logger.error(__t('logs.main.ts', '启动失败: {0}', [err]))
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
  console.log('\u001b[38;5;219m' + __t('logs.main.ts', '🚀 萌动链接：PeroperoChat!') + '\u001b[0m')
  console.log('\u001b[38;5;183m' + __t('logs.main.ts', '📅 时间: {0}', [now]) + '\u001b[0m')
  console.log(
    '\u001b[38;5;147m' + __t('logs.main.ts', '📂 数据目录: {0}', [getDataDir()]) + '\u001b[0m',
  )
  console.log(
    '\u001b[38;5;117m' +
      __t('logs.main.ts', '💻 平台: {0} / Node {1}', [process.platform, process.version]) +
      '\u001b[0m',
  )
  console.log(separator)
}
