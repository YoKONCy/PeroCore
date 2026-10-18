import {
  DEFAULT_STATUS_CARD_DESIGN,
  parseStatusCardDesign,
  type StatusCardDesign,
  type SocialStatusCardPort,
} from '@infos/shared'

interface CardConfigPort {
  get(key: string): Promise<string | null | undefined>
  set(key: string, value: string): Promise<unknown>
}

/** 社交应用持有设计；宿主只通过收窄输出口提供实时快照与图片。 */
export class SocialStatusCardService {
  constructor(
    private readonly config: CardConfigPort,
    private readonly renderer: SocialStatusCardPort | undefined,
  ) {}

  async getDesign(agentId: string): Promise<StatusCardDesign> {
    const raw = await this.config.get(`social.status-card.${agentId}`)
    if (!raw) return parseStatusCardDesign(DEFAULT_STATUS_CARD_DESIGN)
    return parseStatusCardDesign(JSON.parse(raw))
  }

  async saveDesign(agentId: string, value: unknown): Promise<StatusCardDesign> {
    const design = parseStatusCardDesign(value)
    await this.config.set(`social.status-card.${agentId}`, JSON.stringify(design))
    return design
  }

  async render(hostAgentId: string, design: unknown) {
    if (!this.renderer) throw new Error('状态卡片服务未就绪')
    return this.renderer.render(hostAgentId, parseStatusCardDesign(design))
  }
}
