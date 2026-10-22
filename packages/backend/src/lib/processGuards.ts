import { t as __t } from './i18n'
/**
 * 进程生命周期守护
 *
 * 运维级别的未捕获异常处理 + 信号优雅退出：
 * - uncaughtException → 记录到日志文件，1 秒后退出
 * - unhandledRejection → 记录到日志文件，标记为 warn
 * - SIGINT / SIGTERM → 优雅关闭资源后退出
 *
 * 在 main.ts 中尽早调用 registerProcessGuards()。
 *
 * @see .docs/S03_LOGGING_SPEC.md
 * @see .docs/A08_DEVOPS.md
 * @module packages/backend/src/lib/processGuards
 */

import { createLogger } from './logger'
import { DAEMON_SHUTDOWN_MESSAGE } from '@infos/shared'

const logger = createLogger('进程守护')

/** 优雅退出时的回调队列 */
const shutdownCallbacks: Array<() => Promise<void> | void> = []
let registered = false
let shutdownPromise: Promise<void> | null = null

/** 信号和父进程 IPC 共用一次清理，避免重复关闭数据库及工作线程。 */
export function requestGracefulShutdown(reason: string): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    logger.info(__t('logs.lib', '收到 {0} 信号，开始优雅退出...', [reason]))
    for (const callback of shutdownCallbacks) {
      try {
        await callback()
      } catch (error) {
        logger.error(__t('logs.lib', '清理回调执行失败'), { error: String(error) })
      }
    }
    logger.info(__t('logs.lib', '优雅退出完成，再见喵~ 🐾'))
    setTimeout(() => process.exit(0), 500)
  })()
  return shutdownPromise
}

/**
 * 注册进程守护
 *
 * 应在 main.ts 初始化日志文件后立即调用。
 */
export function registerProcessGuards(): void {
  if (registered) return
  registered = true
  // ── 未捕获的同步异常 ──
  process.on('uncaughtException', (err) => {
    logger.error(__t('logs.lib', '未捕获异常 (uncaughtException)，进程即将退出'), {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })

    // 给日志文件 flush 的时间，然后退出
    setTimeout(() => process.exit(1), 1000)
  })

  // ── 未处理的 Promise 拒绝 ──
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? reason.stack : undefined

    logger.warn(__t('logs.lib', '未处理的 Promise 拒绝 (unhandledRejection)'), {
      message,
      stack,
    })
  })

  // ── 优雅退出信号 ──
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  for (const signal of signals) {
    process.on(signal, () => {
      void requestGracefulShutdown(signal)
    })
  }
  // Windows 的 kill 不保证触发 SIGTERM，内置后端通过专用 IPC 接收正常退出请求。
  if (process.send) {
    process.on('message', (message: unknown) => {
      if (
        message &&
        typeof message === 'object' &&
        'type' in message &&
        message.type === DAEMON_SHUTDOWN_MESSAGE
      ) {
        void requestGracefulShutdown('IPC')
      }
    })
  }

  // ── 进程退出前最后的日志 ──
  process.on('exit', (code) => {
    // 这里只能用同步操作
    console.log(__t('logs.lib', '[infOS] 进程退出 (code: {0})', [code]))
  })

  logger.debug(
    __t('logs.lib', '进程守护已注册 (uncaughtException / unhandledRejection / SIGINT / SIGTERM)'),
  )
}

/**
 * 注册优雅退出回调
 *
 * 当收到 SIGINT/SIGTERM 时，按注册顺序依次执行。
 * 适用于关闭数据库连接、WebSocket 广播、文件句柄等。
 *
 * @param callback - 清理函数 (可以是异步)
 *
 * @example
 * ```ts
 * onShutdown(async () => {
 *   await db.close()
 *   logger.info('数据库连接已关闭')
 * })
 * ```
 */
export function onShutdown(callback: () => Promise<void> | void): void {
  shutdownCallbacks.push(callback)
}
