import type { EventNoteDraftInput } from '@infos/shared'
import type { LlmService } from '../llm/llmService'
import type { ModelConfig } from '../llm/llmService'
import type { BackgroundEventExtractor } from './eventMemoryFallbackService'

export class LlmBackgroundEventExtractor implements BackgroundEventExtractor {
  constructor(
    private llm: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
  ) {}

  async extract(
    input: Parameters<BackgroundEventExtractor['extract']>[0],
  ): Promise<EventNoteDraftInput[]> {
    const config = await this.getModelConfig()
    if (!config) throw new Error('后台事件补记模型未配置')
    const transcript = input.messages
      .map((message) => `[${message.timestamp}] ${message.role}: ${message.content}`)
      .join('\n')
    const text = await this.llm.chatText(
      config,
      [
        {
          role: 'system',
          content:
            '你正在替当前Agent提炼长期事件记忆。判断标准：只记录对未来理解用户、关系或后续行动仍有价值的真实互动，例如稳定偏好与重要事实、承诺与决定、关系变化、共同经历及明显情绪转折；不记录寒暄、临时操作细节、重复信息、未发生的设想或普通问答。叙事标准：使用Agent第一人称，以简洁自然的完整句保留“发生了什么、涉及谁、结果或意义是什么”，不得照抄对话、夸大、推测或虚构。切分标准：一个可独立回忆且具有单一核心结果的事件对应一项；同一目标、连续因果或同一结果应合并，无关目标或独立结果才拆分，避免碎片化。重要度参考：0到3通常不应记录，4到6为有持续价值，7到8为长期重要，9到10仅用于罕见的关键转折。返回严格JSON数组；没有值得记录的事件时返回[]。每项字段为narrative、importance、affect、participants、places、objects、topics；importance、valence、arousal均为0到10整数。',
        },
        {
          role: 'user',
          content: `Agent: ${input.agentId}\nThread: ${input.threadId}\n原始连续对话：\n${transcript}`,
        },
      ],
      { temperature: 0.2, maxTokens: 2000 },
    )
    const parsed = this.parseArray(text)
    return parsed.map((value) => this.validate(value))
  }

  private parseArray(text: string): unknown[] {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
    const value = JSON.parse(cleaned) as unknown
    if (!Array.isArray(value)) throw new Error('后台事件补记结果必须是JSON数组')
    return value
  }

  private validate(value: unknown): EventNoteDraftInput {
    if (!value || typeof value !== 'object') throw new Error('后台事件补记条目格式无效')
    const item = value as Record<string, unknown>
    const narrative = typeof item.narrative === 'string' ? item.narrative.trim() : ''
    const importance = item.importance
    const affect = item.affect as Record<string, unknown> | undefined
    if (!narrative || !Number.isInteger(importance))
      throw new Error('后台事件补记缺少有效记叙或重要度')
    if (!affect || !Number.isInteger(affect.valence) || !Number.isInteger(affect.arousal)) {
      throw new Error('后台事件补记缺少有效情感数值')
    }
    const bounded = (number: unknown): number => Math.max(0, Math.min(10, Number(number)))
    const strings = (input: unknown): string[] =>
      Array.isArray(input)
        ? input.filter((entry): entry is string => typeof entry === 'string')
        : []
    return {
      narrative,
      importance: bounded(importance),
      affect: {
        tones: strings(affect.tones),
        valence: bounded(affect.valence),
        arousal: bounded(affect.arousal),
      },
      participants: strings(item.participants),
      places: strings(item.places),
      objects: strings(item.objects),
      topics: strings(item.topics),
    }
  }
}
