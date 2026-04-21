/**
 * MaintenanceUndoService — 维护撤回
 *
 * 维护操作撤销服务：
 * 1. 删除本次维护创建的记忆 (created_ids)
 * 2. 恢复被修改记忆的字段 (modified_data)
 * 3. 恢复被物理删除的记忆 (deleted_data)
 *
 * 使用 VectorWriteHelper 保证向量层的一致性。
 *
 * @module packages/backend/src/services/memory/maintenance/maintenanceUndo
 */

import type { MemoryRepository, CreateMemoryInput } from '../../../repositories/memory.repo'
import type { VectorWriteHelper } from '../../../shared/vectorWriteHelper'
import { maintenanceRecords } from '../../../database/schema'
import type { DrizzleDb } from '../../../database/connection'
import { eq } from 'drizzle-orm'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('MaintenanceUndo')

/** 维护撤回结果 */
export interface UndoResult {
  /** 删除的 (由维护创建的) 记忆数 */
  createdDeleted: number
  /** 恢复的被修改记忆数 */
  modifiedRestored: number
  /** 恢复的被删除记忆数 */
  deletedRestored: number
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
}

interface MaintenanceUndoDeps {
  db: DrizzleDb
  memoryRepo: MemoryRepository
  vectorWriteHelper: VectorWriteHelper
}

export class MaintenanceUndoService {
  constructor(private deps: MaintenanceUndoDeps) {}

  /**
   * 撤销指定的维护记录
   *
   * 完整回滚单次维护操作
   */
  async undo(recordId: number): Promise<UndoResult> {
    const result: UndoResult = {
      createdDeleted: 0,
      modifiedRestored: 0,
      deletedRestored: 0,
      success: false,
    }

    try {
      // 查找维护记录
      const record = this.deps.db
        .select()
        .from(maintenanceRecords)
        .where(eq(maintenanceRecords.id, recordId))
        .get()

      if (!record) {
        result.error = `维护记录 ${recordId} 不存在`
        logger.warn(result.error)
        return result
      }

      logger.info(`开始撤销维护记录 ${recordId}...`)

      // 1. 删除本次维护创建的记忆 (Created IDs)
      if (record.createdIds) {
        const createdIds: number[] = JSON.parse(record.createdIds)
        for (const id of createdIds) {
          try {
            const mem = await this.deps.memoryRepo.findById(id)
            if (mem) {
              await this.deps.memoryRepo.delete(id)
              await this.deps.vectorWriteHelper.deleteWithFallback(
                id,
                mem.agentId,
                mem.source ?? 'desktop',
              )
              result.createdDeleted++
            }
          } catch (err) {
            logger.warn(`撤销: 删除创建的记忆 ${id} 失败: ${err}`)
          }
        }
      }

      // 2. 恢复被修改的记忆 (Modified Data)
      if (record.modifiedData) {
        const modifiedData: Array<Record<string, unknown>> = JSON.parse(record.modifiedData)
        for (const oldState of modifiedData) {
          const memId = oldState.id as number | undefined
          if (!memId) continue

          try {
            const mem = await this.deps.memoryRepo.findById(memId)
            if (mem) {
              // 恢复关键字段
              await this.deps.memoryRepo.update(memId, {
                importance: (oldState.importance as number) ?? mem.importance,
                tags: (oldState.tags as string) ?? mem.tags,
                clusters: (oldState.clusters as string) ?? mem.clusters,
                content: (oldState.content as string) ?? mem.content,
                type: (oldState.type as string) ?? mem.type,
              })

              // 重新生成向量 (内容可能变了)
              await this.deps.vectorWriteHelper.upsertWithFallback({
                memoryId: memId,
                content: (oldState.content as string) ?? mem.content,
                tags: (oldState.tags as string) ?? mem.tags ?? undefined,
                metadata: {
                  agentId: mem.agentId,
                  importance: (oldState.importance as number) ?? mem.importance,
                  type: (oldState.type as string) ?? mem.type,
                  source: mem.source,
                },
                agentId: mem.agentId,
                source: mem.source ?? 'desktop',
              })

              result.modifiedRestored++
            }
          } catch (err) {
            logger.warn(`撤销: 恢复修改记忆 ${memId} 失败: ${err}`)
          }
        }
      }

      // 3. 恢复被删除的记忆 (Deleted Data)
      if (record.deletedData) {
        const deletedData: Array<Record<string, unknown>> = JSON.parse(record.deletedData)
        for (const oldMem of deletedData) {
          const memId = oldMem.id as number | undefined
          if (!memId) continue

          try {
            // 检查是否已存在 (防止重复恢复)
            const existing = await this.deps.memoryRepo.findById(memId)
            if (!existing) {
              // 重新创建记忆
              const createInput: CreateMemoryInput = {
                content: (oldMem.content as string) ?? '',
                agentId: (oldMem.agentId as string) ?? (oldMem.agent_id as string) ?? 'pero',
                tags: (oldMem.tags as string) ?? '',
                importance: (oldMem.importance as number) ?? 1,
                baseImportance:
                  (oldMem.baseImportance as number) ?? (oldMem.base_importance as number) ?? 1,
                sentiment: (oldMem.sentiment as string) ?? 'neutral',
                type: (oldMem.type as string) ?? 'event',
                source: (oldMem.source as string) ?? 'desktop',
              }

              const restored = await this.deps.memoryRepo.create(createInput)

              // 写入向量
              await this.deps.vectorWriteHelper.upsertWithFallback({
                memoryId: restored.id,
                content: restored.content,
                tags: restored.tags ?? undefined,
                metadata: {
                  agentId: restored.agentId,
                  importance: restored.importance,
                  type: restored.type,
                  source: restored.source,
                },
                agentId: restored.agentId,
                source: restored.source ?? 'desktop',
              })

              result.deletedRestored++
            }
          } catch (err) {
            logger.warn(`撤销: 恢复删除记忆 ${memId} 失败: ${err}`)
          }
        }
      }

      // 删除维护记录本身
      this.deps.db.delete(maintenanceRecords).where(eq(maintenanceRecords.id, recordId)).run()

      result.success = true
      logger.info(
        `维护撤销完成: 删除创建 ${result.createdDeleted}, ` +
          `恢复修改 ${result.modifiedRestored}, 恢复删除 ${result.deletedRestored}`,
      )

      return result
    } catch (err) {
      result.error = `撤销失败: ${err}`
      logger.error(result.error)
      return result
    }
  }

  /**
   * 列出最近的维护记录 (用于前端展示)
   */
  listRecords(limit = 20): Array<{
    id: number
    timestamp: string | null
    importantTagged: number | null
    consolidated: number | null
    cleanedCount: number | null
    createdCount: number
    modifiedCount: number
    deletedCount: number
  }> {
    const records = this.deps.db
      .select()
      .from(maintenanceRecords)
      .orderBy(maintenanceRecords.id)
      .limit(limit)
      .all()

    return records.map((r: (typeof records)[number]) => ({
      id: r.id,
      timestamp: r.timestamp,
      importantTagged: r.importantTagged,
      consolidated: r.consolidated,
      cleanedCount: r.cleanedCount,
      createdCount: (JSON.parse(r.createdIds ?? '[]') as unknown[]).length,
      modifiedCount: (JSON.parse(r.modifiedData ?? '[]') as unknown[]).length,
      deletedCount: (JSON.parse(r.deletedData ?? '[]') as unknown[]).length,
    }))
  }
}
