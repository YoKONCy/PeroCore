/**
 * executionRuntime — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { randomUUID } from 'node:crypto'
import type {
  KernelEventId,
  KernelExecutionBudget,
  KernelExecutionClass,
  KernelExecutionDescriptor,
  KernelExecutionId,
  KernelExecutionState,
  KernelExecutionUsage,
  KernelExecutionWaitReason,
  KernelExitStatus,
  KernelProcessId,
} from '@infos/shared'
import type { KernelOutboxRepository } from './kernelOutboxRepository'

export interface CreateExecutionInput {
  principalId: string
  processId?: KernelProcessId
  taskId?: string
  parentExecutionId?: KernelExecutionId
  threadId?: string
  channel?: string
  class: KernelExecutionClass
  priority?: number
  deadline?: string
  budget?: KernelExecutionBudget
}

/** 进程内 Execution 身份与终态记录器；调度策略不属于本阶段。 */
export class ExecutionRuntime {
  private readonly active = new Map<KernelExecutionId, KernelExecutionDescriptor>()
  private readonly stateWrites = new Map<KernelExecutionId, Promise<void>>()

  constructor(private readonly outbox: KernelOutboxRepository) {}

  async create(input: CreateExecutionInput): Promise<KernelExecutionDescriptor> {
    const descriptor: KernelExecutionDescriptor = Object.freeze({
      executionId: randomUUID() as KernelExecutionId,
      processId: input.processId ?? (randomUUID() as KernelProcessId),
      principalId: input.principalId,
      taskId: input.taskId,
      parentExecutionId: input.parentExecutionId,
      threadId: input.threadId,
      channel: input.channel,
      class: input.class,
      priority: input.priority ?? 5,
      deadline: input.deadline,
      budget: Object.freeze({ ...(input.budget ?? {}) }),
    })
    this.active.set(descriptor.executionId, descriptor)
    await this.appendState(descriptor, 'kernel.execution.created', 'created')
    return descriptor
  }

  async start(descriptor: KernelExecutionDescriptor): Promise<void> {
    await this.appendState(descriptor, 'kernel.execution.started', 'running')
  }

  stateChanged(
    descriptor: KernelExecutionDescriptor,
    state: KernelExecutionState,
    waitReason?: KernelExecutionWaitReason,
    usage?: KernelExecutionUsage,
  ): Promise<void> {
    const previous = this.stateWrites.get(descriptor.executionId) ?? Promise.resolve()
    const write = previous.then(() =>
      this.appendState(
        descriptor,
        'kernel.execution.state_changed',
        state,
        undefined,
        waitReason,
        usage,
      ),
    )
    this.stateWrites.set(descriptor.executionId, write)
    void write.then(
      () => {
        if (this.stateWrites.get(descriptor.executionId) === write) {
          this.stateWrites.delete(descriptor.executionId)
        }
      },
      () => {
        if (this.stateWrites.get(descriptor.executionId) === write) {
          this.stateWrites.delete(descriptor.executionId)
        }
      },
    )
    return write
  }

  async complete(descriptor: KernelExecutionDescriptor): Promise<void> {
    await this.finish(descriptor, {
      state: 'completed',
      code: 'OK',
      completedAt: new Date().toISOString(),
    })
  }

  async timeout(descriptor: KernelExecutionDescriptor, error?: unknown): Promise<void> {
    await this.finish(descriptor, {
      state: 'timed_out',
      code: 'DEADLINE_EXCEEDED',
      message: error instanceof Error ? error.message : error ? String(error) : undefined,
      completedAt: new Date().toISOString(),
    })
  }

  async fail(
    descriptor: KernelExecutionDescriptor,
    error: unknown,
    cancelled = false,
  ): Promise<void> {
    await this.finish(descriptor, {
      state: cancelled ? 'cancelled' : 'failed',
      code: cancelled ? 'CANCELLED' : 'EXECUTION_FAILED',
      message: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    })
  }

  get(executionId: KernelExecutionId): KernelExecutionDescriptor | null {
    return this.active.get(executionId) ?? null
  }

  private async finish(
    descriptor: KernelExecutionDescriptor,
    exitStatus: KernelExitStatus,
  ): Promise<void> {
    await this.stateWrites.get(descriptor.executionId)
    const type =
      exitStatus.state === 'completed'
        ? 'kernel.execution.completed'
        : exitStatus.state === 'cancelled'
          ? 'kernel.execution.cancelled'
          : exitStatus.state === 'timed_out'
            ? 'kernel.execution.timed_out'
            : 'kernel.execution.failed'
    await this.appendState(descriptor, type, exitStatus.state, exitStatus)
    this.active.delete(descriptor.executionId)
  }

  private async appendState(
    descriptor: KernelExecutionDescriptor,
    type:
      | 'kernel.execution.created'
      | 'kernel.execution.started'
      | 'kernel.execution.completed'
      | 'kernel.execution.failed'
      | 'kernel.execution.cancelled'
      | 'kernel.execution.timed_out'
      | 'kernel.execution.state_changed',
    state: KernelExecutionState,
    exitStatus?: KernelExitStatus,
    waitReason?: KernelExecutionWaitReason,
    usage?: KernelExecutionUsage,
  ): Promise<void> {
    await this.outbox.enqueue({
      protocolVersion: 1,
      type,
      durability: 'durable',
      principalId: descriptor.principalId,
      processId: descriptor.processId,
      executionId: descriptor.executionId,
      correlationId: descriptor.executionId,
      causationId: undefined as KernelEventId | undefined,
      payload: {
        descriptor: state === 'created' ? descriptor : undefined,
        state,
        waitReason,
        usage,
        exitStatus,
      },
    })
  }
}
