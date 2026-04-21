/**
 * 健康检查与日志查询路由
 *
 * 提供运维级别的可观测性端点:
 * - GET /api/health       — 健康检查 (Docker HEALTHCHECK / PM2 监控)
 * - GET /api/health/logs  — 日志文件列表查询
 * - GET /api/health/logs/:filename — 日志文件内容查询
 *
 * @module packages/backend/src/routers/health.router
 */

import { Hono } from 'hono'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { getLogFileTransport } from '../lib/logger'
import { SERVER_PORT } from '../lib/env'

/** 创建健康检查路由 */
export function createHealthRouter() {
  const router = new Hono()

  // ── GET /api/health — 健康检查 ──
  router.get('/', (c) => {
    const uptime = process.uptime()
    const mem = process.memoryUsage()

    return c.json({
      code: 'OK',
      message: '成功',
      data: {
        status: 'ok',
        version: '0.9.0',
        uptime: Math.round(uptime),
        uptimeHuman: formatUptime(uptime),
        port: SERVER_PORT,
        platform: process.platform,
        nodeVersion: process.version,
        memory: {
          rss: formatBytes(mem.rss),
          heapUsed: formatBytes(mem.heapUsed),
          heapTotal: formatBytes(mem.heapTotal),
          external: formatBytes(mem.external),
        },
        timestamp: new Date().toISOString(),
      },
    })
  })

  // ── GET /api/health/logs — 日志文件列表 ──
  router.get('/logs', (c) => {
    const transport = getLogFileTransport()
    if (!transport) {
      return c.json({
        code: 'LOG_FILE_NOT_ENABLED',
        message: '日志文件持久化未启用',
        files: [],
      })
    }

    const logDir = transport.getLogDir()

    try {
      const files = readdirSync(logDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => {
          const filePath = path.join(logDir, f)
          const stat = statSync(filePath)
          return {
            name: f,
            size: formatBytes(stat.size),
            sizeBytes: stat.size,
            modified: stat.mtime.toISOString(),
          }
        })
        .sort((a, b) => b.modified.localeCompare(a.modified))

      return c.json({
        logDir,
        currentFile: path.basename(transport.getLogPath()),
        files,
      })
    } catch (err) {
      return c.json({ code: 'LOG_READ_ERROR', message: '读取日志目录失败' }, 500)
    }
  })

  // ── GET /api/health/logs/:filename — 日志文件内容 ──
  router.get('/logs/:filename', (c) => {
    const transport = getLogFileTransport()
    if (!transport) {
      return c.json({ code: 'LOG_FILE_NOT_ENABLED', message: '日志文件持久化未启用' }, 400)
    }

    const logDir = transport.getLogDir()
    const filename = c.req.param('filename')

    // 安全检查：防止路径遍历
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return c.json({ code: 'INVALID_FILENAME', message: '非法文件名' }, 400)
    }

    const filePath = path.join(logDir, filename)

    // 确保文件在日志目录内
    if (!filePath.startsWith(logDir)) {
      return c.json({ code: 'INVALID_FILENAME', message: '非法文件路径' }, 400)
    }

    try {
      const stat = statSync(filePath)
      const lines = c.req.query('lines')
      const tail = lines ? parseInt(lines, 10) : 200

      const content = readFileSync(filePath, 'utf-8')
      const allLines = content.split('\n').filter(Boolean)

      // 默认返回最后 N 行（tail 模式）
      const outputLines = tail > 0 ? allLines.slice(-tail) : allLines

      return c.json({
        filename,
        size: formatBytes(stat.size),
        totalLines: allLines.length,
        returnedLines: outputLines.length,
        lines: outputLines,
      })
    } catch {
      return c.json({ code: 'FILE_NOT_FOUND', message: `日志文件不存在: ${filename}` }, 404)
    }
  })

  return router
}

// ── 工具函数 ──

/** 格式化字节数 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 格式化运行时长 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}天`)
  if (h > 0) parts.push(`${h}时`)
  if (m > 0) parts.push(`${m}分`)
  parts.push(`${s}秒`)
  return parts.join('')
}
