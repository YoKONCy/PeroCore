import type { EventNoteDraftInput } from '@infos/shared'
import type { ToolCallRecord } from '../pipeline/types'
import type { ThreadRepository } from '../../repositories/thread.repo'
import type { EventNoteRepository } from '../../repositories/eventNote.repo'
import type { EventMemoryService } from './eventMemoryService'

interface DraftEnvelope {
  action: 'write' | 'revise'
  targetId?: string
  draft: EventNoteDraftInput
}

export class EventNoteDraftCommitter {
  constructor(
    private eventMemory: EventMemoryService,
    private eventRepo: EventNoteRepository,
    private threads: ThreadRepository,
  ) {}

  async commit(params: {
    toolCalls: ToolCallRecord[]
    agentId: string
    threadId: string
    pairId: string
    channel: string
    assistantMessageId: number
    assistantTimestamp: string | number | Date
  }): Promise<void> {
    const drafts = params.toolCalls.flatMap((call) => this.parseDraft(call))
    for (const [index, envelope] of drafts.entries()) {
      const pairIds = await this.resolvePairIds(
        params.agentId,
        params.threadId,
        params.pairId,
        envelope.draft.scope ?? 'current_pair',
      )
      const ownerId = `active:${params.assistantMessageId}:${index}`
      const claimed = await this.eventRepo.claimCoverageRange({
        agentId: params.agentId,
        threadId: params.threadId,
        pairIds,
        ownerId,
        staleBefore: new Date(Date.now() - 30 * 60_000).toISOString(),
      })
      if (!claimed) throw new Error(`事件覆盖范围已被处理或占用: ${pairIds.join(',')}`)
      const messages = await this.threads.findMessagesByPairIds(params.threadId, pairIds)
      const messageIds = messages.map((message) => String(message.id))
      if (!messageIds.includes(String(params.assistantMessageId)))
        messageIds.push(String(params.assistantMessageId))
      const input = {
        ...envelope.draft,
        agentId: params.agentId,
        eventAt: new Date(params.assistantTimestamp).toISOString(),
        origin: {
          mode: 'active' as const,
          threadId: params.threadId,
          pairIds,
          messageIds,
          channel: params.channel,
        },
      }
      const operationId = `event-note:${params.pairId}:${envelope.action}:${envelope.targetId ?? index}`
      try {
        if (envelope.action === 'revise') {
          if (!envelope.targetId) throw new Error('修订事件必须指定目标EventNote ID')
          await this.eventMemory.revise(envelope.targetId, input, operationId, {
            coverageOwnerId: ownerId,
          })
        } else {
          await this.eventMemory.create(input, operationId, { coverageOwnerId: ownerId })
        }
      } finally {
        await this.eventRepo.releaseCoverageClaim(ownerId)
      }
    }
  }

  private parseDraft(call: ToolCallRecord): DraftEnvelope[] {
    if (call.isError) return []
    if (call.name === 'write_event_note') {
      return [{ action: 'write', draft: this.validateDraft(call.args) }]
    }
    if (call.name === 'revise_event_note') {
      const { targetId, ...draft } = call.args
      if (typeof targetId !== 'string' || !targetId.trim()) {
        throw new Error('修订事件必须指定目标EventNote ID')
      }
      return [{ action: 'revise', targetId, draft: this.validateDraft(draft) }]
    }
    return []
  }

  private validateDraft(value: Record<string, unknown>): EventNoteDraftInput {
    const narrative = typeof value.narrative === 'string' ? value.narrative.trim() : ''
    const importance = value.importance
    const affect = value.affect
    if (!narrative) throw new Error('事件记叙不能为空')
    if (!Number.isInteger(importance) || Number(importance) < 0 || Number(importance) > 10) {
      throw new Error('事件重要度必须是0到10的整数')
    }
    if (!affect || typeof affect !== 'object') throw new Error('事件情感信息不能为空')
    const affectValue = affect as Record<string, unknown>
    const valence = affectValue.valence
    const arousal = affectValue.arousal
    if (!Number.isInteger(valence) || Number(valence) < 0 || Number(valence) > 10) {
      throw new Error('情感效价必须是0到10的整数')
    }
    if (!Number.isInteger(arousal) || Number(arousal) < 0 || Number(arousal) > 10) {
      throw new Error('情感唤醒度必须是0到10的整数')
    }
    const scope = value.scope ?? 'current_pair'
    if (scope !== 'current_pair' && scope !== 'current_uncovered_segment') {
      throw new Error('事件覆盖范围无效')
    }
    const strings = (input: unknown): string[] =>
      Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []
    return {
      narrative,
      importance: Number(importance),
      affect: {
        tones: strings(affectValue.tones),
        valence: Number(valence),
        arousal: Number(arousal),
      },
      participants: strings(value.participants),
      places: strings(value.places),
      objects: strings(value.objects),
      topics: strings(value.topics),
      scope,
    }
  }

  private async resolvePairIds(
    agentId: string,
    threadId: string,
    currentPairId: string,
    scope: EventNoteDraftInput['scope'],
  ): Promise<string[]> {
    if (scope !== 'current_uncovered_segment') return [currentPairId]
    const covered = await this.eventRepo.coveredPairIds(agentId, threadId)
    const messages = await this.threads.queryActiveMessagePairs(threadId, 500)
    const ordered = [
      ...new Set(
        messages.map((message) => message.pairId).filter((id): id is string => Boolean(id)),
      ),
    ]
    const currentIndex = ordered.indexOf(currentPairId)
    if (currentIndex < 0) return [currentPairId]
    const segment: string[] = []
    for (let index = currentIndex; index >= 0; index--) {
      const pairId = ordered[index]!
      if (covered.has(pairId)) break
      segment.unshift(pairId)
    }
    return segment.length ? segment : [currentPairId]
  }
}
