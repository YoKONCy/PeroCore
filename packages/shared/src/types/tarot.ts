export type TarotSuit = 'major' | 'wands' | 'cups' | 'swords' | 'pentacles'

export interface TarotCard {
  id: string
  name: string
  number: number
  suit: TarotSuit
  icon: string
  keywords: string
  upright: string
  reversed: string
  invitation: string
}

export interface TarotDraw {
  cardId: string
  reversed: boolean
}

/** 抽牌快照和角色回应一并保存；解读失败不会改变牌面。 */
export interface TarotReading {
  id: string
  day: string
  timeZone: string
  agentId: string
  agentName: string
  question: string
  userCard: TarotDraw
  companionCard: TarotDraw
  characterState: { mood: string; vibe: string; mind: string }
  interpretation: string | null
  createdAt: string
}

export interface TarotToday {
  day: string
  question: string
  userCard: TarotDraw | null
  reading: TarotReading | null
}

export interface TarotInterpretation {
  reading: TarotReading
  unavailable: boolean
}
