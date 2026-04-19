/**
 * search_files — 文件搜索工具
 *
 * 按文件名搜索文件。
 * Windows: 优先使用 Everything (es.exe)，速度瞬间
 * 跨平台/降级: 使用 fd 或 Node.js 递归搜索
 *
 * @module packages/backend/src/tools/fileSearch
 */

import { exec } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { BuiltinTool } from '../index'

const MAX_RESULTS = 50
const SEARCH_TIMEOUT_MS = 15_000

export const fileSearchTool: BuiltinTool = {
  definition: {
    name: 'search_files',
    description: '按文件名搜索文件。在整台计算机上查找文件位置。(要搜索文件内容，请用 code_search)',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '文件名关键词 (支持通配符)' },
        limit: { type: 'number', description: '返回最大结果数 (默认 50)' },
      },
      required: ['query'],
    },
  },

  async execute(args) {
    const query = args.query as string
    const limit = (args.limit as number) ?? MAX_RESULTS

    // Windows: 尝试 Everything (es.exe)
    if (process.platform === 'win32') {
      const esResult = await tryEverythingSearch(query, limit)
      if (esResult !== null) return JSON.stringify(esResult)
    }

    // 跨平台: 尝试 fd
    const fdResult = await tryFdSearch(query, limit)
    if (fdResult !== null) return JSON.stringify(fdResult)

    // 最终降级: Node.js 递归搜索 (仅用户主目录)
    const fallbackResults = nodeFallbackSearch(query, os.homedir(), limit)
    return JSON.stringify(fallbackResults)
  },
}

/** 使用 Everything (es.exe) 搜索 — 仅 Windows */
async function tryEverythingSearch(query: string, limit: number): Promise<string[] | null> {
  return new Promise((resolve) => {
    const cmd = `es "${query}" -n ${limit} -utf8`
    exec(cmd, { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
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
    })
  })
}

/** 使用 fd 搜索 — 全平台 */
async function tryFdSearch(query: string, limit: number): Promise<string[] | null> {
  return new Promise((resolve) => {
    const cmd = `fd "${query}" --max-results ${limit} --no-ignore`
    exec(cmd, { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
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
    })
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
