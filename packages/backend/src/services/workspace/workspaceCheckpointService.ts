/**
 * workspaceCheckpointService — 领域服务
 *
 * 封装本领域的核心职责与外部依赖，向上层提供可预测的调用契约。
 * 非直观的状态转换、失败恢复与安全边界应在本模块内完成，避免泄漏实现细节。
 */
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { readFile, rm, stat } from 'node:fs/promises'
import type {
  FileSnapshotRepository,
  FileChangeOperation,
} from '../../repositories/fileSnapshot.repo'
import type { ToolContext } from '../agent/toolRegistry'
import type { LocalWorkspaceService } from '../workspace/workspaceService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('WorkspaceCheckpoint')

export interface SnapshotContext {
  agentId: string
  threadId?: string
  pairId?: string
  callId?: string
  channel?: string
  taskId?: string
}

export interface RewindFilePreview {
  path: string
  action:
    | 'delete_created'
    | 'restore_edited'
    | 'restore_deleted'
    | 'restore_renamed'
    | 'preserve_changed'
}

export interface RewindPreview {
  threadId: string
  wholeThread: boolean
  targetMessageId?: number
  pairIds: string[]
  pairCount: number
  createdCount: number
  editedCount: number
  preservedCount: number
  files: RewindFilePreview[]
  forceWarning: boolean
}

export interface RewindRollbackResult {
  files: RewindFilePreview[]
  rolledBackCount: number
  preservedCount: number
}

/**
 * 对话轮次级工作区检查点服务。
 * 首期捕获文本创建/编辑/覆盖；数据模型预留删除与重命名回滚。
 */
export class WorkspaceCheckpointService {
  constructor(
    private readonly repo: FileSnapshotRepository,
    private readonly workspace: LocalWorkspaceService,
  ) {}

  /** 将工具执行上下文转换为快照上下文，显式映射 toolCallId → callId。 */
  async captureToolMutation(context: ToolContext, filePath: string) {
    return this.captureBefore(
      {
        agentId: context.agentId,
        threadId: context.threadId,
        pairId: context.pairId,
        callId: context.toolCallId,
        channel: context.channel,
        taskId: context.taskId,
      },
      filePath,
    )
  }

  /** 在文件工具写入前读取原状态；无轮次上下文的调用不创建伪快照。 */
  async captureBefore(context: SnapshotContext, filePath: string) {
    if (!context.threadId || !context.pairId || !context.callId || context.taskId) {
      if (!context.taskId) {
        logger.warn(
          `跳过文件快照：缺少轮次上下文 (thread=${context.threadId ?? '-'}, pair=${context.pairId ?? '-'}, call=${context.callId ?? '-'})`,
        )
      }
      return null
    }
    const check = this.workspace.validatePath(
      context.agentId,
      filePath,
      'write',
      context.channel ?? 'desktop',
    )
    if (!check.allowed) throw new Error(check.reason ?? `文件路径不允许写入: ${filePath}`)
    const resolved = check.resolvedPath
    const info = await stat(resolved).catch(() => null)
    if (!info) {
      return {
        context,
        filePath: this.normalizeRelative(context.agentId, resolved),
        operation: 'create' as const,
        originalContent: undefined,
        originalSha256: undefined,
      }
    }
    if (!info.isFile()) throw new Error(`快照目标不是普通文件: ${filePath}`)
    const originalContent = await readFile(resolved, 'utf8')
    return {
      context,
      filePath: this.normalizeRelative(context.agentId, resolved),
      operation: 'modify' as const,
      originalContent,
      originalSha256: this.sha256(originalContent),
    }
  }

  /** 写入成功后持久化快照；失败的工具调用不产生记录。 */
  async commit(
    captured: Awaited<ReturnType<WorkspaceCheckpointService['captureBefore']>>,
    finalContent: string,
  ): Promise<void> {
    if (!captured) return
    await this.repo.upsert({
      id: `fs_${randomUUID()}`,
      threadId: captured.context.threadId!,
      pairId: captured.context.pairId!,
      callId: captured.context.callId!,
      filePath: captured.filePath,
      operation: captured.operation,
      originalContent: captured.originalContent,
      originalSha256: captured.originalSha256,
      finalSha256: this.sha256(finalContent),
    })
  }

