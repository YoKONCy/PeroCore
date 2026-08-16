import type { BuiltinTool } from '../index'
import { getProductivityRuntime, resolveExecutionSession } from '../productivityRuntimeHolder'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'
import { WorkspaceError } from '../../services/execution/virtualWorkspace'
import type { WorkspaceCheckpointService } from '../../services/workspace/workspaceCheckpointService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('WorkspaceProductivity')
let checkpointService: WorkspaceCheckpointService | null = null

/** 注入对话轮次文件检查点服务。 */
export function setWorkspaceProductivityCheckpointService(
  service: WorkspaceCheckpointService,
): void {
  checkpointService = service
}

export const readFileRangeTool: BuiltinTool = {
  name: 'read_file_range',
  async execute(args, ctx) {
    const session = await resolveExecutionSession(ctx)
    const result = await getProductivityRuntime().virtualWorkspace.read(
      session,
      String(args.path),
      {
        deviceScope: ctx.approvedOutsideWorkspace,
        offset: args.offset === undefined ? undefined : Number(args.offset),
        limit: args.limit === undefined ? undefined : Number(args.limit),
        lineStart: args.line_start === undefined ? undefined : Number(args.line_start),
        lineEnd: args.line_end === undefined ? undefined : Number(args.line_end),
        tailLines: args.tail_lines === undefined ? undefined : Number(args.tail_lines),
      },
    )
    return toolSuccess(JSON.stringify(result), { hash: result.hash, truncated: result.truncated })
  },
}

export const globFilesTool: BuiltinTool = {
  name: 'glob_files',
  async execute(args, ctx) {
    const session = await resolveExecutionSession(ctx)
    const files = await getProductivityRuntime().virtualWorkspace.glob(session, {
      pattern: String(args.pattern),
      deviceScope: ctx.approvedOutsideWorkspace,
      cwd: args.cwd ? String(args.cwd) : undefined,
      maxDepth: args.max_depth === undefined ? undefined : Number(args.max_depth),
      limit: args.limit === undefined ? undefined : Number(args.limit),
      includeHidden: Boolean(args.include_hidden),
    })
    return toolSuccess(JSON.stringify({ files, count: files.length }))
  },
}

export const editFileTool: BuiltinTool = {
  name: 'edit_file',
  async execute(args, ctx) {
    const session = await resolveExecutionSession(ctx)
    try {
      const captured = ctx.approvedOutsideWorkspace
        ? null
        : await checkpointService?.captureToolMutation(ctx, String(args.path))
      const result = await getProductivityRuntime().virtualWorkspace.edit(session, {
        path: String(args.path),
        oldText: String(args.old_text),
        newText: String(args.new_text),
        expectedHash: args.expected_hash ? String(args.expected_hash) : undefined,
        deviceScope: ctx.approvedOutsideWorkspace,
      })
      await checkpointService?.commitFromDisk(captured ?? null)
      return toolSuccess(JSON.stringify(result), result)
    } catch (err) {
      // 失败原因：既打印到后端日志，也结构化返回给 Agent 供其自我修正
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`编辑文件失败 [${ctx.agentId}/${ctx.threadId}] ${String(args.path)}: ${message}`)
      if (err instanceof WorkspaceError) {
        return toolFailure(err.code, message)
      }
      return toolFailure('EDIT_UNKNOWN', `编辑失败: ${message}`)
    }
  },
}
