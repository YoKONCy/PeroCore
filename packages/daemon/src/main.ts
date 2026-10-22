import { t as __t } from '../../backend/src/lib/i18n'
/**
 * infOS Daemon — 独立进程入口
 *
 * 第七阶段核心改造：Daemon 可独立运行，不依赖 Electron spawn。
 * - 复用 backend 的 DI 容器 / 路由 / 生命周期任务
 * - 额外启动 CapabilityBridge WS 服务端（:9121），接收能力节点注册
 * - 支持 pm2 / 系统服务 / 命令行直接运行
 *
 * 实际启动逻辑由 @infos/backend/startup 中的 startServer() 统一处理，
 * 本文件仅保留 Daemon 专属 Banner 与启动调用。
 *
 * 与 backend/main.ts 的差异：
 * - backend/main.ts：保留为开发期入口（Electron spawn 兼容期用）
 * - daemon/main.ts：独立部署的权威入口，Banner 标注独立进程模式
 *
 * @module packages/daemon/src/main
 */

import { startServer } from '@infos/backend/startup'
import { getDataDir } from '@infos/backend/lib/env'
import { logger } from '@infos/backend/lib/logger'
import { DaemonAlreadyRunningError } from '@infos/backend/lib/startupStorage'
import { DAEMON_ALREADY_RUNNING_EXIT_CODE } from '@infos/shared'

// 启动（公共启动逻辑统一委托给 startServer）
startServer({
  processName: 'infOS Daemon',
  printBanner: printBanner,
  onHttpReady: (address, port) => {
    // Daemon 入口保留 info 日志（与历史行为一致）
    logger.info(
      '[infOS:ready:http] ' +
        __t('logs.daemon', '业务 HTTP 已就绪 → http://{0}:{1}', [address, port]),
    )
  },
}).catch((err) => {
  logger.error(__t('logs.daemon', 'Daemon 启动失败: {0}', [err]))
  if (err instanceof Error) {
    console.error(err.stack)
  }
  process.exit(err instanceof DaemonAlreadyRunningError ? DAEMON_ALREADY_RUNNING_EXIT_CODE : 1)
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
  console.log(
    '\u001b[38;5;219m' + __t('logs.daemon', '🚀 infOS Daemon (独立进程模式)') + '\u001b[0m',
  )
  console.log('\u001b[38;5;183m' + __t('logs.daemon', '📅 时间: {0}', [now]) + '\u001b[0m')
  console.log(
    '\u001b[38;5;147m' + __t('logs.daemon', '📂 数据目录: {0}', [getDataDir()]) + '\u001b[0m',
  )
  console.log(
    '\u001b[38;5;117m' +
      __t('logs.daemon', '💻 平台: {0} / Node {1}', [process.platform, process.version]) +
      '\u001b[0m',
  )
  console.log(
    '\u001b[38;5;87m' +
      __t('logs.daemon', '🔌 业务端口: {0}', [process.env.PERO_PORT ?? '9120']) +
      '\u001b[0m',
  )
  console.log(
    '\u001b[38;5;123m' +
      __t('logs.daemon', '🛠  能力通道端口: {0}', [process.env.PERO_CAPABILITY_PORT ?? '9121']) +
      '\u001b[0m',
  )
  console.log(separator)
}
