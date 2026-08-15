/**
 * file_ops — 文件操作工具
 *
 * AIOS(Phase4): 改造为通过 WorkspaceService 执行文件操作，
 * 按 channel 分级控制访问范围：
 * - desktop: read 全局可读，write 限 workspace
 * - companion/social/group: 读写都限 workspace
 *
 * @module packages/backend/src/tools/fileOps
 */

import type { BuiltinTool } from '../index'
import type { WorkspaceService } from '../../services/workspace/workspaceService'
import type { WorkspaceCheckpointService } from '../../services/workspace/workspaceCheckpointService'
import { createLogger } from '../../lib/logger'
import { diffLines } from '../../services/execution/virtualWorkspace'

const logger = createLogger('FileOps')

/** WorkspaceService 实例（由 container.ts 通过 setWorkspaceService 注入） */
let workspaceService: WorkspaceService | null = null
let checkpointService: WorkspaceCheckpointService | null = null

/** 注入对话轮次文件检查点服务。 */
export function setWorkspaceCheckpointService(service: WorkspaceCheckpointService): void {
  checkpointService = service
}

/**
 * 注入 WorkspaceService
 *
 * 在 container.ts 启动时调用一次。
 */
export function setWorkspaceService(service: WorkspaceService): void {
  workspaceService = service
  logger.info('WorkspaceService 已注入')
}

/** 获取 WorkspaceService，未注入时抛错 */
function requireWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    throw new Error('WorkspaceService 未注入，文件工具不可用')
  }
  return workspaceService
}

export interface ToolDiffPreviewRow {
  kind: 'context' | 'remove' | 'add'
  oldLine?: number
  newLine?: number
  text: string
}

/**
 * 生成可持久化的有限行级 Diff 预览。
 * 总增删数由完整文本计算，预览最多保留 80 行，避免工具审计重新保存整份文件正文。
 */
export function buildToolDiff(oldText: string, newText: string, limit = 80) {
  /** 空文件为 0 行；末尾换行只表示行终止，不额外制造一条虚假空行。 */
  const toLines = (text: string) => {
    if (!text) return []
    const lines = text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    return lines
  }
  const oldLines = toLines(oldText)
  const newLines = toLines(newText)
  const stats = !oldText
    ? { insertions: newLines.length, deletions: 0, approximate: undefined }
    : !newText
      ? { insertions: 0, deletions: oldLines.length, approximate: undefined }
      : diffLines(oldText, newText)
  let prefix = 0
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix += 1
  let suffix = 0
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  )
    suffix += 1

  const rows: ToolDiffPreviewRow[] = []
  for (let index = Math.max(0, prefix - 2); index < prefix; index += 1) {
    rows.push({
      kind: 'context',
      oldLine: index + 1,
      newLine: index + 1,
      text: oldLines[index] ?? '',
    })
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    rows.push({ kind: 'remove', oldLine: index + 1, text: oldLines[index] ?? '' })
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    rows.push({ kind: 'add', newLine: index + 1, text: newLines[index] ?? '' })
  }
  const suffixStart = oldLines.length - suffix
  for (let index = suffixStart; index < Math.min(oldLines.length, suffixStart + 2); index += 1) {
    rows.push({
      kind: 'context',
      oldLine: index + 1,
      newLine: newLines.length - suffix + (index - suffixStart) + 1,
      text: oldLines[index] ?? '',
    })
  }
  return {
    insertions: stats.insertions,
    deletions: stats.deletions,
    approximate: stats.approximate,
    diffPreview: rows.slice(0, limit).map((row) => ({
      ...row,
      text: row.text.length > 500 ? `${row.text.slice(0, 500)}…` : row.text,
    })),
    diffTruncated: rows.length > limit,
  }
}

export const readFileTool: BuiltinTool = {
  name: 'read_file',

  async execute(args, ctx) {
    const filePath = args.file_path as string
    const maxLength = args.max_length === undefined ? undefined : Number(args.max_length)

    try {
      const service = requireWorkspaceService()
      // AIOS(Phase4): 按 channel 分级 containment 检查
      const content = await service.read(ctx.agentId, filePath, ctx.channel, { maxLength })
      return content
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}

export const writeFileTool: BuiltinTool = {
  name: 'write_file',

  async execute(args, ctx) {
    const filePath = args.file_path as string
    const content = args.content as string
    const append = (args.append as boolean) ?? false

    try {
      const service = requireWorkspaceService()
      const captured = ctx.approvedOutsideWorkspace
        ? null
        : await checkpointService?.captureToolMutation(ctx, filePath)
      // 写入前先读取元信息，向前端明确报告 create/overwrite/append，便于工作区自动打开新文件。
      const before = await service.stat(ctx.agentId, filePath, ctx.channel, {
        deviceScope: ctx.approvedOutsideWorkspace,
      })
      // 写入前读取旧正文用于计算 UI Diff；旧正文仅在本次工具执行内存中存在。
      // 无法读取（新文件/超大文件/编码问题）时降级为空文本，不阻断真实写入。
      const oldContent = before.exists
        ? await service
            .read(ctx.agentId, filePath, ctx.channel, {
              maxLength: 10_000_000,
              deviceScope: ctx.approvedOutsideWorkspace,
            })
            .catch(() => '')
        : ''
      // AIOS(Phase4): write 始终走 containment 检查（所有 channel 都限 workspace）
      await service.write(ctx.agentId, filePath, content, ctx.channel, {
        append,
        deviceScope: ctx.approvedOutsideWorkspace,
      })
      await checkpointService?.commitFromDisk(captured ?? null)
      const operation = append ? 'append' : before.exists ? 'overwrite' : 'create'
      const finalContent = append ? `${oldContent}${content}` : content
      const diff = buildToolDiff(oldContent, finalContent)
      return JSON.stringify({
        success: true,
        path: filePath,
        operation,
        bytes: Buffer.byteLength(content),
        ...diff,
      })
    } catch (err) {
      return JSON.stringify({
        error: `写入失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const fileInfoTool: BuiltinTool = {
  name: 'get_file_info',

  async execute(args, ctx) {
    const filePath = args.file_path as string

    try {
      const service = requireWorkspaceService()
      // AIOS(Phase4): stat 走 read 权限（info 不修改文件）
      const stat = await service.stat(ctx.agentId, filePath, ctx.channel)

      if (!stat.exists) {
        return JSON.stringify({ error: `路径不存在: ${filePath}` })
      }

      return JSON.stringify({
        size: stat.size,
        isDirectory: stat.isDirectory,
        modified: stat.modifiedAt?.toISOString() ?? null,
      })
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}

export const listDirectoryTool: BuiltinTool = {
  name: 'list_directory',

  async execute(args, ctx) {
    const dirPath = args.dir_path as string

    try {
      const service = requireWorkspaceService()
      // AIOS(Phase4): list 走 read 权限
      const entries = await service.list(ctx.agentId, dirPath, ctx.channel, { deviceScope: true })

      const items = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory ? 'directory' : 'file',
        size: e.size,
      }))

      return JSON.stringify(items)
    } catch (err) {
      return JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },
}
