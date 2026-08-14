/**
 * ResetService 单元测试
 *
 * 使用内存 SQLite + createDrizzleConnection 自动建全量 schema，
 * 验证三种分级重置的清表范围与行数统计：
 * - clearLogs      只清对话相关表，保留记忆
 * - resetMemories  只清记忆相关表，保留对话
 * - factoryReset   清空全部用户数据
 *
 * @module packages/backend/tests/unit/services/maintenance/resetService.test
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createDrizzleConnection, type DrizzleDb } from '@infos/backend/database'
import { ResetService } from '@infos/backend/services/maintenance/resetService'
import {
  threads,
  threadMessages,
  threadSummaries,
  conversationLogs,
  groupChatMessages,
  messageAttachments,
  fileChangeSnapshots,
  memoryNodes,
  canonicalMemories,
  memoryCandidates,
  entityCooccurrences,
  triviumSyncTasks,
  maintenanceRecords,
} from '@infos/backend/database/schema'

let db: DrizzleDb
let service: ResetService

beforeEach(() => {
  // createDrizzleConnection 首次连接会自动执行 migrations 建全表
  db = createDrizzleConnection(':memory:')
  service = new ResetService(db)
})

afterEach(() => {
  ;(db as unknown as { $client: { close(): void } }).$client.close()
})

/** 统计某张表的行数 */
async function countRows(table: { id: unknown }): Promise<number> {
  const rows = await db.select({ id: table.id }).from(table as never)
  return rows.length
}

/** 插入对话相关数据（threads / 消息 / 日志 / 群聊 / 附件 / 快照） */
async function seedConversationData() {
  await db.insert(threads).values([
    { id: 't-1', agentId: 'pero' },
    { id: 't-2', agentId: 'pero' },
  ])
  await db.insert(threadMessages).values([
    { threadId: 't-1', role: 'user', content: '你好' },
    { threadId: 't-1', role: 'assistant', content: '喵~' },
  ])
  await db.insert(threadSummaries).values([{ threadId: 't-1', content: '滚动摘要' }])
  await db
    .insert(conversationLogs)
    .values([{ sessionId: 's-1', source: 'desktop', role: 'user', content: '你好' }])
  await db
    .insert(groupChatMessages)
    .values([{ roomId: 'r-1', senderId: 'u-1', role: 'user', content: '大家好' }])
  await db.insert(messageAttachments).values([
    {
      id: 'att-1',
      threadId: 't-1',
      kind: 'file',
      originalName: 'a.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      sha256: 'abc',
      storageKey: 'k1',
    },
  ])
  await db
    .insert(fileChangeSnapshots)
    .values([{ id: 'snp-1', threadId: 't-1', pairId: 'p-1', callId: 'c-1', filePath: 'a.txt' }])
}

/** 插入记忆相关数据（记忆节点 / 长记忆 / 候选 / 共现 / 同步任务 / 维护记录） */
async function seedMemoryData() {
  await db.insert(memoryNodes).values([{ content: '主人喜欢甜食' }])
  await db.insert(canonicalMemories).values([
    {
      id: 'cm-1',
      agentId: 'pero',
      type: 'preference',
      content: '喜欢甜食',
      provenance: '{}',
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    },
  ])
  await db.insert(memoryCandidates).values([
    {
      id: 'mc-1',
      agentId: 'pero',
      source: 'thread',
      summary: '候选记忆',
      suggestedType: 'preference',
      createdAt: '2026-01-01 00:00:00',
    },
  ])
  await db.insert(entityCooccurrences).values([{ entityAId: 1, entityBId: 2 }])
  await db.insert(triviumSyncTasks).values([{ operation: 'upsert' }])
  await db.insert(maintenanceRecords).values([{}])
}

describe('ResetService 分级重置', () => {
  it('clearLogs 清空对话相关表并保留记忆', async () => {
    await seedConversationData()
    await seedMemoryData()

    const result = await service.clearLogs()

    expect(result.operation).toBe('clear_logs')
    expect(await countRows(threads)).toBe(0)
    expect(await countRows(threadMessages)).toBe(0)
    expect(await countRows(threadSummaries)).toBe(0)
    expect(await countRows(conversationLogs)).toBe(0)
    expect(await countRows(groupChatMessages)).toBe(0)
    expect(await countRows(messageAttachments)).toBe(0)
    expect(await countRows(fileChangeSnapshots)).toBe(0)
    // 记忆不受影响
    expect(await countRows(memoryNodes)).toBe(1)
  })

  it('resetMemories 清空记忆相关表并保留对话', async () => {
    await seedConversationData()
    await seedMemoryData()

    const result = await service.resetMemories()

    expect(result.operation).toBe('reset_memories')
    expect(await countRows(memoryNodes)).toBe(0)
    expect(await countRows(canonicalMemories)).toBe(0)
    expect(await countRows(memoryCandidates)).toBe(0)
    expect(await countRows(entityCooccurrences)).toBe(0)
    expect(await countRows(triviumSyncTasks)).toBe(0)
    expect(await countRows(maintenanceRecords)).toBe(0)
    // 对话不受影响
    expect(await countRows(threads)).toBe(2)
  })

  it('factoryReset 清空全部用户数据并返回行数摘要', async () => {
    await seedConversationData()
    await seedMemoryData()

    const result = await service.factoryReset()

    expect(result.operation).toBe('factory_reset')
    expect(await countRows(threads)).toBe(0)
    expect(await countRows(threadMessages)).toBe(0)
    expect(await countRows(conversationLogs)).toBe(0)
    expect(await countRows(groupChatMessages)).toBe(0)
    expect(await countRows(memoryNodes)).toBe(0)
    expect(await countRows(canonicalMemories)).toBe(0)
    expect(await countRows(memoryCandidates)).toBe(0)
    expect(await countRows(entityCooccurrences)).toBe(0)
    expect(await countRows(triviumSyncTasks)).toBe(0)
    expect(await countRows(maintenanceRecords)).toBe(0)
    expect(await countRows(messageAttachments)).toBe(0)
    expect(await countRows(fileChangeSnapshots)).toBe(0)
    // 行数摘要使用显式表名
    expect(result.cleared['threads']).toBe(2)
    expect(result.cleared['thread_messages']).toBe(2)
    expect(result.cleared['memory_nodes']).toBe(1)
    expect(result.cleared['canonical_memories']).toBe(1)
  })
})
