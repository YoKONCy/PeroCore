/**
 * 日志文件 Transport
 *
 * 将 consola 日志持久化到磁盘文件。
 * 支持按天轮转 + 文件大小上限 + 自动清理过期日志。
 *
 * 更深入的集成 (Electron IPC 转发 / Docker stdout 采集)
 * 留到对应阶段实现。
 *
 * @module packages/backend/src/lib/logFileTransport
 */

import { appendFileSync, existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { LOG_FORMAT } from './env'
import { getRequestContext } from './requestContext'

// ─────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────

export interface LogFileConfig {
  /** 日志文件目录 */
  logDir: string
  /** 单文件大小上限 (字节, 默认 5MB) */
  maxFileSize?: number
  /** 保留天数 (默认 14 天) */
  retentionDays?: number
  /** 日志文件前缀 (默认 "perocore") */
  prefix?: string
}

// ─────────────────────────────────────────────
// Transport 实现
// ─────────────────────────────────────────────

/**
 * 日志文件写入器
 *
 * 策略：
 * - 按天创建日志文件: `perocore-2026-04-20.log`
 * - 单文件超过 maxFileSize 后自动轮转: `perocore-2026-04-20.1.log`
 * - 启动时自动清理超过 retentionDays 的旧日志
 */
export class LogFileTransport {
  private logDir: string
  private maxFileSize: number
  private retentionDays: number
  private prefix: string
  private currentDate: string = ''
  private currentPath: string = ''
  private rotationIndex: number = 0

  constructor(config: LogFileConfig) {
    this.logDir = config.logDir
    this.maxFileSize = config.maxFileSize ?? 5 * 1024 * 1024 // 5MB
    this.retentionDays = config.retentionDays ?? 14
    this.prefix = config.prefix ?? 'perocore'

    // 确保目录存在
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }

    // 初始化当天文件路径
    this.refreshPath()

    // 启动时清理过期日志
    this.cleanup()
  }

  /**
   * 写入一行日志
   *
   * 由 consola 的自定义 reporter 调用。
   */
  write(line: string): void {
    try {
      // 检查是否跨天
      const today = this.getDateString()
      if (today !== this.currentDate) {
        this.currentDate = today
        this.rotationIndex = 0
        this.refreshPath()
      }

      // 检查文件大小，需要轮转
      if (existsSync(this.currentPath)) {
        const stat = statSync(this.currentPath)
        if (stat.size >= this.maxFileSize) {
          this.rotate()
        }
      }

      // 追加写入
      appendFileSync(this.currentPath, line + '\n', 'utf-8')
    } catch {
      // 日志写入失败不应影响主业务，静默忽略
    }
  }

  /**
   * 获取当前日志文件路径
   */
  getLogPath(): string {
    return this.currentPath
  }

  /**
   * 获取日志目录
   */
  getLogDir(): string {
    return this.logDir
  }

  // ── 内部方法 ──

  /** 刷新当前日志文件路径 */
  private refreshPath(): void {
    this.currentDate = this.getDateString()
    this.currentPath = this.buildPath(this.currentDate, this.rotationIndex)
  }

  /** 构建日志文件路径 */
  private buildPath(date: string, index: number): string {
    const suffix = index > 0 ? `.${index}` : ''
    return path.join(this.logDir, `${this.prefix}-${date}${suffix}.log`)
  }

  /** 文件大小轮转 */
  private rotate(): void {
    this.rotationIndex++
    this.currentPath = this.buildPath(this.currentDate, this.rotationIndex)
  }

  /** 清理过期日志 */
  private cleanup(): void {
    try {
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
      const files = readdirSync(this.logDir)

      let cleanedCount = 0
      for (const file of files) {
        if (!file.startsWith(this.prefix) || !file.endsWith('.log')) continue

        const filePath = path.join(this.logDir, file)
        const stat = statSync(filePath)

        if (stat.mtimeMs < cutoff) {
          unlinkSync(filePath)
          cleanedCount++
        }
      }

      if (cleanedCount > 0) {
        // 不用 logger 避免循环依赖，直接写入当前日志文件
        const msg = `[${new Date().toISOString()}] [INFO] [LogFile] 已清理 ${cleanedCount} 个过期日志文件\n`
        appendFileSync(this.currentPath, msg, 'utf-8')
      }
    } catch {
      // 清理失败不影响主业务
    }
  }

  /** 获取今天的日期字符串 (YYYY-MM-DD) */
  private getDateString(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}

// ─────────────────────────────────────────────
// 日志行格式化
// ─────────────────────────────────────────────

/** consola 日志级别 → 文本 */
const LEVEL_LABELS: Record<number, string> = {
  0: 'FATAL',
  1: 'ERROR',
  2: 'WARN',
  3: 'INFO',
  4: 'DEBUG',
  5: 'TRACE',
}

/**
 * 格式化日志行 (用于文件持久化)
 *
 * 默认输出人类可读文本；当 PERO_LOG_FORMAT=json 时输出 JSON Lines，
 * 便于后续接入日志采集系统，并把 requestId/traceId 等链路字段提升为顶层字段。
 *
 * 文本输出格式:
 * [2026-04-20T01:20:00.000Z] [INFO] [MemoryService] [req_xxx] 记忆已创建 {"memoryId":42}
 *
 * JSON Lines 输出格式:
 * {"timestamp":"...","level":"INFO","tag":"MemoryService","message":"记忆已创建","requestId":"req_xxx","memoryId":42}
 */
export function formatLogLine(
  level: number,
  tag: string,
  message: string,
  args: unknown[],
): string {
  const timestamp = new Date().toISOString()
  const levelLabel = LEVEL_LABELS[level] ?? 'LOG'
  /** 当前请求上下文；如果日志不在 HTTP 请求链路中产生，则这里为空 */
  const context = getRequestContext()

  if (LOG_FORMAT === 'json') {
    /** JSON Lines 记录：每次调用返回一行完整 JSON，便于后续接入 Loki/ELK/云日志采集 */
    const record: Record<string, unknown> = {
      timestamp,
      level: levelLabel,
      tag,
      message,
    }

    /** 将链路字段提升为顶层字段，方便按 requestId/traceId 直接检索 */
    if (context?.requestId) record.requestId = context.requestId
    if (context?.traceId) record.traceId = context.traceId
    if (context?.agentId) record.agentId = context.agentId
    if (context?.sessionId) record.sessionId = context.sessionId
    if (context?.source) record.source = context.source

    /** 将业务传入的结构化对象合并为顶层字段；非对象值统一放进 extra 数组 */
    for (const arg of args) {
      if (arg === undefined || arg === null) continue
      if (typeof arg === 'object' && !Array.isArray(arg)) {
        Object.assign(record, arg)
      } else if (!record.extra) {
        record.extra = [arg]
      } else if (Array.isArray(record.extra)) {
        record.extra.push(arg)
      }
    }

    try {
      return JSON.stringify(record)
    } catch {
      /** 极端情况下结构化字段不可序列化时，仍然输出一条可被日志系统解析的 JSON 行 */
      return JSON.stringify({ timestamp, level: levelLabel, tag, message, serializeError: true })
    }
  }

  let line = `[${timestamp}] [${levelLabel}]`
  if (tag) line += ` [${tag}]`
  /** 文本模式保留原有人类可读格式，并追加链路字段辅助本地排查 */
  if (context?.requestId) line += ` [${context.requestId}]`
  if (context?.traceId) line += ` [trace:${context.traceId}]`
  line += ` ${message}`

  // 附加结构化数据
  if (args.length > 0) {
    for (const arg of args) {
      if (arg === undefined || arg === null) continue
      if (typeof arg === 'object') {
        try {
          line += ' ' + JSON.stringify(arg)
        } catch {
          line += ' [无法序列化]'
        }
      } else {
        line += ' ' + String(arg)
      }
    }
  }

  return line
}