  /** 写入成功后从磁盘读取最终内容并提交，适用于 edit/append 等无法直接获得完整新文本的工具。 */
  async commitFromDisk(
    captured: Awaited<ReturnType<WorkspaceCheckpointService['captureBefore']>>,
  ): Promise<void> {
    if (!captured) return
    const resolved = this.workspace.resolve(captured.context.agentId, captured.filePath)
    const finalContent = await readFile(resolved, 'utf8')
    await this.commit(captured, finalContent)
  }

  /** 为删除/重命名工具预留统一登记入口。 */
  async recordReserved(input: {
    context: Required<Pick<SnapshotContext, 'threadId' | 'pairId' | 'callId'>>
    filePath: string
    operation: Extract<FileChangeOperation, 'delete' | 'rename'>
    renameTargetPath?: string
    originalContent: string
  }): Promise<void> {
    await this.repo.upsert({
      id: `fs_${randomUUID()}`,
      threadId: input.context.threadId,
      pairId: input.context.pairId,
      callId: input.context.callId,
      filePath: input.filePath,
      operation: input.operation,
      renameTargetPath: input.renameTargetPath,
      originalContent: input.originalContent,
      originalSha256: this.sha256(input.originalContent),
    })
  }

  async previewPair(threadId: string, messageId: number): Promise<RewindPreview | null> {
    const target = await this.repo.getRewindTarget(threadId, messageId)
    if (!target?.timestamp) return null
    const pairIds = await this.repo.listPairIdsFrom(threadId, {
      timestamp: target.timestamp,
      id: target.id,
    })
    const pairCount = await this.repo.countPairsFrom(threadId, {
      timestamp: target.timestamp,
      id: target.id,
    })
    return this.buildPreview(threadId, pairIds, false, target.id, pairCount)
  }

  async previewThread(threadId: string): Promise<RewindPreview | null> {
    const agentId = await this.repo.getThreadAgent(threadId)
    if (!agentId) return null
    const pairIds = await this.repo.listAllPairIds(threadId)
    return this.buildPreview(threadId, pairIds, true)
  }

  /**
   * 按时间逆序回滚；如果文件已偏离 Agent 最终写入状态，则保留当前内容并跳过该路径的整条回滚链。
   */
  async rollback(preview: RewindPreview): Promise<RewindRollbackResult> {
    const agentId = await this.repo.getThreadAgent(preview.threadId)
    if (!agentId) throw new Error('会话不存在或已删除')

    const allSnapshots = await this.repo.listSnapshots(preview.pairIds)
    const latestByPath = new Map<string, (typeof allSnapshots)[number]>()
    for (const snapshot of allSnapshots) {
      if (!latestByPath.has(snapshot.filePath)) latestByPath.set(snapshot.filePath, snapshot)
    }

    const preservedPaths = new Set<string>()
    for (const [filePath, snapshot] of latestByPath) {
      if (!(await this.matchesAgentFinalState(agentId, snapshot))) preservedPaths.add(filePath)
    }

    // pairIds 由 Repository 按时间正序返回；显式逆序逐轮恢复，保证 A/B/C/D 撤回 B 时严格执行 D→C→B。
    for (const pairId of [...preview.pairIds].reverse()) {
      const snapshots = await this.repo.listSnapshots([pairId])
      for (const snapshot of snapshots) {
        if (preservedPaths.has(snapshot.filePath)) continue
        const target = this.workspace.resolve(agentId, snapshot.filePath)
        switch (snapshot.operation) {
          case 'create':
            await rm(target, { force: true })
            break
          case 'modify':
          case 'delete':
            await this.workspace.write(
              agentId,
              snapshot.filePath,
              snapshot.originalContent ?? '',
              'desktop',
            )
            break
          case 'rename': {
            if (snapshot.renameTargetPath) {
              await rm(this.workspace.resolve(agentId, snapshot.renameTargetPath), { force: true })
            }
            await this.workspace.write(
              agentId,
              snapshot.filePath,
              snapshot.originalContent ?? '',
              'desktop',
            )
            break
          }
          default:
            logger.warn(`忽略未知快照操作: ${snapshot.operation}`)
        }
      }
    }

    const files = await this.describeFiles(agentId, allSnapshots, preservedPaths)
    return {
      files,
      rolledBackCount: files.filter((file) => file.action !== 'preserve_changed').length,
      preservedCount: preservedPaths.size,
    }
  }

