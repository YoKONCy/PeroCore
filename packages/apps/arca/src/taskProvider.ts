import type { NodeProvider } from '@infos/node-sdk'
import type { ApplicationTaskSnapshot, KernelNodeId } from '@infos/shared'
import type { ArcaOfficeTasks, OfficeTaskInput } from './officeTasks'
import type { SurfaceSessionManager } from './surfaceSession'
import { arcaHostAuthorized } from './hostCredentials'

const operations = ['task.submit', 'task.get', 'task.list', 'task.cancel', 'task.retry'] as const

/** 声明与实际 Provider 共用标准任务契约，业务执行仍由自治内核负责。 */
export function createArcaTaskProvider(input: {
  nodeId: KernelNodeId
  instanceId: string
  tasks: ArcaOfficeTasks
  sessions: SurfaceSessionManager
  hostKey: string
}): NodeProvider {
  const project = (
    task: ReturnType<ArcaOfficeTasks['get']>,
  ): ApplicationTaskSnapshot<typeof task> => ({
    taskId: task.taskId,
    appId: 'infos.arca',
    instanceId: input.instanceId,
    operation: 'office.collaborate',
    state:
      task.status === 'working'
        ? 'running'
        : task.status === 'queued'
          ? 'queued'
          : task.status === 'failed'
            ? 'failed'
            : task.status === 'cancelled'
              ? 'cancelled'
              : 'completed',
    progress: task.progress ?? undefined,
    stage: task.stage,
    result: task,
    ...(task.error
      ? {
          error: {
            code: 'ARCA_TASK_FAILED',
            message: task.error,
            retryable: task.status === 'failed',
          },
        }
      : {}),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  })
  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.arca.tasks',
      name: 'Arca 协作任务',
      version: '1.0.0',
      definition: {
        capabilityType: 'application.task',
        contractVersion: '1.0',
        operations: Object.fromEntries(
          operations.map((operation) => [
            operation,
            {
              risk: ['task.get', 'task.list'].includes(operation) ? 'read' : 'interact',
              idempotency: ['task.submit', 'task.retry'].includes(operation) ? 'keyed' : 'safe',
            },
          ]),
        ),
      },
      offer: {
        offerId: `arca-tasks:${input.nodeId}`,
        capabilityType: 'application.task',
        contractVersion: '1.0',
        operations: [...operations],
        resourceKinds: ['application.task'],
      },
    },
    health: () => 'available',
    async invoke(envelope, context) {
      context.signal.throwIfAborted()
      const value = envelope.payload.input as Record<string, unknown>
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('任务参数无效')
      const operation = envelope.payload.operation
      const owner = arcaHostAuthorized(value.__arcaHostAuth, input.hostKey)
        ? envelope.principalId
        : input.sessions.require(
            value.surfaceSessionToken,
            ['task.get', 'task.list'].includes(operation) ? 'read' : 'edit',
            envelope.sourceNodeId,
          ).principalId
      if (operation === 'task.submit') {
        if (!context.idempotencyKey) throw new Error('任务提交需要稳定请求标识')
        if (value.operation && value.operation !== 'office.collaborate')
          throw new Error('任务类型未开放')
        if (!value.input || typeof value.input !== 'object' || Array.isArray(value.input))
          throw new Error('缺少任务内容')
        const task = input.tasks.submit(
          value.input as unknown as OfficeTaskInput,
          owner,
          context.idempotencyKey,
        )
        return { accepted: true, taskId: task.taskId, acceptedAt: task.createdAt }
      }
      if (operation === 'task.list')
        return input.tasks
          .list(String(value.documentId) as OfficeTaskInput['documentId'], owner)
          .map(project)
      if (typeof value.taskId !== 'string' || !value.taskId) throw new Error('缺少任务标识')
      if (operation === 'task.get') return project(input.tasks.get(value.taskId, owner))
      if (operation === 'task.cancel') return project(input.tasks.cancel(value.taskId, owner))
      if (operation === 'task.retry') {
        if (!context.idempotencyKey) throw new Error('任务重试需要稳定请求标识')
        return project(input.tasks.retry(value.taskId, owner))
      }
      throw new Error('任务操作未开放')
    },
  }
}
