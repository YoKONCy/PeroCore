/**
 * @file 主进程日志器
 * @description 同时输出到控制台和文件，支持日志轮转
 * @platform ELECTRON
 * @module electron/main/utils/logger
 */

import fs from 'node:fs'
import path from 'node:path'
import { paths } from './env'

// 确保日志目录存在
function ensureLogDir(): void {
  try {
    if (!fs.existsSync(paths.logs)) {
      fs.mkdirSync(paths.logs, { recursive: true })
    }
  } catch {
    // 静默失败，控制台输出仍可用
  }
}

/** 获取当前日期字符串 YYYY-MM-DD */
function getDateStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取当前时间字符串 HH:mm:ss.SSS */
function getTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

/** 当前日志文件流（按天轮转） */
let currentDate = ''
let logStream: fs.WriteStream | null = null

function getLogStream(): fs.WriteStream | null {
  const today = getDateStr()
  if (today !== currentDate) {
    // 日志轮转
    logStream?.end()
    currentDate = today
    ensureLogDir()
    try {
      const logFile = path.join(paths.logs, `perocore-${today}.log`)
      logStream = fs.createWriteStream(logFile, { flags: 'a' })
    } catch {
      logStream = null
    }
  }
  return logStream
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'

function write(level: LogLevel, tag: string, message: string): void {
  const time = getTimeStr()
  const line = `[${time}] [${level}] [${tag}] ${message}`

  // 控制台输出
  switch (level) {
    case 'ERROR':
      console.error(line)
      break
    case 'WARN':
      console.warn(line)
      break
    case 'DEBUG':
      console.debug(line)
      break
    default:
      console.log(line)
  }

  // 文件写入
  const stream = getLogStream()
  stream?.write(line + '\n')
}

/** 主进程日志器 */
export const logger = {
  info: (tag: string, message: string) => write('INFO', tag, message),
  warn: (tag: string, message: string) => write('WARN', tag, message),
  error: (tag: string, message: string) => write('ERROR', tag, message),
  debug: (tag: string, message: string) => write('DEBUG', tag, message),

  /** 关闭日志流 (退出时调用) */
  close: () => {
    logStream?.end()
    logStream = null
  },
}
