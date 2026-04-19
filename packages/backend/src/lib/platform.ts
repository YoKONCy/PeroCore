/**
 * 平台检测与运行时环境常量
 *
 * 提供操作系统、运行时和部署形态检测常量。
 * 后端服务根据这些常量选择平台特化策略 (11_CROSS_PLATFORM.md §3.1)。
 *
 * @module packages/backend/src/lib/platform
 */

import os from 'node:os'

// ─────────────────────────────────────────────
// 操作系统检测
// ─────────────────────────────────────────────

/** 当前操作系统平台 */
export type Platform = 'windows' | 'linux' | 'darwin' | 'unknown'

/** 获取当前操作系统平台 */
export function getPlatform(): Platform {
  const p = os.platform()
  if (p === 'win32') return 'windows'
  if (p === 'linux') return 'linux'
  if (p === 'darwin') return 'darwin'
  return 'unknown'
}

/** 是否运行在 Windows */
export const IS_WINDOWS = os.platform() === 'win32'

/** 是否运行在 Linux */
export const IS_LINUX = os.platform() === 'linux'

/** 是否运行在 macOS */
export const IS_DARWIN = os.platform() === 'darwin'

// ─────────────────────────────────────────────
// 运行时环境检测
// ─────────────────────────────────────────────

/** 是否运行在 Electron 环境 */
export const IS_ELECTRON = typeof process !== 'undefined' && !!process.versions?.electron

/** 是否运行在 Docker 容器中 */
export const IS_DOCKER = !!process.env.PERO_DOCKER
