/**
 * kernelScheduler — 内核基础设施
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
import { performanceEventsTotal, performanceLatencySeconds } from '../lib/metrics'
import type {
  KernelExecutionBudget,
  KernelExecutionClass,
  KernelExecutionDescriptor,
  KernelExecutionId,
  KernelExecutionSnapshot,
  KernelExecutionState,
  KernelExecutionUsage,
  KernelExecutionWaitReason,
} from '@infos/shared'
import { runWithKernelExecution } from './executionContext'
import type { CreateExecutionInput, ExecutionRuntime } from './executionRuntime'

export interface KernelSchedulerLimits {
  maxQueued: number
  maxRunning: number
  classConcurrency: Partial<Record<KernelExecutionClass, number>>
  agingIntervalMs: number
}

export interface KernelScheduleInput extends CreateExecutionInput {
  resourceKey?: string
  run(context: KernelScheduledExecutionContext): Promise<void>
}

export interface KernelScheduledExecutionContext {
  descriptor: KernelExecutionDescriptor
  signal: AbortSignal
  usage: KernelExecutionUsage
  consume(input: Partial<Omit<KernelExecutionUsage, 'concurrentIo'>>): void
  beginIo(): () => void
  wait(reason: Extract<KernelExecutionWaitReason, 'io' | 'approval'>): void
  resume(): void
}

export interface KernelPeriodicScheduleDefinition {
  name: string
  displayName: string
  description: string
  intervalMs: number
  principalId?: string
  class?: KernelExecutionClass
  priority?: number
  resourceKey?: string
  budget?: KernelExecutionBudget
  handler(context: KernelScheduledExecutionContext): Promise<void>
}

export interface KernelPeriodicScheduleStatus {
  name: string
  displayName: string
  description: string
  intervalMs: number
  running: boolean
  nextDueAt: number
  lastStartedAt: number | null
  lastFinishedAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  lastOutcome: 'success' | 'error' | null
  stats: {
    totalRuns: number
    successCount: number
    errorCount: number
    lastError?: string
    lastDurationMs?: number
    averageDurationMs: number
  }
}

interface KernelPeriodicScheduleRecord extends KernelPeriodicScheduleDefinition {
  nextDueAt: number
  running: boolean
  status: KernelPeriodicScheduleStatus
}

interface ScheduledRecord {
  snapshot: KernelExecutionSnapshot
  run: KernelScheduleInput['run']
  resourceKey?: string
  controller: AbortController
  pauseRequested: boolean
  deadlineTimer?: ReturnType<typeof setTimeout>
}

const TERMINAL = new Set<KernelExecutionState>(['completed', 'failed', 'cancelled', 'timed_out'])
const CLASS_WEIGHT: Record<KernelExecutionClass, number> = {
  realtime: 6_000,
  interactive: 5_000,
  foreground: 4_000,
  background: 2_000,
  resident: 1_000,
  maintenance: 0,
}

/**
 * infOS统一Execution调度内核。
 * 调度只管理执行身份、资源配额和状态；具体业务Runner仍位于用户空间服务。
 */
export class KernelScheduler {
  private readonly records = new Map<KernelExecutionId, ScheduledRecord>()
  private readonly queue: KernelExecutionId[] = []
  private readonly running = new Set<KernelExecutionId>()
  private readonly listeners = new Set<(snapshot: KernelExecutionSnapshot) => void>()
  private readonly persistedSignatures = new Map<KernelExecutionId, string>()
  private pumping = false
  private lastPersistenceError: string | null = null
  private readonly periodicSchedules = new Map<string, KernelPeriodicScheduleRecord>()
  private periodicTimer: ReturnType<typeof setInterval> | null = null
  private readonly periodicTickIntervalMs = 10_000

  constructor(
    private readonly executions: ExecutionRuntime,
    private readonly limits: KernelSchedulerLimits = {
      maxQueued: 256,
      maxRunning: 4,
      classConcurrency: {
        realtime: 1,
        interactive: 2,
        foreground: 2,
        background: 2,
        resident: 1,
        maintenance: 1,
      },
      agingIntervalMs: 5_000,
    },
  ) {}

