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
  action: 'delete_created' | 'restore_edited' | 'restore_deleted' | 'restore_renamed'
}

export interface RewindPreview {
  threadId: string
  wholeThread: boolean
  targetMessageId?: number
  pairIds: string[]
  pairCount: number
  createdCount: number
  editedCount: number
  files: RewindFilePreview[]
  forceWarning: boolean
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

  /** 强制按时间逆序回滚，符合产品已确认的 checkpoint rewind 语义。 */
  async rollback(preview: RewindPreview): Promise<void> {
    const agentId = await this.repo.getThreadAgent(preview.threadId)
    if (!agentId) throw new Error('会话不存在或已删除')
    // pairIds 由 Repository 按时间正序返回；显式逆序逐轮恢复，保证 A/B/C/D 撤回 B 时严格执行 D→C→B。
    for (const pairId of [...preview.pairIds].reverse()) {
      const snapshots = await this.repo.listSnapshots([pairId])
      for (const snapshot of snapshots) {
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
    // 同一文件跨轮次多次修改时，预览只显示一次，但实际回滚仍按快照逆序执行。
    const files = new Map<string, RewindFilePreview>()
    for (const snapshot of snapshots) {
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
    const list = [...files.values()]
    return {
      threadId,
      wholeThread,
      targetMessageId,
      pairIds,
      pairCount: pairCountOverride ?? pairIds.length,
      createdCount: list.filter((file) => file.action === 'delete_created').length,
      editedCount: list.filter((file) => file.action !== 'delete_created').length,
      files: list,
      forceWarning: list.length > 0,
    }
  }

  private normalizeRelative(agentId: string, resolved: string): string {
    return path.relative(this.workspace.getWorkspaceRoot(agentId), resolved).replaceAll('\\', '/')
  }

  private sha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
  }
}
