import { and, desc, eq } from 'drizzle-orm'
import { randomInt, randomUUID } from 'node:crypto'
import { TAROT_DECK, type TarotDraw, type TarotReading } from '@infos/shared'
import type { DrizzleDb } from '../database'
import { tarotDays, tarotReadings } from '../database/schema'

/** 服务端随机选牌；先排除用户牌，再从剩余 77 张抽取角色牌。 */
export function drawTarot(excludedId?: string): TarotDraw {
  const cards = TAROT_DECK.filter((card) => card.id !== excludedId)
  return { cardId: cards[randomInt(cards.length)]!.id, reversed: randomInt(2) === 1 }
}

export class TarotRepository {
  constructor(private readonly db: DrizzleDb) {}

  today(day: string, agentId: string) {
    const daily = this.db.select().from(tarotDays).where(eq(tarotDays.day, day)).get()
    const row = this.db
      .select()
      .from(tarotReadings)
      .where(and(eq(tarotReadings.day, day), eq(tarotReadings.agentId, agentId)))
      .get()
    return {
      day,
      question: daily?.question ?? '',
      userCard: daily ? (JSON.parse(daily.userCardJson) as TarotDraw) : null,
      reading: row ? (JSON.parse(row.readingJson) as TarotReading) : null,
    }
  }

  /** 同一事务内固定两张牌；重复点击或并发请求只读取已保存的结果。 */
  draw(
    input: Pick<
      TarotReading,
      'day' | 'timeZone' | 'agentId' | 'agentName' | 'question' | 'characterState'
    >,
    persona: string,
  ): TarotReading {
    return this.db.transaction((tx) => {
      const now = new Date().toISOString()
      tx.insert(tarotDays)
        .values({
          day: input.day,
          timeZone: input.timeZone,
          question: input.question,
          userCardJson: JSON.stringify(drawTarot()),
          createdAt: now,
        })
        .onConflictDoNothing()
        .run()
      const daily = tx.select().from(tarotDays).where(eq(tarotDays.day, input.day)).get()!
      const existing = tx
        .select()
        .from(tarotReadings)
        .where(and(eq(tarotReadings.day, input.day), eq(tarotReadings.agentId, input.agentId)))
        .get()
      if (existing) return JSON.parse(existing.readingJson) as TarotReading
      const userCard = JSON.parse(daily.userCardJson) as TarotDraw
      const reading: TarotReading = {
        ...input,
        timeZone: daily.timeZone,
        question: daily.question,
        id: randomUUID(),
        userCard,
        companionCard: drawTarot(userCard.cardId),
        interpretation: null,
        createdAt: now,
      }
      tx.insert(tarotReadings)
        .values({
          id: reading.id,
          day: reading.day,
          agentId: reading.agentId,
          readingJson: JSON.stringify(reading),
          persona,
          createdAt: now,
        })
        .run()
      return reading
    })
  }

  get(id: string): { reading: TarotReading; persona: string } | null {
    const row = this.db.select().from(tarotReadings).where(eq(tarotReadings.id, id)).get()
    return row
      ? { reading: JSON.parse(row.readingJson) as TarotReading, persona: row.persona }
      : null
  }

  saveInterpretation(id: string, interpretation: string): TarotReading {
    return this.db.transaction((tx) => {
      const row = tx.select().from(tarotReadings).where(eq(tarotReadings.id, id)).get()!
      const reading = JSON.parse(row.readingJson) as TarotReading
      if (!reading.interpretation) {
        reading.interpretation = interpretation
        tx.update(tarotReadings)
          .set({ readingJson: JSON.stringify(reading) })
          .where(eq(tarotReadings.id, id))
          .run()
      }
      return reading
    })
  }

  history(agentId: string): TarotReading[] {
    return this.db
      .select()
      .from(tarotReadings)
      .where(eq(tarotReadings.agentId, agentId))
      .orderBy(desc(tarotReadings.createdAt))
      .limit(30)
      .all()
      .map((row) => JSON.parse(row.readingJson) as TarotReading)
  }
}
