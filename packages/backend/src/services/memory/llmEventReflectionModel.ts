import type { EventNote } from '@infos/shared'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { EventReflectionModel, ReflectionDecision } from './eventReflectionService'
import { formatEventTime } from './eventMemoryTime'
import { TASK_PROMPTS } from '../prompt/taskPrompts'
import type { MemoryPersonaResolver } from './memoryPersona'

export class LlmEventReflectionModel implements EventReflectionModel {
  constructor(
    private llm: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private getPersona: MemoryPersonaResolver = async (agentId) => ({
      agent_id: agentId,
      agent_name: agentId,
    }),
  ) {}

  async reflect(input: {
    event: EventNote
    candidates: EventNote[]
    signal?: AbortSignal
  }): Promise<ReflectionDecision> {
    const config = await this.getModelConfig()
    if (!config) throw new Error('Reflection模型未配置')
    const persona = await this.getPersona(input.event.agentId, input.event.origin.channel)
    input.signal?.throwIfAborted()
    const output = await this.llm.chatText(
      config,
      [
        {
          role: 'system',
          content: TASK_PROMPTS['memory.reflect']!.body,
        },
        {
          role: 'user',
          content: JSON.stringify(
            { event: input.event, candidates: input.candidates },
            (key, value) =>
              (key === 'eventAt' || key === 'createdAt') && typeof value === 'string'
                ? formatEventTime(value)
                : value,
          ),
        },
      ],
      {
        temperature: 0.1,
        signal: input.signal,
        promptTask: 'memory.reflect',
        promptChannel: input.event.origin.channel,
        promptVariables: persona,
        promptSources: ['persona_definition', 'channel_patch'],
        maxTokens: 1500,
        usageContext: { agentId: input.event.agentId, purpose: 'memory' },
      },
    )
    const cleaned = output
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    const value = JSON.parse(cleaned) as Partial<ReflectionDecision>
    const allowed = new Set(['caused_by', 'same_event', 'same_topic'])
    const links = Array.isArray(value.links)
      ? value.links.filter(
          (link) => link && typeof link.targetId === 'string' && allowed.has(link.relation),
        )
      : []
    const removeLinks = Array.isArray(value.removeLinks)
      ? value.removeLinks.filter(
          (link) => link && typeof link.targetId === 'string' && allowed.has(link.relation),
        )
      : []
    const revision =
      value.revision && typeof value.revision === 'object' ? value.revision : undefined
    const archiveOverlaps = Array.isArray(value.archiveOverlaps)
      ? value.archiveOverlaps.filter((id): id is string => typeof id === 'string')
      : []
    return {
      links: links as ReflectionDecision['links'],
      removeLinks: removeLinks as ReflectionDecision['removeLinks'],
      archive: value.archive === true,
      revision,
      archiveOverlaps,
    }
  }
}
