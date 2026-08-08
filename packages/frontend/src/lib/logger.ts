/**
 * 前端统一日志工具
 *
 * 替代裸 console.log，提供带模块标签的结构化日志。
 * Electron 模式下自动将日志转发到主进程。
 *
 * 使用方式:
 *   logger.info('ChatInput', '发送消息', { length: 42 })
 *   logger.error('ApiClient', '请求失败', { endpoint: '/api/chat' })
 *
 * ❌ 禁止使用:
 * @example
 * logger.info('Chat', '发送消息中')
 * logger.error('Chat', '发送失败', err)
 *
 * @module packages/frontend/src/lib/logger
 */

import { isElectron } from '../utils/ipcAdapter'

/** 日志级别 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 格式化日志前缀 */
function formatPrefix(level: LogLevel, tag: string): string {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  return `[${time}] [${level.toUpperCase()}] [${tag}]`
}

/** 发送日志到 Electron 主进程 (如可用) */
function sendToMainProcess(level: LogLevel, tag: string, message: string): void {
  if (isElectron() && window.electron) {
    window.electron.send('log-from-renderer', `[${level.toUpperCase()}] [${tag}] ${message}`)
  }
}

/**
 * 前端统一日志对象
 *
 * @example
 * ```ts
 * logger.info('ChatInput', '发送消息', { length: 42 })
 * logger.warn('Gateway', '连接超时，重试中', { attempt: 2 })
 * logger.error('ApiClient', '请求失败', { endpoint, code: err.code })
 * ```
 */
export const logger = {
  /** 调试信息 (生产环境可静默) */
  debug(tag: string, message: string, data?: unknown): void {
    if (import.meta.env.DEV) {
      console.debug(`${formatPrefix('debug', tag)} ${message}`, data ?? '')
    }
  },

  /** 关键业务节点 */
  info(tag: string, message: string, data?: unknown): void {
    console.log(`${formatPrefix('info', tag)} ${message}`, data ?? '')
    sendToMainProcess('info', tag, message)
  },

  /** 降级、重试、非致命异常 */
  warn(tag: string, message: string, data?: unknown): void {
    console.warn(`${formatPrefix('warn', tag)} ${message}`, data ?? '')
    sendToMainProcess('warn', tag, message)
  },

  /** 系统异常 */
  error(tag: string, message: string, data?: unknown): void {
    console.error(`${formatPrefix('error', tag)} ${message}`, data ?? '')
    sendToMainProcess('error', tag, message)
  },
}
