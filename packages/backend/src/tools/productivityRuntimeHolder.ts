/**
 * productivityRuntimeHolder — Agent 工具边界
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import path from 'node:path'
import type { ExecutionSessionManager } from '../services/execution/executionSession'
import type { TerminalManager } from '../services/execution/terminalManager'
import type { WorkspaceService } from '../services/workspace/workspaceService'
import type { VirtualWorkspace } from '../services/execution/virtualWorkspace'
import type { ApprovalService } from '../services/execution/approvalService'

export interface ProductivityRuntime {
  sessions: ExecutionSessionManager
  terminals: TerminalManager
  workspace: WorkspaceService
  virtualWorkspace: VirtualWorkspace
  approvalService: ApprovalService
}

let runtime: ProductivityRuntime | null = null

export function setProductivityRuntime(next: ProductivityRuntime): void {
  runtime = next
}

export function clearProductivityRuntime(): void {
  runtime = null
}

export function getProductivityRuntime(): ProductivityRuntime {
  if (!runtime) throw new Error('生产力执行运行时尚未初始化')
  return runtime
}

export async function disposeTaskExecution(taskId: string): Promise<void> {
  const current = getProductivityRuntime()
  const session = current.sessions.findByOwner({ taskId })
  if (!session) return
  current.sessions.markClosing(session.id)
  await current.terminals.disposeSession(session.id)
  current.approvalService.clearSession(session.threadId ?? session.id)
  current.sessions.close(session.id)
}

/** 按当前工具上下文获取或创建执行会话。 */
export async function resolveExecutionSession(ctx: {
  agentId: string
  threadId: string
  channel: string
  taskId?: string
}) {
  const current = getProductivityRuntime()
  const principalRoot = current.workspace.getWorkspaceRoot(ctx.agentId)
  const workspaceRoot = ctx.taskId
    ? path.join(path.dirname(principalRoot), 'tasks', ctx.taskId, 'workspace')
    : principalRoot
  return current.sessions.getOrCreate({
    ownerAgentId: ctx.agentId,
    threadId: ctx.threadId,
    taskId: ctx.taskId,
    channel: ctx.channel,
    workspaceRoot,
  })
}
