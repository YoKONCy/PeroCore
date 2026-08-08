/**
 * WorkspaceService 共享持有器
 *
 * AIOS(Phase4): fileOps/index.ts 已有自己的 setWorkspaceService（核心逻辑锁定不改），
 * 但 terminalExecutor / runScript / fileSearch / codeSearcher 也需要 WorkspaceService。
 * 为避免重复定义和多次注入，本模块作为这些工具的共享注入点。
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
 * 在 container.ts 启动时调用一次（与 fileOps 的 setWorkspaceService 并行调用）。
 */
export function setWorkspaceService(service: WorkspaceService): void {
  workspaceService = service
  logger.info('WorkspaceService 已注入 (共享持有器)')
}

/** 获取 WorkspaceService，未注入时返回 null */
export function getWorkspaceService(): WorkspaceService | null {
  return workspaceService
}

/** 获取 WorkspaceService，未注入时抛错 */
export function requireWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    throw new Error('WorkspaceService 未注入，工具不可用')
  }
  return workspaceService
}
