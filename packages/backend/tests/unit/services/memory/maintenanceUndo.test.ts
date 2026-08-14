import { describe, expect, it, vi } from 'vitest'
import { MaintenanceUndoService } from '@infos/backend/services/memory/maintenance/maintenanceUndo'

function createDb(
  record: Record<string, unknown> | null,
  records: Array<Record<string, unknown>> = [],
) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ get: vi.fn(() => record) })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({ all: vi.fn(() => records) })),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ run: vi.fn() })),
    })),
  }
}

function createMemory(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    content: `记忆 ${id}`,
    agentId: 'pero',
    source: 'desktop',
    tags: '猫咪',
    importance: 3,
    type: 'event',
    ...overrides,
  }
}

describe('MaintenanceUndoService', () => {
  it('应当完整撤销创建、修改和删除的维护记录', async () => {
    const record = {
      id: 1,
      createdIds: JSON.stringify([10, 11]),
      modifiedData: JSON.stringify([
        {
          id: 20,
          content: '旧内容',
          tags: '旧标签',
          clusters: '旧主题',
          importance: 8,
          type: 'profile',
        },
        { id: 0, content: '无效' },
      ]),
      deletedData: JSON.stringify([
        {
          id: 30,
          content: '被删内容',
          agent_id: 'pero',
          tags: '恢复',
          base_importance: 2,
          sentiment: 'positive',
          type: 'event',
          source: 'social',
        },
        { id: 31, content: '已存在内容' },
      ]),
    }
    const db = createDb(record)
    const memoryRepo = {
      findById: vi.fn((id: number) => {
        if (id === 10) return Promise.resolve(createMemory(10))
        if (id === 11) return Promise.resolve(null)
        if (id === 20)
          return Promise.resolve(createMemory(20, { content: '新内容', clusters: '新主题' }))
        if (id === 30) return Promise.resolve(null)
        if (id === 31) return Promise.resolve(createMemory(31))
        return Promise.resolve(null)
      }),
      delete: vi.fn(() => Promise.resolve()),
      update: vi.fn(() => Promise.resolve()),
      create: vi.fn((input: Record<string, unknown>) => Promise.resolve({ id: 300, ...input })),
    }
    const vectorWriteHelper = {
      deleteWithFallback: vi.fn(() => Promise.resolve()),
      upsertWithFallback: vi.fn(() => Promise.resolve()),
    }
    const service = new MaintenanceUndoService({ db, memoryRepo, vectorWriteHelper } as never)

    const result = await service.undo(1)

    expect(result).toEqual({
      createdDeleted: 1,
      modifiedRestored: 1,
      deletedRestored: 1,
      success: true,
    })
    expect(memoryRepo.delete).toHaveBeenCalledWith(10)
    expect(vectorWriteHelper.deleteWithFallback).toHaveBeenCalledWith(10, 'pero', 'desktop')
    expect(memoryRepo.update).toHaveBeenCalledWith(20, {
      importance: 8,
      tags: '旧标签',
      clusters: '旧主题',
      content: '旧内容',
      type: 'profile',
    })
    expect(vectorWriteHelper.upsertWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: 20,
        content: '旧内容',
        tags: '旧标签',
        agentId: 'pero',
        source: 'desktop',
      }),
    )
    expect(memoryRepo.create).toHaveBeenCalledWith({
      content: '被删内容',
      agentId: 'pero',
      tags: '恢复',
      importance: 1,
      baseImportance: 2,
      sentiment: 'positive',
      type: 'event',
      source: 'social',
    })
    expect(vectorWriteHelper.upsertWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ memoryId: 300, content: '被删内容', source: 'social' }),
    )
    expect(db.delete).toHaveBeenCalled()
  })

  it('应当在记录不存在、字段为空或局部异常时安全返回', async () => {
    const missing = new MaintenanceUndoService({
      db: createDb(null),
      memoryRepo: {},
      vectorWriteHelper: {},
    } as never)
    const empty = new MaintenanceUndoService({
      db: createDb({ id: 2 }),
      memoryRepo: { findById: vi.fn() },
      vectorWriteHelper: {},
    } as never)
    const partialFailRepo = {
      findById: vi.fn((id: number) => Promise.resolve(createMemory(id))),
      delete: vi.fn(() => Promise.reject(new Error('删除失败'))),
      update: vi.fn(() => Promise.reject(new Error('更新失败'))),
      create: vi.fn(() => Promise.reject(new Error('创建失败'))),
    }
    const partialFail = new MaintenanceUndoService({
      db: createDb({
        id: 3,
        createdIds: JSON.stringify([1]),
        modifiedData: JSON.stringify([{ id: 2, content: '旧内容' }]),
        deletedData: JSON.stringify([{ id: 4, content: '已存在' }]),
      }),
      memoryRepo: partialFailRepo,
      vectorWriteHelper: { deleteWithFallback: vi.fn(), upsertWithFallback: vi.fn() },
    } as never)

    await expect(missing.undo(404)).resolves.toEqual({
      createdDeleted: 0,
      modifiedRestored: 0,
      deletedRestored: 0,
      success: false,
      error: '维护记录 404 不存在',
    })
    await expect(empty.undo(2)).resolves.toEqual({
      createdDeleted: 0,
      modifiedRestored: 0,
      deletedRestored: 0,
      success: true,
    })
    await expect(partialFail.undo(3)).resolves.toEqual({
      createdDeleted: 0,
      modifiedRestored: 0,
      deletedRestored: 0,
      success: true,
    })
  })

  it('应当在 JSON 解析失败时返回整体失败，并能列出维护记录统计', () => {
    const records = [
      {
        id: 1,
        timestamp: '2026-01-01',
        importantTagged: 2,
        consolidated: 3,
        cleanedCount: 4,
        createdIds: JSON.stringify([1, 2]),
        modifiedData: JSON.stringify([{ id: 3 }]),
        deletedData: JSON.stringify([{ id: 4 }, { id: 5 }]),
      },
      {
        id: 2,
        timestamp: null,
        importantTagged: null,
        consolidated: null,
        cleanedCount: null,
        createdIds: null,
        modifiedData: null,
        deletedData: null,
      },
    ]
    const db = createDb({ id: 9, createdIds: '{坏掉' }, records)
    const service = new MaintenanceUndoService({
      db,
      memoryRepo: {},
      vectorWriteHelper: {},
    } as never)

    expect(service.listRecords(10)).toEqual([
      {
        id: 1,
        timestamp: '2026-01-01',
        importantTagged: 2,
        consolidated: 3,
        cleanedCount: 4,
        createdCount: 2,
        modifiedCount: 1,
        deletedCount: 2,
      },
      {
        id: 2,
        timestamp: null,
        importantTagged: null,
        consolidated: null,
        cleanedCount: null,
        createdCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
      },
    ])
    return expect(service.undo(9)).resolves.toMatchObject({
      createdDeleted: 0,
      modifiedRestored: 0,
      deletedRestored: 0,
      success: false,
      error: expect.stringContaining('撤销失败'),
    })
  })
})