  async deletePairs(preview: RewindPreview, deletedBy = 'user') {
    if (!preview.targetMessageId) throw new Error('轮次回滚缺少目标消息 ID')
    return this.repo.softDeleteFromMessage(preview.threadId, preview.targetMessageId, deletedBy)
  }

  private async buildPreview(
    threadId: string,
    pairIds: string[],
    wholeThread: boolean,
    targetMessageId?: number,
    pairCountOverride?: number,
  ): Promise<RewindPreview> {
    const snapshots = await this.repo.listSnapshots(pairIds)
    const agentId = await this.repo.getThreadAgent(threadId)
    const latestByPath = new Map<string, (typeof snapshots)[number]>()
    for (const snapshot of snapshots) {
      if (!latestByPath.has(snapshot.filePath)) latestByPath.set(snapshot.filePath, snapshot)
    }
    const preservedPaths = new Set<string>()
    if (agentId) {
      for (const [filePath, snapshot] of latestByPath) {
        if (!(await this.matchesAgentFinalState(agentId, snapshot))) preservedPaths.add(filePath)
      }
    }
    const list = await this.describeFiles(agentId, snapshots, preservedPaths)
    return {
      threadId,
      wholeThread,
      targetMessageId,
      pairIds,
      pairCount: pairCountOverride ?? pairIds.length,
      createdCount: list.filter((file) => file.action === 'delete_created').length,
      editedCount: list.filter(
        (file) => file.action !== 'delete_created' && file.action !== 'preserve_changed',
      ).length,
      preservedCount: list.filter((file) => file.action === 'preserve_changed').length,
      files: list,
      forceWarning: list.some((file) => file.action !== 'preserve_changed'),
    }
  }

  private async matchesAgentFinalState(
    agentId: string,
    snapshot: { filePath: string; operation: string; finalSha256: string | null },
  ): Promise<boolean> {
    const resolved = this.workspace.resolve(agentId, snapshot.filePath)
    const info = await stat(resolved).catch(() => null)
    // 删除快照的 Agent 最终状态就是文件不存在。
    if (snapshot.operation === 'delete') return info === null
    if (!snapshot.finalSha256 || !info?.isFile()) return false
    const content = await readFile(resolved, 'utf8').catch(() => null)
    return content !== null && this.sha256(content) === snapshot.finalSha256
  }

  private async describeFiles(
    _agentId: string | null,
    snapshots: Array<{ filePath: string; operation: string }>,
    preservedPaths: Set<string>,
  ): Promise<RewindFilePreview[]> {
    // 同一文件跨轮次多次修改时只显示一次；listSnapshots 已按最新快照优先排序。
    const files = new Map<string, RewindFilePreview>()
    for (const snapshot of snapshots) {
      if (files.has(snapshot.filePath)) continue
      if (preservedPaths.has(snapshot.filePath)) {
        files.set(snapshot.filePath, { path: snapshot.filePath, action: 'preserve_changed' })
        continue
      }
      const action: RewindFilePreview['action'] =
        snapshot.operation === 'create'
          ? 'delete_created'
          : snapshot.operation === 'delete'
            ? 'restore_deleted'
            : snapshot.operation === 'rename'
              ? 'restore_renamed'
              : 'restore_edited'
      files.set(snapshot.filePath, { path: snapshot.filePath, action })
    }
    return [...files.values()]
  }

  private normalizeRelative(agentId: string, resolved: string): string {
    return path.relative(this.workspace.getWorkspaceRoot(agentId), resolved).replaceAll('\\', '/')
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }
}
