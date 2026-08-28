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
import fs from 'node:fs'

const PORTABLE_MARKER = '.portable'

/**
 * 从启动入口向上查找便携版标记。
 * Daemon 通常由 node.exe 执行，不能只依赖 process.execPath，因此同时检查
 * 启动脚本路径；最多回溯到打包目录根部，避免误命中无关的上级目录。
 */
function findPortableRoot(startPath: string | undefined): string | undefined {
  if (!startPath) return undefined

  let current = path.resolve(startPath)
  try {
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current)
  } catch {
    current = path.dirname(current)
  }

  for (let depth = 0; depth < 6; depth += 1) {
    if (fs.existsSync(path.join(current, PORTABLE_MARKER))) return current
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

/** 解析便携版根目录；显式环境变量优先于标记检测。 */
export function getPortableRoot(): string | undefined {
  if (process.env.PERO_PORTABLE_ROOT) return path.resolve(process.env.PERO_PORTABLE_ROOT)

  const candidates = [
    process.env.PERO_EXECUTABLE_DIR,
    process.argv[1],
    path.dirname(process.execPath),
  ]
  for (const candidate of candidates) {
    const root = findPortableRoot(candidate)
    if (root) return root
  }
  return undefined
}

// ─────────────────────────────────────────────
// 路径工厂
// ─────────────────────────────────────────────

function normalizePhysicalDirectory(value: string, variableName: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${variableName} 不能为空`)
  if (/^@(app|data|temp|workshop|principal)(?:[\\/]|$)/i.test(trimmed)) {
    throw new Error(`${variableName} 必须是物理路径，不能使用逻辑路径别名: ${trimmed}`)
  }
  return path.resolve(trimmed)
}

/**
 * 应用数据根目录。
 * 优先级：PERO_DATA_DIR > 便携版根目录/data > ~/.infos。
 */
export function getDataDir(): string {
  if (process.env.PERO_DATA_DIR) {
    return normalizePhysicalDirectory(process.env.PERO_DATA_DIR, 'PERO_DATA_DIR')
  }

  const portableRoot = getPortableRoot()
  return path.resolve(
    portableRoot ? path.join(portableRoot, 'data') : path.join(os.homedir(), '.infos'),
  )
}

/** 数据库文件路径 */
export function getDatabasePath(): string {
  return process.env.PERO_DATABASE_PATH ?? path.join(getDataDir(), 'infos.db')
}

/** TriviumDB 存储目录 */
export function getTriviumDir(): string {
  return path.join(getDataDir(), 'trivium')
}

/** Package 安装目录。 */
export function getPackagesDir(): string {
  return process.env.PERO_PACKAGES_DIR
    ? normalizePhysicalDirectory(process.env.PERO_PACKAGES_DIR, 'PERO_PACKAGES_DIR')
    : path.join(getDataDir(), 'packages')
}

/**
 * Workshop 订阅物品根目录列表。
 * Electron 使用 JSON 注入多个 installInfo.folder；手动部署也兼容 path.delimiter 分隔。
 */
export function getWorkshopDirs(): string[] {
  const json = process.env.PERO_WORKSHOP_DIRS
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown
      if (Array.isArray(parsed)) {
        return [
          ...new Set(
            parsed
              .filter((item): item is string => typeof item === 'string' && item.length > 0)
              .map((item) => path.resolve(item)),
          ),
        ]
      }
    } catch {
      // 非 JSON 时继续按平台路径分隔符解析。
    }
    return [
      ...new Set(
        json
          .split(path.delimiter)
          .filter(Boolean)
          .map((item) => path.resolve(item)),
      ),
    ]
  }

  const legacy = process.env.PERO_WORKSHOP_DIR
  return legacy ? [path.resolve(legacy)] : []
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
