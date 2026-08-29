import { randomUUID } from 'node:crypto'
import type { EventNoteDraftInput } from '@infos/shared'
import type { EventNoteRepository } from '../../repositories/eventNote.repo'
import type { ThreadRepository } from '../../repositories/thread.repo'
import type { EventMemoryService } from './eventMemoryService'
import type { ModelConfig } from '../llm/llmService'
import { tokenCounter } from '../tokenizer/tokenCounter'
import { createLogger } from '../../lib/logger'

const logger = createLogger('EventMemoryFallbackService')
const SCORER_BATCH_SIZE = 8

export type BackgroundMemoryReason =
  | 'agent_silence'
  | 'thread_idle'
  | 'day_boundary'
  | 'capacity'
  | 'scorer_batch'
  | 'context_window'

export interface BackgroundEventExtractor {
  extract(input: {
    agentId: string
    threadId: string
    channel: string
    messages: Array<{ role: string; content: string; timestamp: string; pairId: string | null }>
  }): Promise<EventNoteDraftInput[]>
}

interface PendingTask {
  key: string
  agentId: string
  threadId: string
  channel: string
  pairIds: string[]
  reason: BackgroundMemoryReason
  priority: number
}

export interface EventMemoryFallbackOptions {
  agentSilenceSeconds?: number
  threadIdleSeconds?: number
  safeInputTokens?: number
  getModelConfig?: () => Promise<ModelConfig | null>
  reservedPromptTokens?: number
  reservedOutputTokens?: number
  capacityRatio?: number
  now?: () => Date
}

const PRIORITY: Record<BackgroundMemoryReason, number> = {
  agent_silence: 1,
  thread_idle: 2,
  day_boundary: 3,
  capacity: 4,
  scorer_batch: 5,
  context_window: 6,
}

export class EventMemoryFallbackService {
  private elapsed = new Map<string, number>()
  private threadRevisions = new Map<string, string>()
  private queued = new Map<string, PendingTask>()
  private lastTickMs?: number
  private lastBoundaryDate = ''
  private running = false
  private readonly options: Required<EventMemoryFallbackOptions>

  constructor(
    private repo: EventNoteRepository,
    private threads: ThreadRepository,
    private eventMemory: EventMemoryService,
    private extractor: BackgroundEventExtractor,
    options: EventMemoryFallbackOptions = {},
  ) {
    this.options = {
      agentSilenceSeconds: options.agentSilenceSeconds ?? 6 * 60 * 60,
      threadIdleSeconds: options.threadIdleSeconds ?? 2 * 60 * 60,
      safeInputTokens: options.safeInputTokens ?? 0,
      getModelConfig: options.getModelConfig ?? (async () => null),
      reservedPromptTokens: options.reservedPromptTokens ?? 4_000,
      reservedOutputTokens: options.reservedOutputTokens ?? 2_000,
      capacityRatio: options.capacityRatio ?? 0.8,
      now: options.now ?? (() => new Date()),
    }
  }

  async tick(enabledAgentIds: string[]): Promise<void> {
    const now = this.options.now()
    const deltaSeconds = this.activeDeltaSeconds(now.getTime())
    const boundary = now.getHours() >= 21 ? this.localDate(now) : ''
    const capacity = await this.capacityTokens()
    for (const agentId of enabledAgentIds) {
      const silenceKey = `agent-silence:${agentId}`
      const silence = await this.incrementTimer(silenceKey, deltaSeconds)
      const result = await this.threads.listThreads({
        agentId,
        purpose: 'conversation',
        pageSize: 100,
      })
      for (const thread of result.items) {
        const messages = await this.threads.queryActiveMessagePairs(thread.id, 10_000)
        const pairs = this.orderedPairs(messages)
        if (!pairs.length) continue
        const covered = await this.repo.coveredPairIds(agentId, thread.id)
        const segments = this.uncoveredSegments(pairs, covered)
        if (!segments.length) continue

        const revision = `${thread.lastMessageAt ?? ''}:${pairs.at(-1)}`
        const idleKey = `thread-idle:${agentId}:${thread.id}`
        if (this.threadRevisions.get(idleKey) !== revision) {
          this.threadRevisions.set(idleKey, revision)
          this.elapsed.set(idleKey, 0)
          await this.repo.resetTimer(idleKey)
        }
        const idle = await this.incrementTimer(idleKey, deltaSeconds)
        const slices = segments.flatMap((segment) =>
          this.sliceByCapacity(messages, segment, capacity),
        )
        const tokenEstimate = segments.reduce(
          (sum, segment) => sum + this.estimatePairTokens(messages, segment),
          0,
        )
        let reason: BackgroundMemoryReason | undefined
        if (tokenEstimate >= capacity) reason = 'capacity'
        else if (segments.some((segment) => segment.length >= SCORER_BATCH_SIZE)) {
          reason = 'scorer_batch'
        } else if (boundary && boundary !== this.lastBoundaryDate) reason = 'day_boundary'
        else if (idle >= this.options.threadIdleSeconds) reason = 'thread_idle'
        else if (silence >= this.options.agentSilenceSeconds) reason = 'agent_silence'
        if (reason) {
          for (const pairIds of slices) {
            this.enqueue(agentId, thread.id, thread.channel, pairIds, reason)
          }
        }
      }
    }
    if (boundary) this.lastBoundaryDate = boundary
    await this.drain()
  }

