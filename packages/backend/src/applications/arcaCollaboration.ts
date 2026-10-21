import { t as __t } from '../lib/i18n'
import { createHash, randomUUID } from 'node:crypto'
import type { OfficeSelection } from '@infos/document-engine/office'
import type { ApplicationToolProjection, KernelCallContext } from '@infos/shared'
import type { ConfigRepository } from '../repositories/config.repo'
import type { BackgroundTaskStatus } from '../repositories/backgroundTask.repo'
import { createAgentApplicationTaskPort } from './applicationTaskPort'
import type {
  BackgroundTaskInfo,
  BackgroundTaskService,
} from '../services/task/backgroundTaskService'
import type { ArcaCapabilityRuntime } from '../capabilities/arcaCapabilityRuntime'
import type { ToolContext } from '../services/agent/toolRegistry'
import type { ThreadService } from '../services/thread/threadService'
import { createLogger } from '../lib/logger'

const logger = createLogger('ArcaCollaboration')
const terminal = new Set(['completed', 'failed', 'cancelled'])
const activeStatuses: BackgroundTaskStatus[] = [
  'queued',
  'running',
  'paused',
  'waiting_input',
  'waiting',
  'blocked',
]
export type ArcaCollaborationStatus =
  | 'queued'
  | 'working'
  | 'awaiting_review'
  | 'committed'
  | 'rejected'
  | 'failed'
  | 'cancelled'
interface Metadata {
  kind: 'arca.collaboration'
  documentId: string
  baseRevisionId: string
  scope: 'selection' | 'section' | 'document'
  nodeId?: string
  collaborationId?: string
  changeSetId?: string
  applicationInstanceId?: string
  fingerprint?: string
}
interface GrantProjection {
  instanceId: string
  collaborationId: string
  changeSetId: string
  revoked: boolean
  proposal: { changeSetId: string; actorPrincipalId: string; status: string } | null
}
export interface ArcaCollaborationTask {
  taskId: string
  documentId: string
  baseRevisionId: string
  instruction: string
  scope: Metadata['scope']
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
interface CreateInput {
  documentId: string
  instruction: string
  scope: Metadata['scope']
  nodeId?: string
  agentId: string
  requirements?: string
  requestId?: string
  baseRevisionId?: string
  selection?: OfficeSelection
  originThreadId?: string
}

/** 宿主适配只编排角色任务；范围授权与提案绑定由 Arca 权威端执行。 */
export class ArcaCollaborationService {
  private closing = false
  private readonly stoppingInstances = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  private monitoring?: Promise<void>
  private readonly creating = new Map<string, Promise<ArcaCollaborationTask>>()
  private releaseCompletion?: () => void
  private readonly pendingRevocations = new Set<string>()
  constructor(
    private readonly tasks: BackgroundTaskService,
    private readonly arca: ArcaCapabilityRuntime,
    private readonly config: ConfigRepository,
    private readonly runtime: () => { instanceId: string } | undefined,
    private readonly threads: ThreadService,
  ) {}

