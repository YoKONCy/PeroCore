/**
 * cleanup — TTS 临时文件 + 过期临时文件清理
 *
 * `periodic_cleanup`: 清理 TTS 音频缓存、临时视觉文件等。
 * 仅负责 @temp 目录下过期文件的清理 (跨平台安全)。
 *
 * 周期: 每小时
 *
 * @see lifecycle/cron
 * @module packages/backend/src/lifecycle/cron/cleanup
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { createLogger } from '../../lib/logger'

const logger = createLogger('CronCleanup')

/** 文件过期阈值 (默认 24 小时) */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 需要清理的子目录列表 */
const CLEANUP_SUBDIRS = ['tts_cache', 'asr_temp', 'vision_temp', 'uploads']

/**
 * 清理临时文件
 *
 * @param tempDir - @temp 基础目录 (从 PathResolver 获取)
 * @param maxAgeMs - 文件过期时间 (默认 24h)
 */
export async function runCleanup(tempDir: string, maxAgeMs = MAX_AGE_MS): Promise<CleanupResult> {
  const result: CleanupResult = { scanned: 0, deleted: 0, freedBytes: 0, errors: 0 }
  const cutoff = Date.now() - maxAgeMs

  for (const subdir of CLEANUP_SUBDIRS) {
    const dir = path.join(tempDir, subdir)
    try {
      await cleanDirectory(dir, cutoff, result)
    } catch (err) {
      // 目录不存在等情况，静默跳过
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`清理目录失败: ${dir} — ${err}`)
        result.errors++
      }
    }
  }

  if (result.deleted > 0) {
    const mbFreed = (result.freedBytes / 1024 / 1024).toFixed(1)
    logger.info(
      `临时文件清理完成: 删除 ${result.deleted}/${result.scanned} 文件, 释放 ${mbFreed}MB`,
    )
  }

  return result
}

// ── 内部 ──

async function cleanDirectory(dir: string, cutoff: number, result: CleanupResult): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile()) continue
    result.scanned++

    const filePath = path.join(dir, entry.name)
    try {
      const stat = await fs.stat(filePath)
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(filePath)
        result.deleted++
        result.freedBytes += stat.size
      }
    } catch (err) {
      logger.debug(`文件清理失败: ${filePath} — ${err}`)
      result.errors++
    }
  }
}

/** 清理结果 */
export interface CleanupResult {
  scanned: number
  deleted: number
  freedBytes: number
  errors: number
}
