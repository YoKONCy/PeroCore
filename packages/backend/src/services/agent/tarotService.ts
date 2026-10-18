import {
  DEFAULT_CHARACTER_STATE,
  getTarotCard,
  tarotMeaning,
  type TarotInterpretation,
} from '@infos/shared'
import type { AppContext } from '../../container'
import { AppError } from '../../lib/appError'
import { TarotRepository } from '../../repositories/tarot.repo'
import { ModelRepository } from '../../repositories/model.repo'
import { ModelRoleResolver } from '../llm/modelRoles'

/** 使用浏览器的 IANA 时区计算服务端日期，避免跨 UTC 午夜意外重抽。 */
export function tarotDay(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  return ['year', 'month', 'day']
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join('-')
}

type Dependencies = Pick<
  AppContext,
  'db' | 'configRepo' | 'agentManager' | 'petStateService' | 'llmService'
>
export class TarotService {
  private readonly repo: TarotRepository
  private readonly models: ModelRoleResolver
  private readonly pending = new Map<string, Promise<TarotInterpretation>>()
  constructor(private readonly deps: Dependencies) {
    this.repo = new TarotRepository(deps.db)
    this.models = new ModelRoleResolver(deps.configRepo, new ModelRepository(deps.db))
  }

  private agent(agentId: string) {
    const agent = this.deps.agentManager.getAgentDetail(agentId)
    if (!agent?.isEnabled) throw new AppError('NOT_FOUND', { message: '这个角色暂时无法参与抽牌' })
    return agent
  }

  today(agentId: string, timeZone: string) {
    const agent = this.agent(agentId)
    return this.repo.today(tarotDay(timeZone), agent.id)
  }

  history(agentId: string) {
    return this.repo.history(this.agent(agentId).id)
  }

  async draw(agentId: string, timeZone: string, question: string, threadId?: string) {
    const agent = this.agent(agentId)
    const state = await this.deps.petStateService.get(agent.id, threadId)
    return this.repo.draw(
      {
        day: tarotDay(timeZone),
        timeZone,
        agentId: agent.id,
        agentName: agent.name,
        question,
        characterState: {
          mood: state?.mood ?? DEFAULT_CHARACTER_STATE.mood,
          vibe: state?.vibe ?? DEFAULT_CHARACTER_STATE.vibe,
          mind: state?.mind ?? DEFAULT_CHARACTER_STATE.mind,
        },
      },
      `${agent.systemPrompt}\n${agent.channelPatches.desktop ?? ''}\n对用户的称呼：${agent.ownerAppellation}`,
    )
  }

  interpret(id: string): Promise<TarotInterpretation> {
    const existing = this.pending.get(id)
    if (existing) return existing
    const promise = this.generate(id).finally(() => this.pending.delete(id))
    this.pending.set(id, promise)
    return promise
  }

  private async generate(id: string): Promise<TarotInterpretation> {
    const saved = this.repo.get(id)
    if (!saved) throw new AppError('NOT_FOUND', { message: '没有找到这次抽牌记录' })
    const { reading, persona } = saved
    this.agent(reading.agentId)
    if (reading.interpretation) return { reading, unavailable: false }
    try {
      const model = await this.models.resolveAgent(reading.agentId)
      if (!model) return { reading, unavailable: true }
      const describe = (draw: typeof reading.userCard) => ({
        name: getTarotCard(draw.cardId).name,
        orientation: draw.reversed ? '逆位' : '正位',
        meaning: tarotMeaning(draw),
        invitation: getTarotCard(draw.cardId).invitation,
      })
      const response = await this.deps.llmService.chat(
        model,
        [
          {
            role: 'user',
            content: JSON.stringify({
              日期: reading.day,
              用户的问题: reading.question || '没有特定问题，只想和你待一会儿',
              用户的牌: describe(reading.userCard),
              你的回应牌: describe(reading.companionCard),
              抽牌时的状态: reading.characterState,
            }),
          },
        ],
        {
          promptTask: 'companion.tarot',
          promptVariables: { agent_id: reading.agentId, persona_definition: persona },
          usageContext: { agentId: reading.agentId, purpose: 'system' },
          maxTokens: 900,
          maxRetries: 0,
          signal: AbortSignal.timeout(60_000),
        },
      )
      const content = response.choices[0]?.message.content?.trim()
      if (!content || content.length > 4000) return { reading, unavailable: true }
      return { reading: this.repo.saveInterpretation(id, content), unavailable: false }
    } catch {
      return { reading, unavailable: true }
    }
  }
}
