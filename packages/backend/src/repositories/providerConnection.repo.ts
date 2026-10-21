import { eq } from 'drizzle-orm'
import type { DrizzleDb } from '../database'
import { aiModelConfigs, providerConnections } from '../database/schema'
import { AppError } from '../lib/appError'

export type ProviderConnection = typeof providerConnections.$inferSelect
export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini'
export type ProviderAuthMode = 'api_key' | 'none'
export type ProviderConnectionInput = Omit<ProviderConnection, 'id'>

export class ProviderConnectionRepository {
  constructor(private db: DrizzleDb) {}

  async findAll(): Promise<ProviderConnection[]> {
    return this.db.select().from(providerConnections).all()
  }

  async findById(id: string): Promise<ProviderConnection | undefined> {
    return this.db.select().from(providerConnections).where(eq(providerConnections.id, id)).get()
  }

  async create(id: string, input: ProviderConnectionInput): Promise<void> {
    await this.db.insert(providerConnections).values({ id, ...input })
  }

  async update(id: string, input: ProviderConnectionInput): Promise<void> {
    await this.db.update(providerConnections).set(input).where(eq(providerConnections.id, id))
  }

  /** 引用迁移与删除处于同一事务，避免留下悬空连接。 */
  async remove(id: string, replacementId?: string): Promise<void> {
    this.db.transaction((tx) => {
      const users = tx
        .select({ id: aiModelConfigs.id })
        .from(aiModelConfigs)
        .where(eq(aiModelConfigs.providerConnectionId, id))
        .all()
      if (users.length && !replacementId) {
        throw new AppError('VALIDATION_ERROR', { message: '该连接仍被模型使用，请先选择替换连接' })
      }
      if (replacementId) {
        const replacement = tx
          .select()
          .from(providerConnections)
          .where(eq(providerConnections.id, replacementId))
          .get()
        if (replacementId === id || !replacement) {
          throw new AppError('VALIDATION_ERROR', { message: '替换连接不存在或与当前连接相同' })
        }
        tx.update(aiModelConfigs)
          .set({ providerConnectionId: replacementId })
          .where(eq(aiModelConfigs.providerConnectionId, id))
          .run()
      }
      tx.delete(providerConnections).where(eq(providerConnections.id, id)).run()
    })
  }
}