  async ensureContextWindowCoverage(input: {
    agentId: string
    threadId: string
    channel: string
    contextPairs: number
  }): Promise<void> {
    const messages = await this.threads.queryActiveMessagePairs(input.threadId, 10_000)
    const pairs = this.orderedPairs(messages)
    const covered = await this.repo.coveredPairIds(input.agentId, input.threadId)
    const precedingPairs = pairs.slice(0, -1)
    const contextPairs = Math.max(1, input.contextPairs)
    if (precedingPairs.length < contextPairs) return

    const batchPairs = precedingPairs
      .slice(-contextPairs)
      .filter((pairId) => !covered.has(pairId))
    if (!batchPairs.length) return

    const capacity = await this.capacityTokens()
    for (const pairIds of this.sliceByCapacity(messages, batchPairs, capacity)) {
      this.enqueue(
        input.agentId,
        input.threadId,
        input.channel,
        pairIds,
        'context_window',
      )
    }
    await this.drain()
  }

  async checkpoint(): Promise<void> {
    await Promise.all(
      [...this.elapsed].map(([key, value]) => this.repo.checkpointTimer(key, value)),
    )
  }

  async restore(keys: string[]): Promise<void> {
    for (const key of keys) this.elapsed.set(key, await this.repo.readTimer(key))
  }

  private async capacityTokens(): Promise<number> {
    if (this.options.safeInputTokens > 0) {
      return Math.max(1, Math.floor(this.options.safeInputTokens * this.options.capacityRatio))
    }
    const config = await this.options.getModelConfig()
    const contextWindow = config?.contextWindowTokens
    if (!contextWindow) {
      throw new Error('后台事件补记模型未配置上下文窗口')
    }
    const outputReserve = Math.max(this.options.reservedOutputTokens, config.maxTokens ?? 0)
    const safeInput = contextWindow - this.options.reservedPromptTokens - outputReserve
    if (safeInput <= 0) {
      throw new Error('后台事件补记模型上下文窗口不足以容纳预留内容')
    }
    return Math.max(1, Math.floor(safeInput * this.options.capacityRatio))
  }

  private activeDeltaSeconds(nowMs: number): number {
    const previous = this.lastTickMs
    this.lastTickMs = nowMs
    if (previous === undefined) return 0
    const actual = Math.max(0, Math.floor((nowMs - previous) / 1000))
    return Math.min(actual, 60)
  }

  private async incrementTimer(key: string, delta: number): Promise<number> {
    if (!this.elapsed.has(key)) this.elapsed.set(key, await this.repo.readTimer(key))
    const value = (this.elapsed.get(key) ?? 0) + delta
    this.elapsed.set(key, value)
    return value
  }

  private orderedPairs(messages: Array<{ pairId: string | null }>): string[] {
    return [
      ...new Set(
        messages.map((message) => message.pairId).filter((id): id is string => Boolean(id)),
      ),
    ]
  }

  private uncoveredSegments(pairIds: string[], covered: Set<string>): string[][] {
    const segments: string[][] = []
    let current: string[] = []
    for (const pairId of pairIds) {
      if (covered.has(pairId)) {
        if (current.length) segments.push(current)
        current = []
      } else {
        current.push(pairId)
      }
    }
    if (current.length) segments.push(current)
    return segments
  }

