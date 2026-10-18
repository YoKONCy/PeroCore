import { createHash, randomUUID } from 'node:crypto'
import type { EventNoteDraftInput, MemoryBackgroundPolicy } from '@infos/shared'
import { MemoryBackgroundControl } from './memoryBackgroundControl'
import type { EventNoteRepository } from '../../repositories/eventNote.repo'
import type { ThreadRepository } from '../../repositories/thread.repo'
import type { EventMemoryService } from './eventMemoryService'
import type { ModelConfig } from '../llm/llmService'
import { tokenCounter } from '../tokenizer/tokenCounter'
import { createLogger } from '../../lib/logger'
import { localMemoryDate } from './eventMemoryTime'

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
    signal?: AbortSignal
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

type MemoryMessage = Awaited<ReturnType<ThreadRepository['findMessagesByPairIds']>>[number]

export interface EventMemoryFallbackOptions {
  background?: MemoryBackgroundPolicy
  agentSilenceSeconds?: number
  threadIdleSeconds?: number
  safeInputTokens?: number
  getModelConfig?: () => Promise<ModelConfig | null>
  reservedPromptTokens?: number
  reservedOutputTokens?: number
  capacityRatio?: number
  cooldownSeconds?: number
  retrySeconds?: number
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
  private queued = new Map<string, PendingTask>()
  private lastTickMs?: number
  private ticking?: Promise<void>
  private draining?: Promise<void>
  private scanIncomplete = false
  private readonly options: Required<EventMemoryFallbackOptions>

  constructor(
    private repo: EventNoteRepository,
    private threads: ThreadRepository,
    private eventMemory: EventMemoryService,
    private extractor: BackgroundEventExtractor,
    options: EventMemoryFallbackOptions = {},
  ) {
    this.options = {
      background: options.background ?? new MemoryBackgroundControl(),
      agentSilenceSeconds: options.agentSilenceSeconds ?? 6 * 60 * 60,
      threadIdleSeconds: options.threadIdleSeconds ?? 2 * 60 * 60,
      safeInputTokens: options.safeInputTokens ?? 0,
      getModelConfig: options.getModelConfig ?? (async () => null),
      reservedPromptTokens: options.reservedPromptTokens ?? 4_000,
      reservedOutputTokens: options.reservedOutputTokens ?? 2_000,
      capacityRatio: options.capacityRatio ?? 0.8,
      cooldownSeconds: options.cooldownSeconds ?? 60 * 60,
      retrySeconds: options.retrySeconds ?? 5 * 60,
      now: options.now ?? (() => new Date()),
    }
  }

  tick(enabledAgentIds: string[]): Promise<void> {
    if (!this.options.background.enabled) {
      this.queued.clear()
      this.lastTickMs = undefined
      return Promise.resolve()
    }
    if (this.ticking) return this.ticking
    const signal = this.options.background.signal
    this.ticking = this.scan(enabledAgentIds)
      .catch((error) => {
        if (!signal.aborted) throw error
      })
      .finally(() => {
        this.ticking = undefined
      })
    return this.ticking
  }

  get hasPendingWork(): boolean {
    return this.scanIncomplete || this.queued.size > 0
  }

