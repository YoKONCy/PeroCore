/**
 * search_files — 文件搜索工具
 *
 * 按文件名搜索文件。
 * Windows: 优先使用 Everything (es.exe)，速度瞬间
 * 跨平台/降级: 使用 fd 或 Node.js 递归搜索
 *
 * AIOS(Phase4): 搜索目录默认为 workspace，按 channel 分级控制：
 * - desktop 通道（策略 authorized）：args.directory 提供且目录存在时使用之，否则回退 workspace root
 * - 其他通道（策略 workspace）：强制使用 workspace root，忽略 args.directory
 * 搜索算法（Everything → fd → Node.js 回退）保持不变，仅搜索目录受 containment 约束。
 *
 * @module packages/backend/src/tools/fileSearch
 */

import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import type { BuiltinTool } from '../index'
import { getWorkspaceService } from '../workspaceServiceHolder'

const MAX_RESULTS = 50
const SEARCH_TIMEOUT_MS = 15_000

export const fileSearchTool: BuiltinTool = {
  name: 'search_files',

  async execute(args, ctx) {
    const query = args.query as string
    const limit = (args.limit as number) ?? MAX_RESULTS

    // 纯只读搜索默认从Agent工作区开始；用户可显式指定任意本机现有目录。
    const workspaceService = getWorkspaceService()
    if (!workspaceService) throw new Error('WorkspaceService 尚未初始化')
    const searchDir = workspaceService.resolveDeviceReadPath(
      ctx.agentId,
      args.directory ? String(args.directory) : undefined,
    )

    // Windows: 尝试 Everything (es.exe)
    if (process.platform === 'win32') {
      const esResult = await tryEverythingSearch(query, searchDir, limit)
      if (esResult !== null) return JSON.stringify(esResult)
    }

    // 跨平台: 尝试 fd
    const fdResult = await tryFdSearch(query, searchDir, limit)
    if (fdResult !== null) return JSON.stringify(fdResult)

    // 最终降级: Node.js 递归搜索 (限定在 searchDir)
    const fallbackResults = nodeFallbackSearch(query, searchDir, limit)
    return JSON.stringify(fallbackResults)
  },
}

/** 使用 Everything (es.exe) 搜索 — 仅 Windows */
async function tryEverythingSearch(
  query: string,
  searchDir: string,
  limit: number,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'es',
      [query, '-path', searchDir, '-n', String(limit), '-utf8'],
      {
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve(null) // es.exe 不可用，降级
          return
        }
        const results = stdout
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
        resolve(results.slice(0, limit))
      },
    )
  })
}

/** 使用 fd 搜索 — 全平台 */
async function tryFdSearch(
  query: string,
  searchDir: string,
  limit: number,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'fd',
      [query, searchDir, '--max-results', String(limit), '--no-ignore'],
      {
        timeout: SEARCH_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        const results = stdout
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
        resolve(results.slice(0, limit))
      },
    )
  })
}

/** Node.js 回退搜索 (简易递归，有深度/数量限制) */
function nodeFallbackSearch(query: string, rootDir: string, limit: number): string[] {
  const results: string[] = []
  const lowerQuery = query.toLowerCase()
  const maxDepth = 5

  function walk(dir: string, depth: number) {
    if (depth > maxDepth || results.length >= limit) return
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (results.length >= limit) break
        if (entry.startsWith('.') || entry === 'node_modules') continue

        const fullPath = path.join(dir, entry)
        if (entry.toLowerCase().includes(lowerQuery)) {
          results.push(fullPath)
        }

        try {
          if (statSync(fullPath).isDirectory()) {
            walk(fullPath, depth + 1)
          }
        } catch {
          // 权限不足，跳过
        }
      }
    } catch {
      // 跳过
    }
  }

  walk(rootDir, 0)
  return results
}