  private estimatePairTokens(
    messages: Array<{ pairId: string | null; content: string }>,
    pairIds: string[],
  ): number {
    const selected = new Set(pairIds)
    return messages
      .filter((message) => message.pairId && selected.has(message.pairId))
      .reduce((sum, message) => sum + tokenCounter.countTokens(message.content), 0)
  }

  private sliceByCapacity(
    messages: Array<{ pairId: string | null; content: string }>,
    pairIds: string[],
    capacity: number,
  ): string[][] {
    const slices: string[][] = []
    let current: string[] = []
    let tokens = 0
    for (const pairId of pairIds) {
      const pairTokens = this.estimatePairTokens(messages, [pairId])
      if (current.length && tokens + pairTokens > capacity) {
        slices.push(current)
        current = []
        tokens = 0
      }
      current.push(pairId)
      tokens += pairTokens
    }
    if (current.length) slices.push(current)
    return slices
  }

  private enqueue(
    agentId: string,
    threadId: string,
    channel: string,
    pairIds: string[],
    reason: BackgroundMemoryReason,
  ): void {
    const key = `${agentId}:${threadId}:${pairIds.join(',')}`
    const current = this.queued.get(key)
    if (current && current.priority >= PRIORITY[reason]) return
    this.queued.set(key, {
      key,
      agentId,
      threadId,
      channel,
      pairIds,
      reason,
      priority: PRIORITY[reason],
    })
  }

  private async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      while (this.queued.size) {
        const task = [...this.queued.values()].sort((a, b) => b.priority - a.priority)[0]!
        this.queued.delete(task.key)
        await this.process(task)
      }
    } finally {
      this.running = false
    }
  }

  private async process(task: PendingTask): Promise<void> {
    const ownerId = `background:${task.key}:${randomUUID()}`
    const staleBefore = new Date(this.options.now().getTime() - 30 * 60_000).toISOString()
    const claimed = await this.repo.claimCoverageRange({
      agentId: task.agentId,
      threadId: task.threadId,
      pairIds: task.pairIds,
      ownerId,
      staleBefore,
    })
    if (!claimed) return
    logger.info(
      `开始后台事件提炼: agent=${task.agentId}, thread=${task.threadId}, pairs=${task.pairIds.length}, reason=${task.reason}`,
    )
    try {
      const messages = await this.threads.findMessagesByPairIds(task.threadId, task.pairIds)
      if (!messages.length) return
      const drafts = await this.extractor.extract({
        agentId: task.agentId,
        threadId: task.threadId,
        channel: task.channel,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp ?? new Date().toISOString(),
          pairId: message.pairId,
        })),
      })
      const messageIds = messages.map((message) => String(message.id))
      if (!drafts.length) {
        await this.repo.commitCoverageUnderClaim(
          {
            id: randomUUID(),
            agentId: task.agentId,
            threadId: task.threadId,
            pairIds: task.pairIds,
            messageIds,
            outcome: 'reviewed_no_event',
            eventNoteIds: [],
            mode: 'background',
            coveredAt: new Date().toISOString(),
          },
          ownerId,
        )
        logger.info(
          `后台事件提炼完成，未发现长期事件: agent=${task.agentId}, pairs=${task.pairIds.length}`,
        )
        return
      }
      const eventAt = new Date(messages.at(-1)!.timestamp ?? new Date()).toISOString()
      const notes = []
      for (const [index, draft] of drafts.entries()) {
        notes.push(
          await this.eventMemory.create(
            {
              ...draft,
              agentId: task.agentId,
              eventAt,
              origin: {
                mode: 'background',
                threadId: task.threadId,
                pairIds: task.pairIds,
                messageIds,
                channel: task.channel,
              },
            },
            `background:${task.key}:${index}`,
            { deferCoverage: true },
          ),
        )
      }
      await this.repo.commitCoverageUnderClaim(
        {
          id: randomUUID(),
          agentId: task.agentId,
          threadId: task.threadId,
          pairIds: task.pairIds,
          messageIds,
          outcome: 'event_recorded',
          eventNoteIds: notes.map((note) => note.id),
          mode: 'background',
          coveredAt: new Date().toISOString(),
        },
        ownerId,
      )
      logger.info(
        `后台事件提炼完成: agent=${task.agentId}, pairs=${task.pairIds.length}, events=${notes.length}`,
      )
    } finally {
      await this.repo.releaseCoverageClaim(ownerId)
    }
  }

  private localDate(value: Date): string {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}
