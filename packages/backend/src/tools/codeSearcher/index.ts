/**
 * code_search — 安全代码搜索工具
 *
 * 优先使用 ripgrep JSON 输出，始终通过 spawn 参数数组执行且不启用 shell；
 * rg 不可用时降级为 Node 流式逐行搜索。
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import type { BuiltinTool } from '../index'
import { getWorkspaceService } from '../workspaceServiceHolder'
import { toolSuccess } from '../../services/execution/toolResult'

const MAX_RESULTS = 50
const SEARCH_TIMEOUT_MS = 15_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const require = createRequire(import.meta.url)

/** 单条匹配：文件路径 + 行号 + 列号（1-based）+ 该行内容 */
export interface CodeMatch {
  file: string
  line: number
  column?: number
  content: string
}

export const codeSearcherTool: BuiltinTool = {
  name: 'code_search',

  async execute(args, ctx) {
    const query = String(args.query ?? '')
    if (!query) throw new Error('query 不能为空')
    const isRegex = Boolean(args.is_regex)
    const fileType = args.file_type ? String(args.file_type) : undefined
    const workspaceService = getWorkspaceService()
    if (!workspaceService) throw new Error('WorkspaceService 尚未初始化')
    const searchPath = workspaceService.resolveDeviceReadPath(
      ctx.agentId,
      args.path ? String(args.path) : undefined,
    )

    const rg = await searchWithRipgrep({ query, isRegex, fileType, searchPath, signal: ctx.signal })
    // Node fallback 仅在 rg 不可用时执行
    const node = rg.available
      ? null
      : await searchWithNode({ query, isRegex, fileType, searchPath, signal: ctx.signal })
    const result = rg.available
      ? {
          matches: rg.matches,
          total: rg.matches.length,
          truncated: rg.truncated,
          engine: 'ripgrep',
        }
      : {
          matches: node!.matches,
          total: node!.matches.length,
          truncated: node!.truncated,
          engine: 'node-fallback',
        }
    result.total = result.matches.length
    return toolSuccess(JSON.stringify(result), {
      engine: result.engine,
      total: result.total,
      truncated: result.truncated,
    })
  },
}

export function resolveRipgrepPath(): string {
  const executable = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const resourcesRoot = process.env.INFOS_RESOURCES_ROOT
  if (resourcesRoot) {
    const bundled = path.join(
      resourcesRoot,
      'bin',
      `${process.platform}-${process.arch}`,
      executable,
    )
    if (existsSync(bundled)) return bundled
  }
  // 开发环境优先复用 @vscode/ripgrep 当前平台包。
  try {
    const module = require('@vscode/ripgrep') as { rgPath?: string }
    if (module.rgPath && existsSync(module.rgPath)) return module.rgPath
  } catch {
    /* 依赖未安装时继续回退系统 PATH。 */
  }
  return 'rg'
}

async function searchWithRipgrep(input: {
  query: string
  isRegex: boolean
  fileType?: string
  searchPath: string
  signal?: AbortSignal
}): Promise<{ available: boolean; matches: CodeMatch[]; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const rgArgs = ['--json', '-n', '-I', '--max-columns', '300']
    if (!input.isRegex) rgArgs.push('-F')
    if (input.fileType) rgArgs.push('-t', input.fileType)
    rgArgs.push('--', input.query, input.searchPath)
    const rgCommand = resolveRipgrepPath()
    const child = spawn(rgCommand, rgArgs, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const matches: CodeMatch[] = []
    let stdout = ''
    let stderr = ''
    let unavailable = false
    // 达到结果上限被截断时标记，避免 Agent 误以为已拿到全量结果
    let truncated = false
    const timer = setTimeout(() => child.kill(), SEARCH_TIMEOUT_MS)
    const abort = () => child.kill()
    input.signal?.addEventListener('abort', abort, { once: true })

    child.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') unavailable = true
      else reject(error)
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      let newline = stdout.indexOf('\n')
      while (newline >= 0) {
        parseRgLine(stdout.slice(0, newline), matches)
        stdout = stdout.slice(newline + 1)
        if (matches.length >= MAX_RESULTS) {
          child.kill()
          truncated = true
        }
        newline = stdout.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      if (unavailable) {
        resolve({ available: false, matches: [], truncated: false })
        return
      }
      if (input.signal?.aborted) {
        reject(new Error('代码搜索已取消'))
        return
      }
      parseRgLine(stdout, matches)
      // rg: 0=有匹配，1=无匹配；主动达到结果上限后的非零退出也视为成功。
      if (code !== 0 && code !== 1 && matches.length < MAX_RESULTS) {
        reject(new Error(`ripgrep 执行失败 (exitCode=${code}): ${stderr.trim()}`))
        return
      }
      resolve({ available: true, matches: matches.slice(0, MAX_RESULTS), truncated })
    })
  })
}

