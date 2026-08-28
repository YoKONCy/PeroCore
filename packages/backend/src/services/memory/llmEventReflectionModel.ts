import type { EventNote } from '@infos/shared'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { EventReflectionModel, ReflectionDecision } from './eventReflectionService'

export class LlmEventReflectionModel implements EventReflectionModel {
  constructor(
    private llm: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
  ) {}

  async reflect(input: { event: EventNote; candidates: EventNote[] }): Promise<ReflectionDecision> {
    const config = await this.getModelConfig()
    if (!config) throw new Error('Reflection模型未配置')
    const output = await this.llm.chatText(
      config,
      [
        {
          role: 'system',
          content:
            '维护Agent事件记忆关系图。只允许caused_by、same_event、same_topic。caused_by必须有明确因果，时间先后或相似不够。archive只能在事件错误、被更完整事件高度覆盖或不应继续普通检索时为true，且不可恢复。revision仅用于修复主事件的记叙、重要度、情感或结构化标签；archiveOverlaps仅列出被主事件高度覆盖且应归档的候选ID。返回严格JSON：{"links":[],"removeLinks":[],"archive":false,"revision":null,"archiveOverlaps":[]}。',
        },
        { role: 'user', content: JSON.stringify(input) },
      ],
      { temperature: 0.1, maxTokens: 1500 },
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
