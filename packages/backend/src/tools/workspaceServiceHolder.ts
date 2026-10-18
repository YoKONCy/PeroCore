/**
 * WorkspaceService 共享持有器
 *
 * 终端和脚本工具仍需 WorkspaceService 提供 Principal Workspace 根目录。
 * 文件读写与搜索工具通过 ProductivityRuntime 共享 VirtualWorkspace。
 *
 * container.ts 启动时调用 setWorkspaceService 注入实例，
 * 各工具通过 requireWorkspaceService 获取。
 *
 * @module packages/backend/src/tools/workspaceServiceHolder
 */

import type { WorkspaceService } from '../services/workspace/workspaceService'
import { createLogger } from '../lib/logger'

const logger = createLogger('WorkspaceServiceHolder')

/** WorkspaceService 实例（由 container.ts 通过 setWorkspaceService 注入） */
let workspaceService: WorkspaceService | null = null

/**
 * 注入 WorkspaceService
 *
 * 在 container.ts 启动时调用一次。
 */
export function setWorkspaceService(service: WorkspaceService): void {
  workspaceService = service
  logger.info('WorkspaceService 已注入 (共享持有器)')
}

/** 获取 WorkspaceService，未注入时返回 null */
export function getWorkspaceService(): WorkspaceService | null {
  return workspaceService
}
