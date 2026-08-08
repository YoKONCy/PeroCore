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
import { createLogger } from '../../lib/logger'

const logger = createLogger('FileOps')

/** WorkspaceService 实例（由 container.ts 通过 setWorkspaceService 注入） */
let workspaceService: WorkspaceService | null = null

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

export const readFileTool: BuiltinTool = {
  name: 'read_file',

  async execute(args, ctx) {
    const filePath = args.file_path as string
    const maxLength = (args.max_length as number) ?? 10_000

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
      // AIOS(Phase4): write 始终走 containment 检查（所有 channel 都限 workspace）
      await service.write(ctx.agentId, filePath, content, ctx.channel, { append })
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
      const entries = await service.list(ctx.agentId, dirPath, ctx.channel)

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