  private async scan(enabledAgentIds: string[]): Promise<void> {
    if (!this.options.background.enabled) return
    const signal = this.options.background.signal
    this.scanIncomplete = false
    const now = this.options.now()
    const deltaSeconds = this.activeDeltaSeconds(now.getTime())
    const boundary = now.getHours() >= 21 ? localMemoryDate(now) : ''
    const capacity = await this.capacityTokens()
    for (const agentId of enabledAgentIds) {
      signal.throwIfAborted()
      const silenceKey = `agent-silence:${agentId}`
      const silence = await this.repo.advanceTimer(silenceKey, deltaSeconds)
      for (let page = 1; ; page++) {
        signal.throwIfAborted()
        const result = await this.threads.listThreads({
          agentId,
          purpose: 'conversation',
          pageSize: 100,
          page,
        })
        for (const thread of result.items) {
          signal.throwIfAborted()
          const messages = await this.threads.queryActiveMessagePairs(thread.id, 10_000)
          const covered = await this.repo.coveredPairIds(agentId, thread.id)
          const segments = this.eligibleSegments(messages, covered)
          if (!segments.length) continue

          const idleKey = `thread-idle:${agentId}:${thread.id}`
          const lastMessage = new Date(thread.lastMessageAt ?? '')
          const idle = await this.repo.advanceTimer(
            idleKey,
            deltaSeconds,
            Number.isFinite(lastMessage.getTime()) ? lastMessage.toISOString() : undefined,
          )
          const scheduleKey = `${agentId}:${thread.id}`
          if ((await this.repo.memoryScheduleTime(`retry:${scheduleKey}`)) > now.getTime()) {
            this.scanIncomplete = true
            continue
          }
          const lastReview = await this.repo.memoryScheduleTime(`review:${scheduleKey}`)
          const cooling =
            lastReview > 0 && now.getTime() - lastReview < this.options.cooldownSeconds * 1000
          const reviewedToday =
            lastReview > 0 &&
            localMemoryDate(new Date(lastReview)) === boundary &&
            new Date(lastReview).getHours() >= 21
          const tokenEstimate = segments.reduce(
            (sum, segment) => sum + this.estimatePairTokens(messages, segment),
            0,
          )
          let reason: BackgroundMemoryReason | undefined
          if (tokenEstimate >= capacity) reason = 'capacity'
          else if (segments.some((segment) => segment.length >= SCORER_BATCH_SIZE)) {
            reason = 'scorer_batch'
          } else if (boundary && !reviewedToday) reason = 'day_boundary'
          else if (!cooling) {
            if (idle >= this.options.threadIdleSeconds) reason = 'thread_idle'
            else if (silence >= this.options.agentSilenceSeconds) reason = 'agent_silence'
          }
          if (reason) {
            for (const segment of segments) {
              for (const pairIds of this.sliceByCapacity(messages, segment, capacity)) {
                this.enqueue(agentId, thread.id, thread.channel, pairIds, reason)
              }
            }
          }
        }
        if (page * 100 >= result.total || !result.items.length) break
      }
    }
    await this.drain()
  }

  async ensureContextWindowCoverage(input: {
    agentId: string
    threadId: string
    channel: string
    contextPairs: number
  }): Promise<void> {
    if (!this.options.background.enabled) return
    const signal = this.options.background.signal
    const scheduleKey = `${input.agentId}:${input.threadId}`
    if ((await this.repo.memoryScheduleTime(`retry:${scheduleKey}`)) > this.options.now().getTime())
      return
    try {
      await this.coverEvictedPairs(input)
    } catch (error) {
      if (signal.aborted) return
      await this.repo.setMemoryScheduleTime(
        `retry:${scheduleKey}`,
        this.options.now().getTime() + this.options.retrySeconds * 1000,
      )
      logger.warn('窗口旧对话补记暂不可用，当前对话继续', { threadId: input.threadId, error })
    }
  }

