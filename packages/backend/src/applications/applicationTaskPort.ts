/**
 * applicationTaskPort — Application Realm 集成层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import type { ApplicationTaskAccepted, ApplicationTaskSnapshot } from '@infos/shared'
import type { ApplicationTaskPort, ApplicationTaskSubmitRequest } from '@infos/node-sdk'
import type { BackgroundScheduler } from '../services/task/backgroundTaskService'

export interface AgentApplicationTaskInput {
  agentId: string
  title?: string
  instruction: string
  priority?: number
  metadata?: Record<string, unknown>
}

export function createAgentApplicationTaskPort(input: {
  appId: string
  instanceId: string
  scheduler: BackgroundScheduler
}): ApplicationTaskPort {
  const submitted = new Map<string, string>()
  return {
    async submit<TInput>(request: ApplicationTaskSubmitRequest<TInput>) {
      const duplicate = submitted.get(request.idempotencyKey)
      if (duplicate) {
        const existing = await input.scheduler.getTask(duplicate)
        if (existing) return { accepted: true, taskId: duplicate, acceptedAt: existing.createdAt }
      }
      const value = requireTaskInput(request.input)
      const task = await input.scheduler.dispatch({
        agentId: value.agentId,
        title: value.title,
        instruction: value.instruction,
        priority: value.priority,
        requestedBy: 'runtime',
        completionAction: 'notify',
        realmId: `${input.appId}:${input.instanceId}`,
        appId: input.appId,
        metadata: {
          ...value.metadata,
          applicationTask: true,
          applicationOperation: request.operation,
          applicationInstanceId: input.instanceId,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
          ...(request.causationId ? { causationId: request.causationId } : {}),
        },
      })
      submitted.set(request.idempotencyKey, task.id)
      return {
        accepted: true,
        taskId: task.id,
        acceptedAt: task.createdAt,
      } satisfies ApplicationTaskAccepted
    },
    async get<TResult>(taskId: string) {
      const task = await input.scheduler.getTask(taskId)
      return task ? project<TResult>(input.appId, input.instanceId, task) : null
    },
    async cancel(taskId: string) {
      return project(input.appId, input.instanceId, await input.scheduler.cancel(taskId))
    },
  }
}

function requireTaskInput(value: unknown): AgentApplicationTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('APPLICATION_TASK_INPUT_INVALID')
  }
  const input = value as Record<string, unknown>
  if (typeof input.agentId !== 'string' || !input.agentId.trim()) {
    throw new Error('APPLICATION_TASK_AGENT_REQUIRED')
  }
  if (typeof input.instruction !== 'string' || !input.instruction.trim()) {
    throw new Error('APPLICATION_TASK_INSTRUCTION_REQUIRED')
  }
  return {
    agentId: input.agentId.trim(),
    instruction: input.instruction.trim(),
    ...(typeof input.title === 'string' ? { title: input.title.trim() } : {}),
    ...(typeof input.priority === 'number' ? { priority: input.priority } : {}),
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { metadata: input.metadata as Record<string, unknown> }
      : {}),
  }
}

function project<TResult>(
  appId: string,
  instanceId: string,
  task: Awaited<ReturnType<BackgroundScheduler['getTask']>> extends infer T
    ? NonNullable<T>
    : never,
): ApplicationTaskSnapshot<TResult> {
  const state =
    task.status === 'running'
      ? 'running'
      : task.status === 'completed'
        ? 'completed'
        : task.status === 'failed'
          ? 'failed'
          : task.status === 'cancelled'
            ? 'cancelled'
            : task.status === 'waiting_input' || task.status === 'paused'
              ? 'waiting'
              : 'queued'
  return {
    taskId: task.id,
    appId,
    instanceId,
    operation:
      typeof task.metadata.applicationOperation === 'string'
        ? task.metadata.applicationOperation
        : 'agent.execute',
    state,
    progress: task.progress ?? undefined,
    stage: task.currentStage ?? undefined,
    executionId: task.execution?.descriptor.executionId,
    ...(task.result ? { result: task.result as TResult } : {}),
    ...(task.errorMessage
      ? { error: { code: 'APPLICATION_TASK_FAILED', message: task.errorMessage, retryable: false } }
      : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt ?? undefined,
  }
}
