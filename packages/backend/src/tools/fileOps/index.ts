/**
 * file_ops — 文件操作工具
 *
 * 提供文件读写、信息查询能力。
 * Node.js 原生 fs 实现，完全跨平台。
 *
 * @module packages/backend/src/tools/fileOps
 */

import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { BuiltinTool } from '../index'

/** 单文件最大读取字节 (10MB) */
const MAX_READ_SIZE = 10 * 1024 * 1024

export const readFileTool: BuiltinTool = {
  name: 'read_file',

  async execute(args) {
    const filePath = args.file_path as string
    const maxLength = (args.max_length as number) ?? 10_000

    if (!existsSync(filePath)) {
      return JSON.stringify({ error: `文件不存在: ${filePath}` })
    }

    const stat = statSync(filePath)
    if (!stat.isFile()) {
      return JSON.stringify({ error: `路径不是文件: ${filePath}` })
    }
    if (stat.size > MAX_READ_SIZE) {
      return JSON.stringify({ error: `文件过大 (${stat.size} bytes)，上限 10MB` })
    }

    // 尝试 UTF-8，失败后尝试 latin1
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      content = readFileSync(filePath, 'latin1')
    }

    const truncated = content.length > maxLength
    return truncated ? content.slice(0, maxLength) + '\n...[内容已截断]...' : content
  },
}

export const writeFileTool: BuiltinTool = {
  name: 'write_file',

  async execute(args) {
    const filePath = args.file_path as string
    const content = args.content as string
    const append = (args.append as boolean) ?? false

    try {
      // 确保目录存在
      const dir = path.dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      if (append) {
        const { appendFileSync } = await import('node:fs')
        appendFileSync(filePath, content, 'utf-8')
      } else {
        writeFileSync(filePath, content, 'utf-8')
      }

      return JSON.stringify({ success: true, path: filePath, bytes: Buffer.byteLength(content) })
    } catch (err) {
      return JSON.stringify({
        error: `写入失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const fileInfoTool: BuiltinTool = {
  name: 'get_file_info',

  async execute(args) {
    const filePath = args.file_path as string

    if (!existsSync(filePath)) {
      return JSON.stringify({ error: `路径不存在: ${filePath}` })
    }

    const stat = statSync(filePath)
    return JSON.stringify({
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      created: stat.birthtime.toISOString(),
      modified: stat.mtime.toISOString(),
    })
  },
}

export const listDirectoryTool: BuiltinTool = {
  name: 'list_directory',

  async execute(args) {
    const dirPath = args.dir_path as string

    if (!existsSync(dirPath)) {
      return JSON.stringify({ error: `目录不存在: ${dirPath}` })
    }

    const stat = statSync(dirPath)
    if (!stat.isDirectory()) {
      return JSON.stringify({ error: `路径不是目录: ${dirPath}` })
    }

    const { readdirSync } = await import('node:fs')
    const entries = readdirSync(dirPath, { withFileTypes: true })
    const items = entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
      path: path.join(dirPath, e.name),
    }))

    return JSON.stringify(items)
  },
}
