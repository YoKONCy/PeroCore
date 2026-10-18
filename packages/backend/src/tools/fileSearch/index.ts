/**
 * search_files — 文件搜索工具
 *
 * 按文件名搜索文件。
 * Windows: 优先使用 Everything (es.exe)，速度瞬间
 * 跨平台/降级: 使用 fd 或 Node.js 递归搜索
 *
 * 搜索目录默认为当前 ExecutionSession 的 Workspace；设备只读权限允许显式指定本机目录。
 * 搜索算法（Everything → fd → Node.js 回退）保持不变，搜索根统一由 VirtualWorkspace 校验。
 *
 * @module packages/backend/src/tools/fileSearch
 */

import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { BuiltinTool } from '../index'
import { getProductivityRuntime, resolveExecutionSession } from '../productivityRuntimeHolder'
import { toolSuccess } from '../../services/execution/toolResult'

const MAX_RESULTS = 50
const MAX_RESULT_LIMIT = 200
const SEARCH_TIMEOUT_MS = 15_000

export const fileSearchTool: BuiltinTool = {
  name: 'search_files',

  async execute(args, ctx) {
    const query = String(args.query ?? '').trim()
    if (!query) throw new Error('文件名关键词不能为空')
    const requestedLimit = args.limit === undefined ? MAX_RESULTS : Number(args.limit)
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1)
      throw new Error('文件搜索结果上限必须是正整数')
    const limit = Math.min(requestedLimit, MAX_RESULT_LIMIT)
    // 多取一项以确认是否截断，不把返回上限误报为全部命中数。
    const probeLimit = limit + 1

    // 纯只读搜索默认从Agent工作区开始；用户可显式指定任意本机现有目录。
    const session = await resolveExecutionSession(ctx)
    const searchDir = await getProductivityRuntime().virtualWorkspace.resolveDirectory(
      session,
      args.directory ? String(args.directory) : '.',
      { deviceScope: ctx.deviceReadScope },
    )

    // Windows: 尝试 Everything (es.exe)
    if (process.platform === 'win32') {
      const esResult = await tryEverythingSearch(query, searchDir, probeLimit)
      if (esResult !== null) return searchResult(esResult, limit, 'everything')
    }

    // 跨平台: 尝试 fd
    const fdResult = await tryFdSearch(query, searchDir, probeLimit)
    if (fdResult !== null) return searchResult(fdResult, limit, 'fd')

    // 最终降级: Node.js 递归搜索 (限定在 searchDir)
    const fallbackResults = nodeFallbackSearch(query, searchDir, probeLimit)
    return searchResult(fallbackResults, limit, 'node-fallback')
  },
}

/** 文件与目录分别统计，避免把同名文件夹计入文件数。 */
async function searchResult(paths: string[], limit: number, engine: string) {
  const entries = await Promise.all(
    [...new Set(paths)].map(async (filePath) => {
      try {
        const info = await stat(filePath)
        return info.isFile()
          ? { path: filePath, kind: 'file' }
          : info.isDirectory()
            ? { path: filePath, kind: 'directory' }
            : null
      } catch {
        // 搜索索引可能滞后，已不存在或无法读取的条目不计入结果。
        return null
      }
    }),
  )
  const available = entries.filter((entry) => entry !== null)
  const selected = available.slice(0, limit)
  const files = selected.filter((entry) => entry.kind === 'file').map((entry) => entry.path)
  const directories = selected
    .filter((entry) => entry.kind === 'directory')
    .map((entry) => entry.path)
  const summary = {
    count: files.length,
    directoryCount: directories.length,
    truncated: paths.length > limit,
    engine,
  }
  return toolSuccess(JSON.stringify({ ...summary, files, directories }), summary)
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