  private async coverEvictedPairs(input: {
    agentId: string
    threadId: string
    channel: string
    contextPairs: number
  }): Promise<void> {
    const messages = await this.threads.queryActiveMessagePairs(input.threadId, 10_000)
    // 窗口包含当前尚未回复的轮次；只处理真正滑出窗口的完整旧轮次。
    const pairs = [
      ...new Set(messages.map((message) => message.pairId ?? `__message__:${message.id}`)),
    ]
    const covered = await this.repo.coveredPairIds(input.agentId, input.threadId)
    const contextPairs = Math.max(1, Math.floor(input.contextPairs))
    const evicted = new Set(pairs.slice(0, Math.max(0, pairs.length - contextPairs)))
    const segments = this.eligibleSegments(messages, covered)
      .map((segment) => segment.filter((pairId) => evicted.has(pairId)))
      .filter((segment) => segment.length)
    // 少量尾巴由休眠、日界兜底补齐，避免窗口满后每说一句就炼化一次。
    if (segments.reduce((sum, segment) => sum + segment.length, 0) < SCORER_BATCH_SIZE) return

    const capacity = await this.capacityTokens()
    for (const segment of segments) {
      for (const pairIds of this.sliceByCapacity(messages, segment, capacity)) {
        this.enqueue(input.agentId, input.threadId, input.channel, pairIds, 'context_window')
      }
    }
    await this.drain()
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

  private completedPairs(messages: MemoryMessage[]): string[] {
    const users = new Set(
      messages.filter((message) => message.role === 'user').map((message) => message.pairId),
    )
    const assistants = new Set(
      messages.filter((message) => message.role === 'assistant').map((message) => message.pairId),
    )
    return [...new Set(messages.map((message) => message.pairId))].filter(
      (id): id is string => Boolean(id) && users.has(id) && assistants.has(id),
    )
  }

  private eligibleSegments(messages: MemoryMessage[], covered: Set<string>): string[][] {
    const ordered = [...new Set(messages.map((message) => message.pairId))].filter(
      (id): id is string => Boolean(id),
    )
    const complete = new Set(this.completedPairs(messages))
    // 缺少回复的轮次也是分隔线，不能把两侧不连续的对话拼成一个事件。
    const blocked = new Set([...covered, ...ordered.filter((id) => !complete.has(id))])
    return this.uncoveredSegments(ordered, blocked)
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

  private drain(): Promise<void> {
    if (this.draining) return this.draining
    this.draining = this.processQueue().finally(() => {
      this.draining = undefined
    })
    return this.draining
  }

  private async processQueue(): Promise<void> {
    const signal = this.options.background.signal
    // 每个任务每轮至多尝试一次；失败项留待退避到期，新拆分区间可以继续处理。
    const visited = new Set<string>()
    for (;;) {
      if (signal.aborted || !this.options.background.enabled) return
      const tasks = [...this.queued.values()]
        .filter((task) => !visited.has(task.key))
        .sort((a, b) => b.priority - a.priority)
      if (!tasks.length) break
      for (const task of tasks) {
        if (signal.aborted || !this.options.background.enabled) return
        visited.add(task.key)
        const scheduleKey = `${task.agentId}:${task.threadId}`
        if (
          (await this.repo.memoryScheduleTime(`retry:${scheduleKey}`)) >
          this.options.now().getTime()
        )
          continue
        this.queued.delete(task.key)
        if (
          task.reason === 'agent_silence' &&
          (await this.repo.readTimer(`agent-silence:${task.agentId}`)) <
            this.options.agentSilenceSeconds
        )
          continue
        try {
          if (await this.process(task, signal)) {
            await this.repo.setMemoryScheduleTime(
              `review:${scheduleKey}`,
              this.options.now().getTime(),
            )
            await this.repo.setMemoryScheduleTime(`retry:${scheduleKey}`, 0)
            await this.repo.resetTimer(`fallback-failures:${scheduleKey}`)
          }
        } catch (error) {
          if (signal.aborted) return
          const failures = await this.repo.advanceTimer(`fallback-failures:${scheduleKey}`, 1)
          const delay = Math.min(
            60 * 60,
            this.options.retrySeconds * 2 ** Math.min(failures - 1, 8),
          )
          await this.repo.setMemoryScheduleTime(
            `retry:${scheduleKey}`,
            this.options.now().getTime() + delay * 1000,
          )
          this.queued.set(task.key, task)
          logger.warn('后台事件提炼失败，已延迟重试', {
            agentId: task.agentId,
            threadId: task.threadId,
            retrySeconds: delay,
            error,
          })
        }
      }
    }
  }

  private async process(task: PendingTask, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted()
    // 入队后可能已由主动记忆覆盖，或被用户删除、编辑；执行前重新读取。
    const thread = await this.threads.getThread(task.threadId)
    if (!thread || thread.status !== 'active' || thread.agentId !== task.agentId) return false
    const covered = await this.repo.coveredPairIds(task.agentId, task.threadId)
    const available = await this.threads.findMessagesByPairIds(task.threadId, task.pairIds)
    const complete = new Set(this.completedPairs(available))
    const pairIds = task.pairIds.filter((id) => !covered.has(id) && complete.has(id))
    if (!pairIds.length) return false
    const blocked = new Set(task.pairIds.filter((id) => !pairIds.includes(id)))
    const segments = this.uncoveredSegments(task.pairIds, blocked)
    if (segments.length > 1) {
      for (const segment of segments)
        this.enqueue(task.agentId, task.threadId, task.channel, segment, task.reason)
      return false
    }
    const selected = new Set(pairIds)
    const messages = available.filter((message) => message.pairId && selected.has(message.pairId))
    const revision = this.messageRevision(messages)
    const ownerId = `background:${task.key}:${randomUUID()}`
    const staleBefore = new Date(this.options.now().getTime() - 30 * 60_000).toISOString()
    const claimed = await this.repo.claimCoverageRange({
      agentId: task.agentId,
      threadId: task.threadId,
      pairIds,
      ownerId,
      staleBefore,
    })
    if (!claimed) return false
    logger.info(
      `开始后台事件提炼: agent=${task.agentId}, thread=${task.threadId}, pairs=${pairIds.length}, reason=${task.reason}`,
    )
    try {
      const extractionId = `background:extract:${task.agentId}:${task.threadId}:${revision}`
      signal.throwIfAborted()
      const saved = await this.repo.findOperation(extractionId)
      const pending = saved?.payload as { drafts: EventNoteDraftInput[] } | undefined
      const drafts =
        pending?.drafts ??
        (await this.extractor.extract({
          signal,
          agentId: task.agentId,
          threadId: task.threadId,
          channel: task.channel,
          messages: messages.map((message) => ({
            role: message.role,
            content: message.content,
            timestamp: message.timestamp ?? new Date().toISOString(),
            pairId: message.pairId,
          })),
        }))
      signal.throwIfAborted()
      const latest = await this.threads.findMessagesByPairIds(task.threadId, pairIds)
      const currentThread = await this.threads.getThread(task.threadId)
      if (
        !currentThread ||
        currentThread.status !== 'active' ||
        this.messageRevision(latest) !== revision
      ) {
        this.scanIncomplete = true
        logger.info('对话在提炼期间发生变化，已放弃旧结果', { threadId: task.threadId })
        return false
      }
      // 先保存提炼结果；向量写入等后续操作失败时沿用原结果，不重复调用模型。
      if (!saved)
        await this.repo.createOperation(extractionId, task.agentId, 'background_extraction', {
          drafts,
        })
      const messageIds = messages.map((message) => String(message.id))
      signal.throwIfAborted()
      if (!drafts.length) {
        await this.repo.commitCoverageUnderClaim(
          {
            id: randomUUID(),
            agentId: task.agentId,
            threadId: task.threadId,
            pairIds,
            messageIds,
            outcome: 'reviewed_no_event',
            eventNoteIds: [],
            mode: 'background',
            coveredAt: new Date().toISOString(),
          },
          ownerId,
        )
        logger.info(
          `后台事件提炼完成，未发现长期事件: agent=${task.agentId}, pairs=${pairIds.length}`,
        )
        await this.repo.markOperationCommitted(extractionId)
        return true
      }
      const eventAt = new Date(messages.at(-1)!.timestamp ?? new Date()).toISOString()
      const notes = []
      for (const [index, draft] of drafts.entries()) {
        signal.throwIfAborted()
        notes.push(
          await this.eventMemory.create(
            {
              ...draft,
              agentId: task.agentId,
              eventAt,
              origin: {
                mode: 'background',
                threadId: task.threadId,
                pairIds,
                messageIds,
                channel: task.channel,
              },
            },
            `background:${task.agentId}:${task.threadId}:${revision}:${index}`,
            { deferCoverage: true, signal },
          ),
        )
      }
      signal.throwIfAborted()
      await this.repo.commitCoverageUnderClaim(
        {
          id: randomUUID(),
          agentId: task.agentId,
          threadId: task.threadId,
          pairIds,
          messageIds,
          outcome: 'event_recorded',
          eventNoteIds: notes.map((note) => note.id),
          mode: 'background',
          coveredAt: new Date().toISOString(),
        },
        ownerId,
      )
      logger.info(
        `后台事件提炼完成: agent=${task.agentId}, pairs=${pairIds.length}, events=${notes.length}`,
      )
      await this.repo.markOperationCommitted(extractionId)
      return true
    } finally {
      await this.repo.releaseCoverageClaim(ownerId)
    }
  }

  private messageRevision(messages: MemoryMessage[]): string {
    return createHash('sha256')
      .update(
        JSON.stringify(
          messages.map((message) => [
            message.id,
            message.pairId,
            message.role,
            message.revision,
            message.content,
          ]),
        ),
      )
      .digest('hex')
  }
}