  registerPeriodic(definition: KernelPeriodicScheduleDefinition): void {
    if (!Number.isFinite(definition.intervalMs) || definition.intervalMs <= 0) {
      throw new Error('KERNEL_SCHEDULE_INTERVAL_INVALID')
    }
    const now = Date.now()
    this.periodicSchedules.set(definition.name, {
      ...definition,
      nextDueAt: now + definition.intervalMs,
      running: false,
      status: {
        name: definition.name,
        displayName: definition.displayName,
        description: definition.description,
        intervalMs: definition.intervalMs,
        running: false,
        nextDueAt: now + definition.intervalMs,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastOutcome: null,
        stats: {
          totalRuns: 0,
          successCount: 0,
          errorCount: 0,
          averageDurationMs: 0,
        },
      },
    })
  }

  startPeriodic(): void {
    if (this.periodicTimer) return
    this.periodicTimer = setInterval(() => void this.tickPeriodic(), this.periodicTickIntervalMs)
    this.periodicTimer.unref?.()
  }

  stopPeriodic(): void {
    if (!this.periodicTimer) return
    clearInterval(this.periodicTimer)
    this.periodicTimer = null
  }

  get isPeriodicStarted(): boolean {
    return this.periodicTimer !== null
  }

  getPeriodicScheduleNames(): string[] {
    return [...this.periodicSchedules.keys()]
  }

  getPeriodicScheduleStatus(): KernelPeriodicScheduleStatus[] {
    return [...this.periodicSchedules.values()].map((record) => structuredClone(record.status))
  }

  async triggerPeriodicNow(name: string): Promise<boolean> {
    const record = this.periodicSchedules.get(name)
    if (!record || record.running) return false
    await this.runPeriodic(record)
    return true
  }

  async submit(input: KernelScheduleInput): Promise<KernelExecutionSnapshot> {
    if (this.queue.length >= this.limits.maxQueued) {
      throw new Error('KERNEL_SCHEDULER_BACKPRESSURE: Execution队列已满')
    }
    if (input.deadline && Date.parse(input.deadline) <= Date.now()) {
      throw new Error('KERNEL_EXECUTION_DEADLINE_EXPIRED: Execution截止时间已过')
    }
    const descriptor = await this.executions.create(input)
    const snapshot: KernelExecutionSnapshot = {
      descriptor,
      state: 'queued',
      usage: emptyUsage(),
      queuedAt: new Date().toISOString(),
    }
    const record: ScheduledRecord = {
      snapshot,
      run: input.run,
      ...(input.resourceKey ? { resourceKey: input.resourceKey } : {}),
      controller: new AbortController(),
      pauseRequested: false,
    }
    this.records.set(descriptor.executionId, record)
    this.queue.push(descriptor.executionId)
    this.updateWaitReasons()
    this.emit(record)
    void this.pump()
    return cloneSnapshot(snapshot)
  }

  async submitAndWait(input: KernelScheduleInput): Promise<KernelExecutionSnapshot> {
    const snapshot = await this.submit(input)
    return this.waitForTerminal(snapshot.descriptor.executionId)
  }