  start(): void {
    this.releaseCompletion = this.tasks.registerApplicationCompletion('infos.arca', (task) =>
      this.validateCompletion(task),
    )
    this.timer = setInterval(() => {
      if (this.monitoring || this.closing) return
      this.monitoring = this.reconcile()
        .catch((error) =>
          logger.warn(__t('logs.applications', '核对 Arca 协作任务失败：{0}', [String(error)])),
        )
        .finally(() => {
          this.monitoring = undefined
        })
    }, 1000)
    this.timer.unref()
  }
  available(): boolean {
    const instance = this.runtime()?.instanceId
    return (
      !this.closing && !!instance && !this.stoppingInstances.has(instance) && this.arca.available()
    )
  }
  create(input: CreateInput): Promise<ArcaCollaborationTask> {
    const instance = this.runtime()?.instanceId
    if (!instance || !this.available()) return Promise.reject(new Error('Arca 尚未就绪'))
    const requestKey = input.requestId ?? randomUUID()
    const taskKey = `application:infos.arca:${instance}:${requestKey}`
    const taskId = `bgtask_${createHash('sha256').update(`${input.agentId}:${taskKey}`).digest('hex')}`
    const pending = this.creating.get(taskId)
    if (pending)
      return pending.then(async (task) => {
        const stored = await this.tasks.getTask(taskId)
        if (stored?.metadata.fingerprint !== this.fingerprint(input))
          throw new Error('同一请求标识不能用于不同协作内容')
        return task
      })
    const promise = this.createCurrent(input, instance, requestKey, taskId).finally(() =>
      this.creating.delete(taskId),
    )
    this.creating.set(taskId, promise)
    return promise
  }
  private async createCurrent(
    input: CreateInput,
    instanceId: string,
    requestKey: string,
    taskId: string,
  ): Promise<ArcaCollaborationTask> {
    const fingerprint = this.fingerprint(input)
    const existing = await this.tasks.getTask(taskId)
    if (existing) {
      if (existing.metadata.fingerprint !== fingerprint)
        throw new Error('同一请求标识不能用于不同协作内容')
      return this.project(existing)
    }
    if (input.originThreadId) {
      const origin = await this.threads.getThread(input.originThreadId)
      if (
        !origin ||
        origin.status !== 'active' ||
        origin.purpose !== 'conversation' ||
        origin.agentId !== input.agentId
      )
        throw new Error('原对话不存在或不属于所选协作者')
    }
    const snapshot = await this.arca.invoke<{ revisionId: string }>('document.inspect', {
      documentId: input.documentId,
    })
    if (input.baseRevisionId && input.baseRevisionId !== snapshot.revisionId)
      throw new Error('文稿版本已改变，请重新发起协作')
    const collaborationId = randomUUID()
    const grant = await this.arca.invoke<GrantProjection>(
      'collaboration.grant',
      {
        collaborationId,
        agentId: input.agentId,
        documentId: input.documentId,
        baseRevisionId: snapshot.revisionId,
        scope: input.scope,
        nodeId: input.nodeId,
        selection: input.selection,
      },
      this.context(`grant:${collaborationId}`),
    )
    try {
      if (!this.available() || this.runtime()?.instanceId !== instanceId)
        throw new Error('Arca 实例已改变，请重新发起协作')
      const metadata: Metadata = {
        kind: 'arca.collaboration',
        documentId: input.documentId,
        baseRevisionId: snapshot.revisionId,
        scope: input.scope,
        nodeId: input.nodeId,
        collaborationId,
        changeSetId: grant.changeSetId,
        applicationInstanceId: instanceId,
        fingerprint,
      }
      const configuredModelId = Number(await this.config.get('arca.modelConfigId'))
      const port = createAgentApplicationTaskPort({
        appId: 'infos.arca',
        instanceId,
        realmId: 'infos.arca',
        scheduler: this.tasks,
      })
      const accepted = await port.submit({
        operation: 'arca.collaboration',
        idempotencyKey: requestKey,
        correlationId: collaborationId,
        input: {
          agentId: input.agentId,
          title: __t('server.applications', 'Arca 协作：{0}', [input.instruction.slice(0, 24)]),
          targetThreadId: input.originThreadId,
          instruction: this.instruction(input, metadata),
          metadata: {
            ...metadata,
            ...(Number.isInteger(configuredModelId) && configuredModelId > 0
              ? { modelConfigId: configuredModelId }
              : {}),
          },
        },
      })
      const task = await this.tasks.getTask(accepted.taskId)
      if (!task) throw new Error('协作任务创建失败')
      if (!this.available() || this.runtime()?.instanceId !== instanceId) {
        await this.tasks.cancel(task.id)
        throw new Error('Arca 已停止，协作任务已取消')
      }
      return this.project(task)
    } catch (error) {
      await this.revoke(collaborationId).catch((failure) =>
        logger.warn(__t('logs.applications', '撤销协作授权失败：{0}', [String(failure)])),
      )
      throw error
    }
  }
  async list(documentId: string): Promise<ArcaCollaborationTask[]> {
    const matching = (await this.all()).filter((task) => task.metadata.documentId === documentId)
    return Promise.all(matching.map((task) => this.project(task)))
  }
  async get(taskId: string): Promise<ArcaCollaborationTask | null> {
    const task = await this.tasks.getTask(taskId)
    return task?.metadata.kind === 'arca.collaboration' ? this.project(task) : null
  }
  async cancel(taskId: string): Promise<ArcaCollaborationTask> {
    const task = await this.tasks.getTask(taskId)
    if (!task || task.metadata.kind !== 'arca.collaboration') throw new Error('协作任务不存在')
    // 先撤销权威端写入授权，避免取消与迟到的工具调用竞争。
    if (typeof task.metadata.collaborationId === 'string')
      await this.revokeOrQueue(task.metadata.collaborationId)
    return this.project(terminal.has(task.status) ? task : await this.tasks.cancel(taskId))
  }
  async cancelInstance(instanceId?: string): Promise<void> {
    const matching = (await this.all(true)).filter(
      (task) => !instanceId || task.metadata.applicationInstanceId === instanceId,
    )
    const failures = await Promise.allSettled(
      matching.map(async (task) => {
        if (
          this.runtime()?.instanceId === task.metadata.applicationInstanceId &&
          typeof task.metadata.collaborationId === 'string'
        )
          await this.revokeOrQueue(task.metadata.collaborationId)
        await this.tasks.cancel(task.id)
      }),
    )
    if (failures.some((result) => result.status === 'rejected'))
      throw new Error('部分角色协作任务未能取消')
  }
  async prepareStop(): Promise<void> {
    const instance = this.runtime()?.instanceId
    if (instance) this.stoppingInstances.add(instance)
    await Promise.allSettled([...this.creating.values()])
    await this.cancelInstance(instance)
  }
  async stop(): Promise<void> {
    this.closing = true
    if (this.timer) clearInterval(this.timer)
    await this.monitoring
    await Promise.allSettled([...this.creating.values()])
    try {
      await this.cancelInstance()
    } finally {
      this.releaseCompletion?.()
    }
  }
  async invokeTool(
    projection: ApplicationToolProjection,
    args: Record<string, unknown>,
    context: ToolContext,
    invoke: (operation: string, input: unknown, context: KernelCallContext) => Promise<unknown>,
  ): Promise<string> {
    try {
      if (projection.name === 'arca_collaborate') {
        if (context.taskId || context.signal?.aborted)
          throw new Error('不能从后台任务嵌套发起文稿协作')
        if (
          typeof args.documentId !== 'string' ||
          typeof args.instruction !== 'string' ||
          !args.instruction.trim() ||
          args.instruction.length > 4000 ||
          !['section', 'document'].includes(String(args.scope))
        )
          throw new Error('文稿协作参数无效')
        const task = await this.create({
          documentId: args.documentId,
          instruction: args.instruction,
          scope: args.scope as 'section' | 'document',
          ...(typeof args.nodeId === 'string' ? { nodeId: args.nodeId } : {}),
          agentId: context.agentId,
          originThreadId: context.threadId,
          requestId: context.toolCallId ?? randomUUID(),
        })
        return JSON.stringify({
          accepted: true,
          taskId: task.taskId,
          status: task.status,
          documentId: task.documentId,
        })
      }
      if (!context.taskId || context.signal?.aborted)
        throw new Error('文稿工具只能在已授权的 Arca 协作任务中使用')
      const task = await this.tasks.getTask(context.taskId)
      const metadata = task?.metadata as unknown as Metadata | undefined
      if (
        !task ||
        metadata?.kind !== 'arca.collaboration' ||
        task.agentId !== context.agentId ||
        task.status !== 'running' ||
        metadata.applicationInstanceId !== this.runtime()?.instanceId ||
        !metadata.collaborationId ||
        !this.available()
      )
        throw new Error('当前任务不再持有 Arca 协作授权')
      const { __arcaHostAuth: _auth, __arcaCollaborationId: _grant, ...value } = args
      const result = await invoke(
        projection.operation,
        { ...value, __arcaCollaborationId: metadata.collaborationId },
        {
          principalId: context.agentId,
          correlationId: metadata.collaborationId,
          executionId: context.executionId,
          processId: context.processId,
          deadline: context.deadline,
          idempotencyKey: context.toolCallId ?? randomUUID(),
        },
      )
      return JSON.stringify({ success: true, result })
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : '文稿调用失败' })
    }
  }
  private async validateCompletion(task: BackgroundTaskInfo): Promise<string> {
    const metadata = task.metadata as unknown as Metadata
    if (
      metadata.kind !== 'arca.collaboration' ||
      metadata.applicationInstanceId !== this.runtime()?.instanceId ||
      !metadata.collaborationId
    )
      throw new Error('协作实例已退出，不能确认交付')
    const grant = await this.arca.invoke<GrantProjection | null>(
      'collaboration.get',
      { collaborationId: metadata.collaborationId },
      this.context(`result:${task.id}`),
    )
    if (
      !grant?.proposal ||
      grant.revoked ||
      grant.instanceId !== metadata.applicationInstanceId ||
      grant.changeSetId !== metadata.changeSetId ||
      grant.proposal.changeSetId !== grant.changeSetId ||
      ![task.agentId, `agent:${task.agentId}`].includes(grant.proposal.actorPrincipalId)
    )
      throw new Error('角色没有提交当前任务的有效提案')
    const validation = await this.arca.invoke<{
      valid?: boolean
      status?: string
      issues?: unknown[]
    }>(
      'document.changeset.validate',
      {
        __arcaCollaborationId: metadata.collaborationId,
        changeSetId: grant.changeSetId,
      },
      {
        principalId: task.agentId,
        correlationId: metadata.collaborationId,
        idempotencyKey: `validate:${task.id}`,
      },
    )
    if (
      validation.valid === false ||
      !['validated', 'approved', 'committed'].includes(validation.status ?? '')
    )
      throw new Error('协作提案未通过文稿权威校验')
    return `${validation.status === 'committed' ? '修改已应用到文稿。' : '文稿协作已完成，修改提案等待审阅。'}\n\n[查看文稿](arca:${encodeURIComponent(metadata.documentId)})\n\n提案：${grant.changeSetId}`
  }
  private async project(task: BackgroundTaskInfo): Promise<ArcaCollaborationTask> {
    const metadata = task.metadata as unknown as Metadata
    let status: ArcaCollaborationStatus =
      task.status === 'running'
        ? 'working'
        : task.status === 'cancelled'
          ? 'cancelled'
          : task.status === 'failed'
            ? 'failed'
            : task.status === 'completed'
              ? 'failed'
              : 'queued'
    let changeSetId: string | undefined
    if (metadata.collaborationId && this.arca.available()) {
      const grant = await this.arca
        .invoke<GrantProjection | null>(
          'collaboration.get',
          { collaborationId: metadata.collaborationId },
          this.context(`project:${task.id}`),
        )
        .catch(() => null)
      if (
        grant?.proposal &&
        grant.changeSetId === metadata.changeSetId &&
        [task.agentId, `agent:${task.agentId}`].includes(grant.proposal.actorPrincipalId)
      ) {
        changeSetId = grant.changeSetId
        if (task.status === 'completed')
          status =
            grant.proposal.status === 'committed'
              ? 'committed'
              : grant.proposal.status === 'rejected'
                ? 'rejected'
                : ['failed', 'conflicted', 'superseded'].includes(grant.proposal.status)
                  ? 'failed'
                  : 'awaiting_review'
      }
    }
    // 已交付任务下线后保留确定的产物引用，不改用作者搜索其他提案。
    if (
      task.status === 'completed' &&
      !changeSetId &&
      metadata.changeSetId &&
      task.result?.includes(metadata.changeSetId)
    ) {
      changeSetId = metadata.changeSetId
      status = 'awaiting_review'
    }
    return {
      taskId: task.id,
      documentId: metadata.documentId,
      baseRevisionId: metadata.baseRevisionId,
      instruction: task.title.replace(/^Arca\s*协作：/, ''),
      scope: metadata.scope,
      nodeId: metadata.nodeId,
      agentId: task.agentId,
      status,
      progress: task.progress,
      stage: task.currentStage,
      changeSetId,
      ...(status === 'failed'
        ? { error: task.errorMessage ?? '没有可确认的协作提案，请重新发起' }
        : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  }
  private async reconcile(): Promise<void> {
    const current = this.runtime()?.instanceId
    if (current) for (const id of [...this.pendingRevocations]) await this.revokeOrQueue(id)
    for (const task of await this.all(true))
      if (
        task.metadata.applicationInstanceId !== current ||
        this.stoppingInstances.has(String(task.metadata.applicationInstanceId))
      ) {
        if (typeof task.metadata.collaborationId === 'string')
          this.pendingRevocations.add(task.metadata.collaborationId)
        await this.tasks.cancel(task.id)
      }
  }
  private async all(activeOnly = false): Promise<BackgroundTaskInfo[]> {
    const result: BackgroundTaskInfo[] = []
    for (let page = 1; ; page++) {
      const data = await this.tasks.query({
        appId: 'infos.arca',
        page,
        pageSize: 100,
        ...(activeOnly ? { status: activeStatuses } : {}),
      })
      result.push(...data.items.filter((task) => task.metadata.kind === 'arca.collaboration'))
      if (page * data.pageSize >= data.total) return result
    }
  }
  private revoke(id: string) {
    return this.arca.invoke(
      'collaboration.revoke',
      { collaborationId: id },
      this.context(`revoke:${id}`),
    )
  }
  private async revokeOrQueue(id: string): Promise<void> {
    this.pendingRevocations.add(id)
    if (!this.runtime()) return
    try {
      await this.revoke(id)
      this.pendingRevocations.delete(id)
    } catch (error) {
      logger.warn(__t('logs.applications', '协作授权等待重连后撤销：{0}', [String(error)]))
    }
  }
  private context(key: string): KernelCallContext {
    return {
      principalId: 'application:infos.arca',
      correlationId: key,
      idempotencyKey: randomUUID(),
    }
  }
  private fingerprint(input: CreateInput): string {
    const { requestId: _request, ...value } = input
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }
  private instruction(input: CreateInput, metadata: Metadata): string {
    return [
      '你正在执行 Arca 文稿协作任务。',
      `文稿：${input.documentId}；基础版本：${metadata.baseRevisionId}；范围：${input.scope}。`,
      `任务：${input.instruction}`,
      input.requirements ? `附加要求：${input.requirements}` : '',
      '先用 arca_context_regions 读取权威端提供的授权内容；不要猜测选区外文字。',
      input.scope === 'selection'
        ? '每个 text.replace.value 只填写对应选区的替换文字；权威端自动保留节点中选区之外的内容。'
        : '修改操作必须位于授权范围内。',
      `用 arca_changeset_propose 提交提案，随后用 arca_changeset_validate 验证。提案 ID 固定为 ${metadata.changeSetId}。`,
      '禁止绕过文稿工具使用文件、终端或人类编辑接口。提交与验证成功后再报告完成。',
    ]
      .filter(Boolean)
      .join('\n')
  }
}
