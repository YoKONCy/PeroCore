import { randomUUID } from 'node:crypto'
import type { ApplicationTaskPort } from '@infos/node-sdk'
import type { ConfigRepository } from '../repositories/config.repo'
import { createAgentApplicationTaskPort } from '../applications/applicationTaskPort'
import type {
  BackgroundTaskInfo,
  BackgroundTaskService,
} from '../services/task/backgroundTaskService'
import type { ArcaCapabilityRuntime } from './arcaCapabilityRuntime'

export type ArcaCollaborationStatus =
  | 'queued'
  | 'working'
  | 'awaiting_review'
  | 'committed'
  | 'rejected'
  | 'failed'
  | 'cancelled'

interface ArcaTaskMetadata {
  kind: 'arca.collaboration'
  documentId: string
  baseRevisionId: string
  scope: 'selection' | 'section' | 'document'
  nodeId?: string
  requirements?: string
  existingChangeSetIds: string[]
}

interface ChangeSetSummary {
  changeSetId: string
  actorPrincipalId: string
  status: string
  createdAt: string
}

export interface ArcaCollaborationTask {
  taskId: string
  documentId: string
  baseRevisionId: string
  instruction: string
  scope: ArcaTaskMetadata['scope']
  nodeId?: string
  agentId: string
  status: ArcaCollaborationStatus
  progress: number | null
  stage: string | null
  changeSetId?: string
  error?: string
  createdAt: string
  updatedAt: string
}

/** 将Arca协作请求适配到统一后台任务，并以ChangeSet作为唯一成功产物。 */
export class ArcaCollaborationService {
  private readonly taskPort: ApplicationTaskPort

  constructor(
    private readonly tasks: BackgroundTaskService,
    private readonly arca: ArcaCapabilityRuntime,
    private readonly config: ConfigRepository,
  ) {
    this.taskPort = createAgentApplicationTaskPort({
      appId: 'infos.arca',
      instanceId: 'managed',
      scheduler: tasks,
    })
  }

  available(): boolean {
    return this.arca.available()
  }

