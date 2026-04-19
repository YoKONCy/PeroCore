/**
 * 日志工具
 *
 * 基于 consola 封装带模块标签的 logger 实例。
 * 同时支持终端输出 + 文件持久化 (08_LOGGING_SPEC.md)。
 *
 * 日志文件存放在 $PERO_DATA_DIR/logs/ 下，
 * 按天轮转、单文件 5MB 上限、14 天自动清理。
 *
 * 更深入的集成 (Electron IPC 转发 / Docker 采集)
 * 留到对应阶段实现。
 *
 * @module packages/backend/src/lib/logger
 */

import { createConsola, type ConsolaReporter, type LogObject } from 'consola'
import { LOG_LEVEL } from './env'
import { LogFileTransport, formatLogLine, type LogFileConfig } from './logFileTransport'
import path from 'node:path'

// ─────────────────────────────────────────────
// 文件 Transport (全局单例)
// ─────────────────────────────────────────────

/** 文件 Transport 实例 (懒初始化) */
let fileTransport: LogFileTransport | null = null

/**
 * 初始化日志文件持久化
 *
 * 在 app 启动时调用一次，之后所有 logger 实例自动写入文件。
 * 如果不调用此函数，日志只输出到终端。
 *
 * @param config - 日志文件配置 (可选，默认使用 $PERO_DATA_DIR/logs)
 */
export function initLogFile(config?: Partial<LogFileConfig>): void {
  const logDir = config?.logDir ?? path.join(
    process.env.PERO_DATA_DIR ?? path.join(require('node:os').homedir(), '.perocore'),
    'logs',
  )

  fileTransport = new LogFileTransport({
    logDir,
    maxFileSize: config?.maxFileSize,
    retentionDays: config?.retentionDays,
    prefix: config?.prefix,
  })

  // 用 console.log 而不是 logger 避免循环
  console.log(`[PeroCore] 日志文件已启用: ${fileTransport.getLogPath()}`)
}

/** 获取文件 Transport (给外部查询日志路径用) */
export function getLogFileTransport(): LogFileTransport | null {
  return fileTransport
}

// ─────────────────────────────────────────────
// 文件 Reporter (consola 插件)
// ─────────────────────────────────────────────

/** consola 文件持久化 reporter */
const fileReporter: ConsolaReporter = {
  log(logObj: LogObject) {
    if (!fileTransport) return

    // 提取 tag
    const tag = logObj.tag ?? ''

    // 提取消息文本
    const message = logObj.args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (arg instanceof Error) return arg.message
        return ''
      })
      .filter(Boolean)
      .join(' ')

    // 提取结构化参数 (非字符串、非 Error)
    const structuredArgs = logObj.args.filter(
      (arg) => typeof arg !== 'string' && !(arg instanceof Error) && arg != null,
    )

    const line = formatLogLine(logObj.level, tag, message, structuredArgs)
    fileTransport.write(line)
  },
}

// ─────────────────────────────────────────────
// Logger 工厂
// ─────────────────────────────────────────────

/**
 * 创建带模块标签的 logger 实例
 *
 * 自动同时输出到终端 (consola 默认) 和日志文件 (如已初始化)。
 *
 * @param module - 模块名称，用于日志标签
 * @example
 * ```ts
 * const logger = createLogger('MemoryService')
 * logger.info('记忆创建成功', { id: 42 })
 * ```
 */
export function createLogger(module: string) {
  return createConsola({
    level: LOG_LEVEL,
    reporters: [
      // 默认的终端 reporter (consola 内置 fancy 输出)
      // 传入空对象使用默认 reporter
      ...([] as ConsolaReporter[]),
      // 文件持久化 reporter
      fileReporter,
    ],
  }).withTag(module)
}

/** 根 logger（不带模块标签） */
export const logger = createLogger('PeroCore')