function parseRgLine(line: string, matches: CodeMatch[]): void {
  if (!line.trim() || matches.length >= MAX_RESULTS) return
  try {
    const event = JSON.parse(line) as {
      type?: string
      data?: {
        path?: { text?: string }
        line_number?: number
        lines?: { text?: string }
        submatches?: Array<{ start?: number }>
      }
    }
    if (event.type === 'match') {
      const rawLine = event.data?.lines?.text ?? ''
      const submatch = event.data?.submatches?.[0]
      matches.push({
        file: event.data?.path?.text ?? '',
        line: event.data?.line_number ?? 0,
        // rg 的 start 为 1-based 字节偏移，转为 UTF-8 字符列号
        column:
          submatch?.start !== undefined ? byteOffsetToColumn(rawLine, submatch.start) : undefined,
        content: rawLine.trimEnd(),
      })
    }
  } catch {
    /* 忽略非 JSON 诊断行。 */
  }
}

/** 把 rg 输出的 1-based 字节偏移转成该行的 UTF-8 字符列号（1-based） */
function byteOffsetToColumn(line: string, byteStart: number): number {
  const bytes = Buffer.from(line, 'utf8')
  const prefix = bytes.subarray(0, Math.max(0, byteStart - 1)).toString('utf8')
  return Array.from(prefix).length + 1
}

async function searchWithNode(input: {
  query: string
  isRegex: boolean
  fileType?: string
  searchPath: string
  signal?: AbortSignal
}): Promise<{ matches: CodeMatch[]; truncated: boolean }> {
  const matches: CodeMatch[] = []
  const matcher = createMatcher(input.query, input.isRegex)
  const extensions = fileTypeExtensions(input.fileType)

  const walk = async (directory: string): Promise<void> => {
    if (matches.length >= MAX_RESULTS) return
    if (input.signal?.aborted) throw new Error('代码搜索已取消')
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (matches.length >= MAX_RESULTS) return
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.'))
        continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) continue
      const info = await stat(absolute)
      if (info.size > MAX_FILE_BYTES) continue
      await searchFile(absolute, input.searchPath, matcher, matches, input.signal)
    }
  }
  await walk(input.searchPath)
  return { matches, truncated: matches.length >= MAX_RESULTS }
}

async function searchFile(
  filePath: string,
  root: string,
  matcher: (line: string) => number | null,
  output: CodeMatch[],
  signal?: AbortSignal,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of lines) {
      if (signal?.aborted) throw new Error('代码搜索已取消')
      lineNumber += 1
      // matcher 返回首个匹配的 0-based 字符索引，null 表示本行无匹配
      const matchIndex = matcher(line)
      if (matchIndex !== null) {
        output.push({
          file: path.relative(root, filePath),
          line: lineNumber,
          column: matchIndex + 1,
          content: line.slice(0, 300),
        })
        if (output.length >= MAX_RESULTS) break
      }
    }
  } finally {
    lines.close()
    stream.destroy()
  }
}

/** 行匹配器：返回首个匹配的 0-based 字符索引（null 表示未命中） */
function createMatcher(query: string, isRegex: boolean): (line: string) => number | null {
  if (!isRegex) {
    return (line) => {
      const index = line.indexOf(query)
      return index >= 0 ? index : null
    }
  }
  let regex: RegExp
  try {
    regex = new RegExp(query)
  } catch (error) {
    throw new Error(`正则表达式无效: ${error instanceof Error ? error.message : String(error)}`)
  }
  return (line) => {
    regex.lastIndex = 0
    const match = regex.exec(line)
    return match ? match.index : null
  }
}

export const __codeSearchInternals = {
  searchWithRipgrep,
  searchWithNode,
  createMatcher,
  fileTypeExtensions,
}

function fileTypeExtensions(fileType?: string): Set<string> | null {
  if (!fileType) return null
  const map: Record<string, string[]> = {
    ts: ['.ts', '.tsx'],
    js: ['.js', '.jsx', '.mjs', '.cjs'],
    py: ['.py'],
    rust: ['.rs'],
    go: ['.go'],
    java: ['.java'],
    json: ['.json'],
    vue: ['.vue'],
    css: ['.css', '.scss', '.less'],
    markdown: ['.md'],
    html: ['.html', '.htm'],
  }
  return new Set(map[fileType.toLowerCase()] ?? [`.${fileType.toLowerCase()}`])
}
