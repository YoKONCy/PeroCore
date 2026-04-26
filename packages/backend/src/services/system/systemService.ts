/**
 * 系统信息服务
 *
 * 收集 CPU、内存、存储等运行时指标。
 * Router 层禁止包含业务逻辑，此 Service 承载所有系统信息采集。
 *
 * 三层架构：Service 层 — 负责业务逻辑编排，禁止直接构造 HTTP 响应。
 *
 * @module packages/backend/src/services/system/systemService
 */

import { spawn } from 'node:child_process'
import { statSync, readdirSync } from 'node:fs'
import { join, relative, resolve, isAbsolute } from 'node:path'
import os from 'node:os'
import type { PathResolver } from '../../core/pathResolver'
import { AppError } from '../../lib/appError'
import { getDatabasePath, getTriviumDir } from '../../lib/env'

/** 系统信息快照 */
export interface SystemSnapshot {
  /** Node.js 进程 CPU 使用率 (0-100) */
  cpuPercent: number
  /** 进程 RSS 内存 (MB) */
  memoryUsedMB: number
  /** 进程堆内存 (MB) */
  heapUsedMB: number
  /** 系统总内存 (MB) */
  totalMemoryMB: number
  /** SQLite 数据库文件大小 (MB) */
  sqliteSizeMB: number
  /** TriviumDB 目录总大小 (MB) */
  triviumSizeMB: number
}

export class SystemService {
  constructor(private pathResolver: PathResolver) {}

  async openPath(targetPath: string): Promise<void> {
    const normalizedPath = this.normalizeOpenTarget(targetPath)

    const platform = process.platform
    const command =
      platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open'
    const child = spawn(command, [normalizedPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })

    child.unref()
  }

  private normalizeOpenTarget(targetPath: string): string {
    const trimmedPath = targetPath?.trim()
    if (!trimmedPath) {
      throw new AppError('MISSING_FIELD', {
        message: '缺少 path 参数',
        data: { field: 'path' },
      })
    }

    const resolvedPath = resolve(this.pathResolver.resolve(trimmedPath))
    if (!this.isAllowedOpenPath(resolvedPath)) {
      throw new AppError('FORBIDDEN', {
        message: '目标路径不在允许访问范围内',
        data: { field: 'path' },
      })
    }

    return resolvedPath
  }

  private isAllowedOpenPath(targetPath: string): boolean {
    const allowedPrefixes = ['@app', '@data', '@temp', '@workshop'] as const

    return allowedPrefixes.some((prefix) => {
      const rootPath = this.pathResolver.getRoot(prefix)
      if (!rootPath) {
        return false
      }

      const resolvedRoot = resolve(rootPath)
      const relativePath = relative(resolvedRoot, targetPath)
      return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
    })
  }

  /**
   * 采集系统快照
   *
   * 包含 CPU 使用率（100ms 采样）、内存、存储等指标。
   */
  async getSnapshot(): Promise<SystemSnapshot> {
    // ── CPU 使用率 (采样 100ms) ──
    const cpuStart = process.cpuUsage()
    const hrStart = process.hrtime.bigint()
    await new Promise((r) => setTimeout(r, 100))
    const cpuEnd = process.cpuUsage(cpuStart)
    const hrElapsed = Number(process.hrtime.bigint() - hrStart) / 1e3 // 微秒
    const cpuPercent =
      hrElapsed > 0
        ? Math.min(100, Math.round(((cpuEnd.user + cpuEnd.system) / hrElapsed) * 100))
        : 0

    // ── 内存 ──
    const mem = process.memoryUsage()
    const memoryUsedMB = Math.round(mem.rss / 1024 / 1024)
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024)
    const totalMemoryMB = Math.round(os.totalmem() / 1024 / 1024)

    // ── 存储 ──
    const sqliteSizeMB = this.fileSizeMB(getDatabasePath())
    const triviumSizeMB = this.dirSizeMB(getTriviumDir())

    return {
      cpuPercent,
      memoryUsedMB,
      heapUsedMB,
      totalMemoryMB,
      sqliteSizeMB,
      triviumSizeMB,
    }
  }

  /** 获取文件大小 (MB)，失败返回 0 */
  private fileSizeMB(filePath: string): number {
    try {
      return Math.round((statSync(filePath).size / 1024 / 1024) * 100) / 100
    } catch {
      return 0
    }
  }

  /** 递归计算目录总大小 (MB) */
  private dirSizeMB(dirPath: string): number {
    let totalBytes = 0
    try {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name)
        if (entry.isFile()) {
          totalBytes += statSync(fullPath).size
        } else if (entry.isDirectory()) {
          // 递归：子目录返回的是 MB，需要转回字节再累加
          totalBytes += this.dirSizeMB(fullPath) * 1024 * 1024
        }
      }
    } catch {
      // 目录不存在时静默返回 0
    }
    return Math.round((totalBytes / 1024 / 1024) * 100) / 100
  }
}
