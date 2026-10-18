/**
 * file_ops — 文件操作工具
 *
 * 与工作区编辑器共用 ExecutionSession / VirtualWorkspace 的路径、版本和原子写入语义。
 * 设备只读由工具权限标记控制，工作区外写入仍需本次审批或自动执行授权。
 *
 * @module packages/backend/src/tools/fileOps
 */

import type { BuiltinTool } from '../index'
import type { WorkspaceCheckpointService } from '../../services/workspace/workspaceCheckpointService'
import { diffLines } from '../../services/execution/virtualWorkspace'
import { getProductivityRuntime, resolveExecutionSession } from '../productivityRuntimeHolder'
import { toolSuccess } from '../../services/execution/toolResult'
import { createReadReference, fileEditOwner } from '../../services/execution/fileEditing'

export { readImageTool, setImageReadResourceService } from './readImage'

let checkpointService: WorkspaceCheckpointService | null = null

/** 注入对话轮次文件检查点服务。 */
export function setWorkspaceCheckpointService(service: WorkspaceCheckpointService): void {
  checkpointService = service
}

export interface ToolDiffPreviewRow {
  kind: 'context' | 'remove' | 'add'
  oldLine?: number
  newLine?: number
  text: string
}

/**
 * 生成完整行级 Diff，行数与单行长度不再截断；前端按可视窗口渲染。
 */
export function buildToolDiff(oldText: string, newText: string) {
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
    diffPreview: rows,
    diffTruncated: false,
  }
}

export const readFileTool: BuiltinTool = {
  name: 'read_file',

  async execute(args, ctx) {
    const filePath = args.file_path as string
    const maxLength = args.max_length === undefined ? undefined : Number(args.max_length)

    try {
      if (maxLength !== undefined && (!Number.isFinite(maxLength) || maxLength <= 0)) {
        throw new Error('max_length 必须是正数')
      }
      const session = await resolveExecutionSession(ctx)
      const workspace = getProductivityRuntime().virtualWorkspace
      const sourceRef = await workspace.resolveReadablePath(session, filePath, ctx.deviceReadScope)
      const result = await workspace.read(session, filePath, {
        deviceScope: ctx.deviceReadScope,
        ...(maxLength === undefined
          ? { lineStart: 1, lineEnd: 800 }
          : { limit: Math.max(1, Math.min(Math.trunc(maxLength), 128_000)) }),
      })
      const readRef = createReadReference(fileEditOwner(session, ctx.realmId), sourceRef, result)
      return toolSuccess(
        `${result.truncated ? `${result.content}\n...[内容已截断]...` : result.content}\n【读取引用】read_ref=${readRef ?? '无可编辑内容'}；hash=${result.hash}`,
        {
          hash: result.hash,
          sourceRef,
          lineStart: result.lineStart,
          lineEnd: result.lineEnd,
          truncated: result.truncated,
          readRef,
        },
      )
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
      const session = await resolveExecutionSession(ctx)
      const workspace = getProductivityRuntime().virtualWorkspace
      let beforeExists = false
      let oldRead: Awaited<ReturnType<typeof workspace.read>> | null = null
      const result = await workspace.write(session, {
        path: filePath,
        content,
        append,
        signal: ctx.signal,
        deviceScope: ctx.approvedOutsideWorkspace,
        expectedHash: args.expected_hash ? String(args.expected_hash) : undefined,
        beforeWrite: async () => {
          ctx.signal?.throwIfAborted()
          beforeExists = (await workspace.fileInfo(session, filePath, ctx.approvedOutsideWorkspace))
            .exists
          oldRead = beforeExists
            ? await workspace
                .read(session, filePath, {
                  limit: 128_000,
                  deviceScope: ctx.approvedOutsideWorkspace,
                })
                .catch(() => null)
            : null
          return ctx.approvedOutsideWorkspace
            ? null
            : await checkpointService?.captureToolMutation(ctx, filePath)
        },
        afterWrite: async (captured, written) =>
          checkpointService?.commitFromDisk(
            captured as Awaited<ReturnType<WorkspaceCheckpointService['captureBefore']>>,
            written,
          ),
      })
      const previousRead = oldRead as Awaited<ReturnType<typeof workspace.read>> | null
      const previewIncomplete = beforeExists && (!previousRead || previousRead.truncated)
      const diff = previewIncomplete
        ? { diffPreview: [], diffTruncated: true }
        : buildToolDiff(
            previousRead?.content ?? '',
            append ? `${previousRead?.content ?? ''}${content}` : content,
          )
      return JSON.stringify({
        success: true,
        path: filePath,
        operation: result.operation,
        bytes: Buffer.byteLength(content),
        ...diff,
        insertions: result.insertions,
        deletions: result.deletions,
        oldHash: result.oldHash,
        newHash: result.newHash,
        checkpointWarning: result.checkpointWarning,
        sourceRef: await workspace.resolveReadablePath(
          session,
          filePath,
          ctx.approvedOutsideWorkspace,
        ),
      })
    } catch (err) {
      return JSON.stringify({
        error: `写入失败: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  },
}

export const deleteFileTool: BuiltinTool = {
  name: 'delete_file',

  async execute(args, ctx) {
    if (!ctx.approvedSensitiveAction) throw new Error('删除文件缺少本次用户审批凭证')
    const filePath = String(args.file_path ?? '').trim()
    if (!filePath) throw new Error('file_path 不能为空')

    const session = await resolveExecutionSession(ctx)
    await getProductivityRuntime().virtualWorkspace.deleteFile(
      session,
      filePath,
      ctx.approvedOutsideWorkspace,
    )
    return JSON.stringify({ success: true, path: filePath })
  },
}

export const fileInfoTool: BuiltinTool = {
  name: 'get_file_info',

  async execute(args, ctx) {
    const filePath = args.file_path as string

    try {
      const session = await resolveExecutionSession(ctx)
      const stat = await getProductivityRuntime().virtualWorkspace.fileInfo(
        session,
        filePath,
        ctx.deviceReadScope,
      )

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
      const session = await resolveExecutionSession(ctx)
      const entries = await getProductivityRuntime().virtualWorkspace.listDirectory(
        session,
        dirPath,
        ctx.deviceReadScope,
      )

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
