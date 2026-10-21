import type { EventNoteDraftInput } from '@infos/shared'
import type { LlmService } from '../llm/llmService'
import type { ModelConfig } from '../llm/llmService'
import type { BackgroundEventExtractor } from './eventMemoryFallbackService'
import { formatEventTime } from './eventMemoryTime'
import { TASK_PROMPTS } from '../prompt/taskPrompts'
import { tokenCounter } from '../tokenizer/tokenCounter'
import type { MemoryPersonaResolver } from './memoryPersona'

export class LlmBackgroundEventExtractor implements BackgroundEventExtractor {
  constructor(
    private llm: LlmService,
    private getModelConfig: () => Promise<ModelConfig | null>,
    private getPersona: MemoryPersonaResolver = async (agentId) => ({
      agent_id: agentId,
      agent_name: agentId,
    }),
  ) {}

  async promptTokens(agentId: string, channel: string): Promise<number> {
    const variables = await this.getPersona(agentId, channel)
    const messages = this.llm.preparePromptMessages([], {
      promptTask: 'memory.extract',
      promptChannel: channel,
      promptVariables: variables,
      promptSources: ['persona_definition', 'channel_patch'],
      usageContext: { agentId, purpose: 'memory' },
    })
    // 额外预留来源标识和每批时间戳的包裹开销。
    return tokenCounter.countMessages(messages) + 256
  }

  async extract(
    input: Parameters<BackgroundEventExtractor['extract']>[0],
  ): Promise<EventNoteDraftInput[]> {
    const config = await this.getModelConfig()
    if (!config) throw new Error('后台事件补记模型未配置')
    const persona = await this.getPersona(input.agentId, input.channel)
    input.signal?.throwIfAborted()
    const transcript = input.messages
      .map(
        (message) => `[${formatEventTime(message.timestamp)}] ${message.role}: ${message.content}`,
      )
      .join('\n')
    const text = await this.llm.chatText(
      config,
      [
        {
          role: 'system',
          content: TASK_PROMPTS['memory.extract']!.body,
        },
        {
          role: 'user',
          content: `Agent: ${input.agentId}\nThread: ${input.threadId}\n原始连续对话：\n${transcript}`,
        },
      ],
      {
        temperature: 0.2,
        signal: input.signal,
        promptTask: 'memory.extract',
        promptChannel: input.channel,
        promptVariables: persona,
        promptSources: ['persona_definition', 'channel_patch'],
        maxTokens: 2000,
        usageContext: { agentId: input.agentId, purpose: 'memory' },
      },
    )
    input.signal?.throwIfAborted()
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
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('后台事件补记条目格式无效')
    const item = value as Record<string, unknown>
    const narrative = typeof item.narrative === 'string' ? item.narrative.trim() : ''
    if (!narrative) throw new Error('后台事件补记缺少有效记叙或重要度')
    if (item.affect != null && (typeof item.affect !== 'object' || Array.isArray(item.affect))) {
      throw new Error('后台事件补记情感字段格式无效')
    }
    const affect = (item.affect ?? {}) as Record<string, unknown>
    // 修正模型的数字字符串与小数；缺失情绪按中性、平静处理，不放过无效数值。
    const score = (input: unknown, field: string, fallback?: number): number => {
      if (input == null && fallback !== undefined) return fallback
      const number =
        typeof input === 'number'
          ? input
          : typeof input === 'string' && input.trim() !== ''
            ? Number(input)
            : NaN
      if (!Number.isFinite(number)) throw new Error(`后台事件补记缺少有效数值：${field}`)
      return Math.max(0, Math.min(10, Math.round(number)))
    }
    const strings = (input: unknown): string[] =>
      Array.isArray(input)
        ? input.filter((entry): entry is string => typeof entry === 'string')
        : []
    return {
      narrative,
      importance: score(item.importance, 'importance'),
      affect: {
        tones: strings(affect.tones ?? item.tones),
        valence: score(affect.valence ?? item.valence, 'affect.valence', 5),
        arousal: score(affect.arousal ?? item.arousal, 'affect.arousal', 0),
      },
      participants: strings(item.participants),
      places: strings(item.places),
      objects: strings(item.objects),
      topics: strings(item.topics),
    }
  }
}
