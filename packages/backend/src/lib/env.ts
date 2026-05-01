/**
 * 环境变量与运行时配置
 *
 * 提供路径工厂函数和服务器配置常量，
 * 路径禁止硬编码。
 *
 * @module packages/backend/src/lib/env
 */

import path from 'node:path'
import os from 'node:os'

// ─────────────────────────────────────────────
// 路径工厂
// ─────────────────────────────────────────────

/** 应用数据根目录 */
export function getDataDir(): string {
  return process.env.PERO_DATA_DIR ?? path.join(os.homedir(), '.perocore')
}

/** 数据库文件路径 */
export function getDatabasePath(): string {
  return process.env.PERO_DATABASE_PATH ?? path.join(getDataDir(), 'perocore.db')
}

/** TriviumDB 存储目录 */
export function getTriviumDir(): string {
  return path.join(getDataDir(), 'trivium')
}

/** 扩展目录 */
export function getExtensionsDir(): string {
  return process.env.PERO_EXTENSIONS_DIR ?? path.join(getDataDir(), 'extensions')
}

/** MDP 提示词目录 */
export function getPromptsDir(): string {
  return path.join(getDataDir(), 'prompts')
}

// ─────────────────────────────────────────────
// 服务器配置
// ─────────────────────────────────────────────

/** 服务器监听端口 (默认 9120) */
export const SERVER_PORT = Number(process.env.PERO_PORT ?? 9120)

/** 服务器监听地址 */
export const SERVER_HOST = process.env.PERO_HOST ?? '127.0.0.1'

// ─────────────────────────────────────────────
// 日志配置
// ─────────────────────────────────────────────

/**
 * 日志级别 (consola level)
 * - 0: fatal, 1: error, 2: warn, 3: info, 4: debug, 5: trace
 * - 环境变量 PERO_LOG_LEVEL 优先，否则生产 info(3) / 开发 debug(4)
 */
export const LOG_LEVEL = Number(
  process.env.PERO_LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 3 : 4),
)

/** 日志输出格式：text 适合本地阅读，json 适合日志采集 */
export const LOG_FORMAT = process.env.PERO_LOG_FORMAT === 'json' ? 'json' : 'text'
