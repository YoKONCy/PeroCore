import type { EventNoteDraftInput, EventNoteRelation } from '@infos/shared'
import type { BuiltinTool } from '../index'
import type { EventMemoryService } from '../../services/memory/eventMemoryService'

let eventMemoryService: EventMemoryService | null = null

export function setEventMemoryToolDeps(service: EventMemoryService): void {
  eventMemoryService = service
}

function validateDraft(args: Record<string, unknown>): EventNoteDraftInput {
  const narrative = typeof args.narrative === 'string' ? args.narrative.trim() : ''
  const importance = args.importance
  const affect = args.affect as Record<string, unknown> | undefined
  if (!narrative) throw new Error('事件记叙不能为空')
  if (!Number.isInteger(importance) || Number(importance) < 0 || Number(importance) > 10) {
    throw new Error('事件重要度必须是0到10的整数')
  }
  if (!affect || !Number.isInteger(affect.valence) || !Number.isInteger(affect.arousal)) {
    throw new Error('事件情感数值必须是0到10的整数')
  }
  if (
    Number(affect.valence) < 0 ||
    Number(affect.valence) > 10 ||
    Number(affect.arousal) < 0 ||
    Number(affect.arousal) > 10
  ) {
    throw new Error('事件情感数值必须是0到10的整数')
  }
  const scope = args.scope ?? 'current_pair'
  if (scope !== 'current_pair' && scope !== 'current_uncovered_segment')
    throw new Error('事件覆盖范围无效')
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return {
    narrative,
    importance: Number(importance),
    affect: {
      tones: strings(affect.tones),
      valence: Number(affect.valence),
      arousal: Number(affect.arousal),
    },
    participants: strings(args.participants),
    places: strings(args.places),
    objects: strings(args.objects),
    topics: strings(args.topics),
    scope,
  }
}

export const writeEventNoteTool: BuiltinTool = {
  name: 'write_event_note',
  async execute(args) {
    return JSON.stringify({
      accepted: true,
      draft: validateDraft(args),
      commit: 'after_assistant_persisted',
    })
  },
}

export const reviseEventNoteTool: BuiltinTool = {
  name: 'revise_event_note',
  async execute(args) {
    const targetId = typeof args.targetId === 'string' ? args.targetId.trim() : ''
    if (!targetId) throw new Error('修订事件必须指定目标EventNote ID')
    return JSON.stringify({
      accepted: true,
      targetId,
      draft: validateDraft(args),
      commit: 'after_assistant_persisted',
    })
  },
}

export const queryEventNotesTool: BuiltinTool = {
  name: 'query_event_notes',
  async execute(args, ctx) {
    if (!eventMemoryService) return JSON.stringify({ error: '事件记忆服务未初始化' })
    const edgeLabels = Array.isArray(args.edgeLabels)
      ? args.edgeLabels.filter(
          (label): label is EventNoteRelation =>
            typeof label === 'string' &&
            [
              'temporal_next',
              'temporal_prev',
              'caused_by',
              'same_event',
              'same_topic',
              'involves_person',
              'involves_place',
              'involves_object',
            ].includes(label),
        )
      : undefined
    const result = await eventMemoryService.queryDetailed({
      agentId: ctx.agentId,
      query: typeof args.query === 'string' ? args.query : undefined,
      mode: typeof args.mode === 'string' ? (args.mode as never) : 'mixed',
      from: typeof args.from === 'string' ? args.from : undefined,
      to: typeof args.to === 'string' ? args.to : undefined,
      includeArchived: args.includeArchived === true,
      limit: typeof args.limit === 'number' ? args.limit : 10,
      maxDepth: typeof args.maxDepth === 'number' ? args.maxDepth : undefined,
      maxNodes: typeof args.maxNodes === 'number' ? args.maxNodes : undefined,
      maxReturnTokens: typeof args.maxReturnTokens === 'number' ? args.maxReturnTokens : undefined,
      edgeLabels,
      direction:
        args.direction === 'incoming' || args.direction === 'outgoing' || args.direction === 'both'
          ? args.direction
          : undefined,
    })
    return JSON.stringify({ total: result.notes.length, ...result })
  },
}