  async create(input: {
    documentId: string
    instruction: string
    scope: ArcaTaskMetadata['scope']
    nodeId?: string
    agentId: string
    requirements?: string
  }): Promise<ArcaCollaborationTask> {
    const snapshot = await this.arca.invoke<{
      revisionId: string
      nodes: Array<{ nodeId: string }>
    }>('document.inspect', { documentId: input.documentId })
    if (input.scope !== 'document' && !input.nodeId) {
      throw new Error('ARCA_COLLABORATION_NODE_REQUIRED: 当前范围需要语义节点')
    }
    if (input.nodeId && !snapshot.nodes.some((node) => node.nodeId === input.nodeId)) {
      throw new Error('ARCA_COLLABORATION_NODE_NOT_FOUND: 语义节点不存在')
    }
    const existing = await this.arca.invoke<ChangeSetSummary[]>('document.changeset.list', {
      documentId: input.documentId,
    })
    const metadata: ArcaTaskMetadata = {
      kind: 'arca.collaboration',
      documentId: input.documentId,
      baseRevisionId: snapshot.revisionId,
      scope: input.scope,
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.requirements?.trim() ? { requirements: input.requirements.trim() } : {}),
      existingChangeSetIds: existing.map((changeSet) => changeSet.changeSetId),
    }
    const configuredModelId = Number(await this.config.get('arca.modelConfigId'))
    const accepted = await this.taskPort.submit({
      operation: 'arca.collaboration',
      idempotencyKey: randomUUID(),
      correlationId: `arca:${input.documentId}:${Date.now()}`,
      input: {
        agentId: input.agentId,
        title: `Arca协作：${input.instruction.slice(0, 24)}`,
        instruction: this.buildInstruction(input, metadata),
        metadata: {
          ...metadata,
          ...(Number.isInteger(configuredModelId) && configuredModelId > 0
            ? { modelConfigId: configuredModelId }
            : {}),
        },
      },
    })
    const task = await this.tasks.getTask(accepted.taskId)
    if (!task) throw new Error('ARCA_COLLABORATION_TASK_NOT_FOUND')
    return this.project(task)
  }

  async list(documentId: string): Promise<ArcaCollaborationTask[]> {
    const page = await this.tasks.query({ page: 1, pageSize: 100 })
    const matching = page.items.filter((task) => {
      const metadata = task.metadata as Partial<ArcaTaskMetadata>
      return metadata.kind === 'arca.collaboration' && metadata.documentId === documentId
    })
    return Promise.all(matching.map((task) => this.project(task)))
  }

  async get(taskId: string): Promise<ArcaCollaborationTask | null> {
    const task = await this.tasks.getTask(taskId)
    if (!task || task.metadata.kind !== 'arca.collaboration') return null
    return this.project(task)
  }

  async cancel(taskId: string): Promise<ArcaCollaborationTask> {
    const task = await this.tasks.getTask(taskId)
    if (!task || task.metadata.kind !== 'arca.collaboration') {
      throw new Error('ARCA_COLLABORATION_TASK_NOT_FOUND')
    }
    return this.project(await this.tasks.cancel(taskId))
  }

  private async project(task: BackgroundTaskInfo): Promise<ArcaCollaborationTask> {
    const metadata = task.metadata as unknown as ArcaTaskMetadata
    let status: ArcaCollaborationStatus =
      task.status === 'queued' || task.status === 'paused' || task.status === 'waiting_input'
        ? 'queued'
        : task.status === 'running'
          ? 'working'
          : task.status === 'cancelled'
            ? 'cancelled'
            : task.status === 'failed'
              ? 'failed'
              : 'failed'
    let changeSet: ChangeSetSummary | undefined
    if (task.status === 'completed') {
      const changeSets = await this.arca.invoke<ChangeSetSummary[]>('document.changeset.list', {
        documentId: metadata.documentId,
      })
      changeSet = changeSets.find(
        (candidate) =>
          !metadata.existingChangeSetIds.includes(candidate.changeSetId) &&
          (candidate.actorPrincipalId === task.agentId ||
            candidate.actorPrincipalId === `agent:${task.agentId}`),
      )
      status = changeSet
        ? changeSet.status === 'committed'
          ? 'committed'
          : changeSet.status === 'rejected'
            ? 'rejected'
            : 'awaiting_review'
        : 'failed'
    }
    return {
      taskId: task.id,
      documentId: metadata.documentId,
      baseRevisionId: metadata.baseRevisionId,
      instruction: task.title.replace(/^Arca协作：/, ''),
      scope: metadata.scope,
      ...(metadata.nodeId ? { nodeId: metadata.nodeId } : {}),
      agentId: task.agentId,
      status,
      progress: task.progress,
      stage: task.currentStage,
      ...(changeSet ? { changeSetId: changeSet.changeSetId } : {}),
      ...(status === 'failed'
        ? { error: task.errorMessage ?? 'Agent任务已结束，但没有提交可审阅的ChangeSet' }
        : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  }

  private buildInstruction(
    input: {
      documentId: string
      instruction: string
      scope: ArcaTaskMetadata['scope']
      nodeId?: string
      requirements?: string
    },
    metadata: ArcaTaskMetadata,
  ): string {
    return [
      '你正在执行Arca文档协作任务。',
      `文档ID：${input.documentId}`,
      `基础Revision：${metadata.baseRevisionId}`,
      `范围：${input.scope}${input.nodeId ? `，语义节点=${input.nodeId}` : ''}`,
      `任务：${input.instruction}`,
      input.requirements?.trim() ? `附加要求：${input.requirements.trim()}` : '',
      '必须先调用arca_context_regions读取权威上下文。',
      '完成后必须调用arca_changeset_propose提交一个待审ChangeSet，再调用arca_changeset_validate验证。',
      '禁止使用文件、终端或人类编辑接口修改文档；不要只返回改写文本。',
    ]
      .filter(Boolean)
      .join('\n')
  }
}
