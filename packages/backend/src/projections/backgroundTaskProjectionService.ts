import type {
  ApprovalSurfaceProps,
  BackgroundTaskProjectionSnapshot,
  ConversationSurfaceDescriptor,
  InputSurfaceProps,
  ProgressSurfaceProps,
  StatusSurfaceProps,
  SurfaceId,
  SurfaceNode,
  SurfaceNodeId,
} from '@infos/shared'
import type { ApprovalService } from '../services/execution/approvalService'
import type { AgentInputService } from '../services/execution/agentInputService'
import type { BackgroundTaskService } from '../services/task/backgroundTaskService'
import type { ConversationProjectionService } from './conversationProjectionService'

/** 后台任务领域事实到系统 Surface 的可重建投影。 */
export class BackgroundTaskProjectionService {
  constructor(
    private readonly tasks: BackgroundTaskService,
    private readonly conversations: ConversationProjectionService,
    private readonly approvals?: ApprovalService,
    private readonly agentInputs?: AgentInputService,
  ) {}

  async getSnapshot(taskId: string): Promise<BackgroundTaskProjectionSnapshot> {
    const task = await this.tasks.getTask(taskId)
    if (!task) throw new Error(`后台任务不存在: ${taskId}`)
    const conversation = await this.conversations.getSnapshot(task.threadId)
    const surfaceId = `background-task:${task.id}` as SurfaceId
    const revision = this.revisionOf(task.updatedAt)
    const nodes: SurfaceNode[] = [
      this.node(surfaceId, 'markdown', 'stable', revision, 'summary', {
        source: `# ${task.title}\n\n${task.instruction}`,
        phase: 'committed',
      }),
      this.node<StatusSurfaceProps>(surfaceId, 'status', 'stable', revision, 'status', {
        state: task.status,
        message: task.currentStage ?? undefined,
      }),
      this.node<ProgressSurfaceProps>(surfaceId, 'progress', 'stable', revision, 'progress', {
        value: task.progress,
        stage: task.currentStage,
      }),
    ]
    if (task.result) {
      nodes.push(
        this.node(surfaceId, 'markdown', 'stable', revision, 'result', {
          source: `## 结果\n\n${task.result}`,
          phase: 'committed',
        }),
      )
    }
    if (task.errorMessage) {
      nodes.push(
        this.node(surfaceId, 'error', 'stable', revision, 'error', {
          code: 'BACKGROUND_TASK_FAILED',
          message: task.errorMessage,
        }),
      )
    }
    if (task.status === 'waiting_input') {
      nodes.push(
        this.node<InputSurfaceProps>(surfaceId, 'input', 'interactive', revision, 'input', {
          inputId: task.id,
          title: '等待你的决定',
          question: task.inputQuestion ?? 'Agent 需要你的确认后才能继续。',
          context: task.inputContext,
          actions: [
            { id: 'deny_once', label: '拒绝', tone: 'danger' },
            { id: 'allow_once', label: '批准并继续', tone: 'primary' },
          ],
        }),
      )
    }
    for (const approval of this.approvals?.list({
      status: 'pending',
      agentId: task.agentId,
    }) ?? []) {
      if (approval.taskId !== task.id) continue
      nodes.push(
        this.node<ApprovalSurfaceProps>(
          surfaceId,
          'approval',
          'interactive',
          revision,
          `approval:${approval.id}`,
          {
            approvalId: approval.id,
            principalId: approval.agentId,
            threadId: approval.threadId,
            toolName: approval.toolName,
            title: approval.reason,
            summary: approval.argsSummary,
            riskLevel: approval.riskLevel,
          },
        ),
      )
    }
    for (const input of this.agentInputs?.list({ status: 'pending', agentId: task.agentId }) ??
      []) {
      if (input.taskId !== task.id) continue
      nodes.push(
        this.node<InputSurfaceProps>(
          surfaceId,
          'input',
          'interactive',
          revision,
          `agent-input:${input.id}`,
          {
            inputId: input.id,
            inputKind: 'agent_question',
            principalId: input.agentId,
            title: '想问问你',
            question: input.question,
            context: input.context ? { message: input.context } : null,
            options: input.options,
            allowFreeText: input.allowFreeText,
            required: input.required,
            actions: input.required
              ? [{ id: 'answer', label: '回答并继续', tone: 'primary' }]
              : [
                  { id: 'skip', label: '暂时跳过', tone: 'neutral' },
                  { id: 'answer', label: '回答并继续', tone: 'primary' },
                ],
          },
        ),
      )
    }
    const taskSurface: ConversationSurfaceDescriptor = {
      surfaceId,
      generation: `background-task:${task.id}:revision:${revision}`,
      messageId: task.id,
      threadId: task.threadId,
      principalId: task.agentId,
      revision,
      sequence: 0,
      state: task.status === 'failed' ? 'failed' : 'committed',
      nodes,
    }
    return {
      protocolVersion: 1,
      taskId: task.id,
      threadId: task.threadId,
      principalId: task.agentId,
      revision,
      generatedAt: new Date().toISOString(),
      surfaces: [taskSurface, ...conversation.surfaces],
    }
  }

  private revisionOf(updatedAt: string): number {
    const parsed = Date.parse(updatedAt.replace(' ', 'T'))
    return Number.isFinite(parsed) ? parsed : 1
  }

  private node<T extends object>(
    surfaceId: SurfaceId,
    kind: SurfaceNode['kind'],
    lifecycle: SurfaceNode['lifecycle'],
    revision: number,
    suffix: string,
    props: T,
  ): SurfaceNode<T> {
    return {
      nodeId: `${surfaceId}:${suffix}` as SurfaceNodeId,
      kind,
      lifecycle,
      revision,
      props,
    }
  }
}
