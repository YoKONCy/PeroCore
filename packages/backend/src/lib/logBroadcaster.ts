/**
 * 日志 SSE 广播器
 *
 * 接收 consola 的日志事件，广播给所有已连接的 SSE 客户端。
 * 同时维护一个环形缓冲区保存最近的日志历史，供新连接和断线续传使用。
 *
 * 特性：
 * - 每条日志携带自增 ID，支持 EventSource 的 Last-Event-ID 断线续传
 * - 环形缓冲区保留最近 500 条日志
 * - 高频日志不阻塞主线程（监听器异常静默处理）
 *
 * @module packages/backend/src/lib/logBroadcaster
 */

import type { ConsolaReporter, LogObject } from 'consola'
import { formatLogLine } from './logFileTransport'

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

export interface LogEvent {
  /** 自增事件 ID（用于 SSE Last-Event-ID 断线续传） */
  id: number
  /** 日志级别标签 */
  level: string
  /** 模块标签 */
  tag: string
  /** 格式化后的完整日志行 */
  line: string
  /** 时间戳 (ISO) */
  timestamp: string
}

type LogListener = (event: LogEvent) => void

// ─────────────────────────────────────────────
// 级别映射
// ─────────────────────────────────────────────

const LEVEL_LABELS: Record<number, string> = {
  0: 'FATAL',
  1: 'ERROR',
  2: 'WARN',
  3: 'INFO',
  4: 'DEBUG',
  5: 'TRACE',
}

// ─────────────────────────────────────────────
// 广播器 (全局单例)
// ─────────────────────────────────────────────

/** 已连接的 SSE 监听器 */
const listeners = new Set<LogListener>()

/** 自增事件 ID 计数器 */
let eventIdCounter = 0

/** 环形缓冲区 — 保存最近 500 条日志 */
const LOG_BUFFER_SIZE = 500
const logBuffer: LogEvent[] = []

/** 注册 SSE 监听器，返回注销函数 */
export function addLogListener(listener: LogListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 获取日志历史（支持断线续传）
 *
 * @param afterId - 如果提供，只返回 ID 大于此值的日志（用于 Last-Event-ID 续传）
 *                  如果 afterId 对应的日志已被环形缓冲淘汰，返回全部缓冲内容
 */
export function getLogHistory(afterId?: number): LogEvent[] {
  if (afterId == null) {
    return [...logBuffer]
  }
  // 找到 afterId 之后的日志
  const idx = logBuffer.findIndex((e) => e.id > afterId)
  if (idx === -1) {
    // afterId 比缓冲区里最新的还新 → 没有新日志
    return []
  }
  return logBuffer.slice(idx)
}

/** 广播一条日志事件 */
function broadcast(event: LogEvent): void {
  // 写入环形缓冲区
  logBuffer.push(event)
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift()
  }

  // 通知所有监听器
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // 单个监听器异常不影响其他
    }
  }
}

// ─────────────────────────────────────────────
// consola reporter (插件)
// ─────────────────────────────────────────────

/**
 * SSE 广播 reporter
 *
 * 在 logger 的 createConsola 时添加此 reporter，
 * 所有日志自动广播到 SSE 客户端。
 */
export const sseReporter: ConsolaReporter = {
  log(logObj: LogObject) {
    const tag = logObj.tag ?? ''
    const level = LEVEL_LABELS[logObj.level] ?? 'LOG'

    // 提取消息文本
    const message = logObj.args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (arg instanceof Error) return arg.message
        return ''
      })
      .filter(Boolean)
      .join(' ')

    // 提取结构化参数
    const structuredArgs = logObj.args.filter(
      (arg) => typeof arg !== 'string' && !(arg instanceof Error) && arg != null,
    )

    const line = formatLogLine(logObj.level, tag, message, structuredArgs)

    broadcast({
      id: ++eventIdCounter,
      level,
      tag,
      line,
      timestamp: new Date().toISOString(),
    })
  },
}