  waitForTerminal(executionId: KernelExecutionId): Promise<KernelExecutionSnapshot> {
    const current = this.get(executionId)
    if (current && TERMINAL.has(current.state)) return Promise.resolve(current)
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.descriptor.executionId !== executionId || !TERMINAL.has(snapshot.state)) return
        unsubscribe()
        resolve(snapshot)
      })
      const afterSubscribe = this.get(executionId)
      if (afterSubscribe && TERMINAL.has(afterSubscribe.state)) {
        unsubscribe()
        resolve(afterSubscribe)
      }
    })
  }

  getDiagnostics(): { queued: number; running: number; lastPersistenceError: string | null } {
    return {
      queued: this.queue.length,
      running: this.running.size,
      lastPersistenceError: this.lastPersistenceError,
    }
  }

  get(executionId: KernelExecutionId): KernelExecutionSnapshot | null {
    const record = this.records.get(executionId)
    return record ? cloneSnapshot(record.snapshot) : null
  }

  list(): KernelExecutionSnapshot[] {
    return [...this.records.values()].map((record) => cloneSnapshot(record.snapshot))
  }

  subscribe(listener: (snapshot: KernelExecutionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async cancel(executionId: KernelExecutionId): Promise<boolean> {
    const record = this.records.get(executionId)
    if (!record || TERMINAL.has(record.snapshot.state)) return false
    record.pauseRequested = false
    record.controller.abort('cancelled')
    if (record.snapshot.state === 'queued' || record.snapshot.state === 'suspended') {
      this.removeQueued(executionId)
      record.snapshot.state = 'cancelled'
      record.snapshot.waitReason = undefined
      record.snapshot.completedAt = new Date().toISOString()
      await this.executions.fail(record.snapshot.descriptor, new Error('Execution已取消'), true)
      this.emit(record)
      void this.pump()
    }
    return true
  }

  pause(executionId: KernelExecutionId): boolean {
    const record = this.records.get(executionId)
    if (!record || TERMINAL.has(record.snapshot.state) || record.snapshot.state === 'suspended') {
      return false
    }
    record.pauseRequested = true
    if (record.snapshot.state === 'queued') {
      this.removeQueued(executionId)
      record.snapshot.state = 'suspended'
      record.snapshot.waitReason = 'paused'
      this.emit(record)
      return true
    }
    record.controller.abort('paused')
    return true
  }

  resume(executionId: KernelExecutionId): boolean {
    const record = this.records.get(executionId)
    if (!record || record.snapshot.state !== 'suspended') return false
    record.pauseRequested = false
    record.controller = new AbortController()
    record.snapshot.state = 'queued'
    record.snapshot.waitReason = undefined
    record.snapshot.queuedAt = new Date().toISOString()
    record.snapshot.startedAt = undefined
    record.snapshot.completedAt = undefined
    this.queue.push(executionId)
    this.updateWaitReasons()
    this.emit(record)
    void this.pump()
    return true
  }

  private async pump(): Promise<void> {
    if (this.pumping) return
    this.pumping = true
    try {
      for (;;) {
        const next = this.selectNext()
        if (!next) break
        this.removeQueued(next.snapshot.descriptor.executionId)
        this.running.add(next.snapshot.descriptor.executionId)
        void this.execute(next)
      }
      this.updateWaitReasons()
    } finally {
      this.pumping = false
    }
  }

  private async tickPeriodic(): Promise<void> {
    const now = Date.now()
    for (const record of this.periodicSchedules.values()) {
      if (!record.running && now >= record.nextDueAt) void this.runPeriodic(record)
    }
  }

  private async runPeriodic(record: KernelPeriodicScheduleRecord): Promise<void> {
    const startedAt = Date.now()
    record.running = true
    record.nextDueAt = startedAt + record.intervalMs
    record.status.running = true
    record.status.nextDueAt = record.nextDueAt
    record.status.lastStartedAt = startedAt
    record.status.stats.totalRuns += 1
    try {
      const terminal = await this.submitAndWait({
        principalId: record.principalId ?? 'system',
        taskId: `periodic:${record.name}:${startedAt}`,
        class: record.class ?? 'maintenance',
        priority: record.priority ?? 5,
        resourceKey: record.resourceKey ?? `periodic:${record.name}`,
        budget: record.budget ?? {
          maxDurationMs: Math.max(record.intervalMs, 60_000),
          maxLlmCalls: 32,
          maxToolCalls: 64,
          maxConcurrentIo: 8,
        },
        run: record.handler,
      })
      if (terminal.state !== 'completed')
        throw new Error(`KERNEL_PERIODIC_${terminal.state.toUpperCase()}`)
      record.status.stats.successCount += 1
      record.status.lastSuccessAt = Date.now()
      record.status.lastOutcome = 'success'
    } catch (error) {
      record.status.stats.errorCount += 1
      record.status.stats.lastError = String(error)
      record.status.lastFailureAt = Date.now()
      record.status.lastOutcome = 'error'
    } finally {
      const finishedAt = Date.now()
      record.running = false
      record.status.running = false
      record.status.lastFinishedAt = finishedAt
      const durationMs = finishedAt - startedAt
      record.status.stats.lastDurationMs = durationMs
      const runs = record.status.stats.totalRuns
      const previous = record.status.stats.averageDurationMs
      record.status.stats.averageDurationMs = previous + (durationMs - previous) / runs
    }
  }

  private selectNext(): ScheduledRecord | undefined {
    if (this.running.size >= this.limits.maxRunning) return undefined
    const now = Date.now()
    return this.queue
      .map((id) => this.records.get(id))
      .filter((record): record is ScheduledRecord => Boolean(record))
      .filter((record) => this.canRun(record))
      .sort((left, right) => this.score(right, now) - this.score(left, now))[0]
  }

  private canRun(record: ScheduledRecord): boolean {
    const classLimit = this.limits.classConcurrency[record.snapshot.descriptor.class]
    if (
      classLimit !== undefined &&
      this.runningByClass(record.snapshot.descriptor.class) >= classLimit
    ) {
      return false
    }
    return !record.resourceKey || !this.resourceLocked(record.resourceKey)
  }

  private score(record: ScheduledRecord, now: number): number {
    const age = Math.max(0, now - Date.parse(record.snapshot.queuedAt))
    return (
      CLASS_WEIGHT[record.snapshot.descriptor.class] +
      record.snapshot.descriptor.priority * 10 +
      Math.floor(age / this.limits.agingIntervalMs)
    )
  }

  private async execute(record: ScheduledRecord): Promise<void> {
    const descriptor = record.snapshot.descriptor
    record.snapshot.state = 'running'
    record.snapshot.waitReason = undefined
    record.snapshot.startedAt = new Date().toISOString()
    performanceLatencySeconds.observe(
      { metric: 'scheduler_queue_wait', provider: descriptor.class },
      Math.max(0, Date.parse(record.snapshot.startedAt) - Date.parse(record.snapshot.queuedAt)) /
        1000,
    )
    this.emit(record)
    await this.executions.start(descriptor)
    this.installDeadline(record)
    const context = this.context(record)
    try {
      await runWithKernelExecution(
        record.snapshot.descriptor,
        () => record.run(context),
        context.consume,
      )
      if (record.pauseRequested) {
        record.snapshot.state = 'suspended'
        record.snapshot.waitReason = 'paused'
      } else if (record.controller.signal.aborted) {
        record.snapshot.state = 'cancelled'
        record.snapshot.completedAt = new Date().toISOString()
        await this.executions.fail(descriptor, new Error('Execution已取消'), true)
      } else {
        record.snapshot.state = 'completed'
        record.snapshot.completedAt = new Date().toISOString()
        await this.executions.complete(descriptor)
      }
    } catch (error) {
      if (record.pauseRequested) {
        record.snapshot.state = 'suspended'
        record.snapshot.waitReason = 'paused'
      } else if (record.controller.signal.aborted) {
        const timedOut = record.controller.signal.reason === 'deadline'
        record.snapshot.state = timedOut ? 'timed_out' : 'cancelled'
        record.snapshot.completedAt = new Date().toISOString()
        if (timedOut) await this.executions.timeout(descriptor, error)
        else await this.executions.fail(descriptor, error, true)
      } else {
        record.snapshot.state = 'failed'
        record.snapshot.completedAt = new Date().toISOString()
        await this.executions.fail(descriptor, error)
      }
    } finally {
      if (record.deadlineTimer) clearTimeout(record.deadlineTimer)
      this.running.delete(descriptor.executionId)
      performanceEventsTotal.inc({ metric: 'scheduler_execution', outcome: record.snapshot.state })
      if (record.snapshot.startedAt && record.snapshot.completedAt) {
        performanceLatencySeconds.observe(
          { metric: 'scheduler_execution_total', provider: descriptor.class },
          Math.max(
            0,
            Date.parse(record.snapshot.completedAt) - Date.parse(record.snapshot.startedAt),
          ) / 1000,
        )
      }
      this.emit(record)
      void this.pump()
    }
  }

  private context(record: ScheduledRecord): KernelScheduledExecutionContext {
    return {
      descriptor: record.snapshot.descriptor,
      signal: record.controller.signal,
      usage: record.snapshot.usage,
      consume: (delta) => {
        for (const key of ['llmCalls', 'inputTokens', 'outputTokens', 'toolCalls'] as const) {
          record.snapshot.usage[key] += delta[key] ?? 0
        }
        this.assertBudget(record)
        this.emit(record)
      },
      beginIo: () => {
        record.snapshot.usage.concurrentIo += 1
        this.assertBudget(record)
        this.emit(record)
        let completed = false
        return () => {
          if (completed) return
          completed = true
          record.snapshot.usage.concurrentIo = Math.max(0, record.snapshot.usage.concurrentIo - 1)
          this.emit(record)
        }
      },
      wait: (reason) => {
        if (record.snapshot.state !== 'running') {
          throw new Error(`KERNEL_EXECUTION_STATE_INVALID: ${record.snapshot.state}不能进入等待`)
        }
        record.snapshot.state = reason === 'approval' ? 'waiting_approval' : 'waiting_io'
        record.snapshot.waitReason = reason
        this.emit(record)
      },
      resume: () => {
        if (!['waiting_io', 'waiting_approval'].includes(record.snapshot.state)) {
          throw new Error(`KERNEL_EXECUTION_STATE_INVALID: ${record.snapshot.state}不能恢复运行`)
        }
        record.snapshot.state = 'running'
        record.snapshot.waitReason = undefined
        this.emit(record)
      },
    }
  }

  private assertBudget(record: ScheduledRecord): void {
    const budget: KernelExecutionBudget = record.snapshot.descriptor.budget
    const usage = record.snapshot.usage
    if (budget.maxLlmCalls !== undefined && usage.llmCalls > budget.maxLlmCalls) {
      throw new Error('KERNEL_BUDGET_LLM_CALLS_EXCEEDED')
    }
    if (budget.maxInputTokens !== undefined && usage.inputTokens > budget.maxInputTokens) {
      throw new Error('KERNEL_BUDGET_INPUT_TOKENS_EXCEEDED')
    }
    if (budget.maxOutputTokens !== undefined && usage.outputTokens > budget.maxOutputTokens) {
      throw new Error('KERNEL_BUDGET_OUTPUT_TOKENS_EXCEEDED')
    }
    if (budget.maxToolCalls !== undefined && usage.toolCalls > budget.maxToolCalls) {
      throw new Error('KERNEL_BUDGET_TOOL_CALLS_EXCEEDED')
    }
    if (budget.maxConcurrentIo !== undefined && usage.concurrentIo > budget.maxConcurrentIo) {
      throw new Error('KERNEL_BUDGET_CONCURRENT_IO_EXCEEDED')
    }
  }

  private installDeadline(record: ScheduledRecord): void {
    const deadline = record.snapshot.descriptor.deadline
    const durationBudget = record.snapshot.descriptor.budget.maxDurationMs
    const durations = [
      deadline ? Date.parse(deadline) - Date.now() : undefined,
      durationBudget,
    ].filter((value): value is number => value !== undefined)
    if (!durations.length) return
    const delay = Math.max(0, Math.min(...durations))
    record.deadlineTimer = setTimeout(() => record.controller.abort('deadline'), delay)
    record.deadlineTimer.unref?.()
  }

  private updateWaitReasons(): void {
    for (const id of this.queue) {
      const record = this.records.get(id)
      if (!record) continue
      record.snapshot.waitReason = this.waitReason(record)
      this.emit(record)
    }
  }

  private waitReason(record: ScheduledRecord): KernelExecutionWaitReason | undefined {
    if (this.running.size >= this.limits.maxRunning) return 'scheduler_capacity'
    const classLimit = this.limits.classConcurrency[record.snapshot.descriptor.class]
    if (
      classLimit !== undefined &&
      this.runningByClass(record.snapshot.descriptor.class) >= classLimit
    ) {
      return 'class_capacity'
    }
    if (record.resourceKey && this.resourceLocked(record.resourceKey)) return 'resource_locked'
    return undefined
  }

  private runningByClass(value: KernelExecutionClass): number {
    return [...this.running].filter(
      (id) => this.records.get(id)?.snapshot.descriptor.class === value,
    ).length
  }

  private resourceLocked(resourceKey: string): boolean {
    return [...this.running].some((id) => this.records.get(id)?.resourceKey === resourceKey)
  }

  private removeQueued(executionId: KernelExecutionId): void {
    const index = this.queue.indexOf(executionId)
    if (index >= 0) this.queue.splice(index, 1)
  }

  private emit(record: ScheduledRecord): void {
    const snapshot = cloneSnapshot(record.snapshot)
    for (const listener of this.listeners) listener(snapshot)
    if (!TERMINAL.has(snapshot.state)) this.persistState(snapshot)
  }

  private persistState(snapshot: KernelExecutionSnapshot): void {
    const signature = JSON.stringify([snapshot.state, snapshot.waitReason, snapshot.usage])
    if (this.persistedSignatures.get(snapshot.descriptor.executionId) === signature) return
    this.persistedSignatures.set(snapshot.descriptor.executionId, signature)
    void this.executions
      .stateChanged(
        snapshot.descriptor,
        snapshot.state,
        snapshot.waitReason,
        structuredClone(snapshot.usage),
      )
      .then(() => {
        this.lastPersistenceError = null
      })
      .catch((error) => {
        this.lastPersistenceError = error instanceof Error ? error.message : String(error)
      })
  }
}

function emptyUsage(): KernelExecutionUsage {
  return { llmCalls: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0, concurrentIo: 0 }
}

function cloneSnapshot(snapshot: KernelExecutionSnapshot): KernelExecutionSnapshot {
  return structuredClone(snapshot)
}
