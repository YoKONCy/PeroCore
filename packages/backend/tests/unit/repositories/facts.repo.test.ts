import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDrizzleConnection, closeDrizzleConnection } from '@infos/backend/database'
import { factMemoryOperations, factObjects, factRecords } from '@infos/backend/database/schema'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'
import { FactsRepository } from '@infos/backend/repositories/facts.repo'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = join(tmpdir(), `infos-facts-${Date.now()}-${Math.random()}`)
  roots.push(root)
  mkdirSync(root, { recursive: true })
  const db = createDrizzleConnection(join(root, 'infos.db'))
  const resolver = {
    resolve(alias: string) {
      return alias === '@data' ? root : join(root, alias.replace('@data/', ''))
    },
  }
  const stores = new MemoryStoreRegistry(resolver as never, 4)
  return { db, stores, repo: new FactsRepository(db, stores) }
}

describe('FactsRepository共享事实库', () => {
  it('应创建对象与事实，并通过标准名和别名精确查询', async () => {
    const { db, stores, repo } = fixture()
    const fact = await repo.write({
      standardName: '特里维姆数据库',
      aliases: ['TDB'],
      statement: '当前版本是0.8.2',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
    })

    const result = await repo.query('tdb')
    expect(result.exactMatch?.objectId).toBe(fact.objectId)
    expect(result.exactMatch?.activeFacts[0]?.statement).toBe('当前版本是0.8.2')
    expect(stores.getSharedStore('facts').nodeCount()).toBe(2)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('精确失败后应返回最多5个文本候选并要求Agent选择', async () => {
    const { db, stores, repo } = fixture()
    const names = ['苹果公司', '苹果手机', '苹果电脑', '苹果商店', '苹果系统', '苹果配件']
    await db.insert(factObjects).values(
      names.map((standardName, index) => ({
        id: `object-${index}`,
        tdbId: index + 1,
        standardName,
        normalizedName: standardName,
        aliasesJson: '[]',
        createdAt: '2026-08-27T10:00:00.000Z',
      })),
    )
    await repo.rebuildStore()
    const result = await repo.query('苹果')
    expect(result.exactMatch).toBeUndefined()
    expect(result.requiresSelection).toBe(true)
    expect(result.candidates).toHaveLength(5)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('同一operationId重放不得创建重复事实，并可从SQLite重建共享TDB', async () => {
    const { db, stores, repo } = fixture()
    const input = {
      standardName: 'TriviumDB',
      aliases: ['TDB'],
      statement: '当前版本是0.8.2',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
      operationId: 'fact-write-idempotent',
    }
    const first = await repo.write(input)
    const replayed = await repo.write({ ...input, statement: '这条输入不应覆盖原事实' })
    expect(replayed.id).toBe(first.id)
    expect(stores.getSharedStore('facts').nodeCount()).toBe(2)

    await repo.rebuildStore()
    const store = stores.getSharedStore('facts')
    expect(store.nodeCount()).toBe(2)
    const nodes = store
      .allNodeIds()
      .map((id) => store.get<{ id?: string; kind?: string }>(id)?.payload)
    expect(nodes).toContainEqual(expect.objectContaining({ id: first.id, kind: 'fact' }))
    const result = await repo.query('TDB')
    expect(result.exactMatch?.activeFacts).toContainEqual(expect.objectContaining({ id: first.id }))

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('查询必须以TDB为权威并返回确定性对象事实路径', async () => {
    const { db, stores, repo } = fixture()
    const fact = await repo.write({
      standardName: '路径对象',
      statement: '路径事实',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
    })
    await db.delete(factRecords)

    const result = await repo.query('路径对象')
    expect(result.exactMatch?.activeFacts).toContainEqual(expect.objectContaining({ id: fact.id }))
    expect(result.paths).toContainEqual({
      nodes: [
        expect.objectContaining({ id: fact.objectId, kind: 'fact_object' }),
        expect.objectContaining({ id: fact.id, kind: 'fact' }),
      ],
      edges: [expect.objectContaining({ fromId: fact.objectId, toId: fact.id, label: 'has_fact' })],
    })

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('取代、删除和别名操作应支持operationId幂等重放', async () => {
    const { db, stores, repo } = fixture()
    const old = await repo.write({
      standardName: '幂等对象',
      statement: '旧事实',
      observedAt: '2026-08-26T10:00:00.000Z',
      createdByAgentId: 'pero',
    })
    const replacement = await repo.supersede(old.objectId, old.id, {
      statement: '新事实',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
      operationId: 'supersede-idempotent',
    })
    const replayed = await repo.supersede(old.objectId, old.id, {
      statement: '不得创建的事实',
      observedAt: '2026-08-28T10:00:00.000Z',
      createdByAgentId: 'pero',
      operationId: 'supersede-idempotent',
    })
    expect(replayed.id).toBe(replacement.id)

    await repo.addAlias(old.objectId, 'IDEM', 'alias-idempotent')
    await repo.addAlias(old.objectId, '不得覆盖', 'alias-idempotent')
    expect((await repo.query('IDEM')).exactMatch?.objectId).toBe(old.objectId)

    await repo.deleteFact(replacement.id, 'delete-idempotent')
    await repo.deleteFact(replacement.id, 'delete-idempotent')
    expect((await repo.query('幂等对象')).exactMatch?.activeFacts).toEqual([])
    expect(await db.select().from(factMemoryOperations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationId: 'supersede-idempotent', status: 'committed' }),
        expect.objectContaining({ operationId: 'alias-idempotent', status: 'committed' }),
        expect.objectContaining({ operationId: 'delete-idempotent', status: 'committed' }),
      ]),
    )

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('TDB提交失败时应保留SQLite备份和failed操作，恢复后可重放提交', async () => {
    const { db, stores, repo } = fixture()
    const store = stores.getSharedStore('facts')
    const failure = vi.spyOn(store, 'commitTransaction').mockImplementationOnce(() => {
      throw new Error('注入TDB提交失败')
    })

    await expect(
      repo.write({
        standardName: '故障对象',
        statement: '故障事实',
        observedAt: '2026-08-27T10:00:00.000Z',
        createdByAgentId: 'pero',
        operationId: 'write-failure',
      }),
    ).rejects.toThrow('注入TDB提交失败')

    expect(await db.select().from(factRecords)).toHaveLength(1)
    expect(await db.select().from(factMemoryOperations)).toContainEqual(
      expect.objectContaining({ operationId: 'write-failure', status: 'failed', attempts: 1 }),
    )

    failure.mockRestore()
    await repo.replayPending()
    expect((await repo.query('故障对象')).exactMatch?.activeFacts).toHaveLength(1)
    expect(await db.select().from(factMemoryOperations)).toContainEqual(
      expect.objectContaining({ operationId: 'write-failure', status: 'committed' }),
    )

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('取代、删除和别名的TDB失败应保留failed操作并可恢复重放', async () => {
    const { db, stores, repo } = fixture()
    const old = await repo.write({
      standardName: '恢复对象',
      statement: '旧值',
      observedAt: '2026-08-26T10:00:00.000Z',
      createdByAgentId: 'pero',
    })
    const store = stores.getSharedStore('facts')

    const supersedeFailure = vi.spyOn(store, 'commitTransaction').mockImplementationOnce(() => {
      throw new Error('取代提交失败')
    })
    await expect(
      repo.supersede(old.objectId, old.id, {
        statement: '新值',
        observedAt: '2026-08-27T10:00:00.000Z',
        createdByAgentId: 'pero',
        operationId: 'supersede-failure',
      }),
    ).rejects.toThrow('取代提交失败')
    supersedeFailure.mockRestore()
    await repo.replayPending()
    const replacement = (await repo.query('恢复对象')).exactMatch?.activeFacts[0]
    expect(replacement?.statement).toBe('新值')

    const aliasFailure = vi.spyOn(store, 'updatePayload').mockImplementationOnce(() => {
      throw new Error('别名提交失败')
    })
    await expect(repo.addAlias(old.objectId, '恢复别名', 'alias-failure')).rejects.toThrow(
      '别名提交失败',
    )
    aliasFailure.mockRestore()
    await repo.replayPending()
    expect((await repo.query('恢复别名')).exactMatch?.objectId).toBe(old.objectId)

    const deleteFailure = vi.spyOn(store, 'delete').mockImplementationOnce(() => {
      throw new Error('删除提交失败')
    })
    await expect(repo.deleteFact(replacement!.id, 'delete-failure')).rejects.toThrow('删除提交失败')
    deleteFailure.mockRestore()
    await repo.replayPending()
    expect((await repo.query('恢复对象')).exactMatch?.activeFacts).toEqual([])

    expect(await db.select().from(factMemoryOperations)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationId: 'supersede-failure',
          status: 'committed',
          attempts: 1,
        }),
        expect.objectContaining({ operationId: 'alias-failure', status: 'committed', attempts: 1 }),
        expect.objectContaining({
          operationId: 'delete-failure',
          status: 'committed',
          attempts: 1,
        }),
      ]),
    )

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('SQLite准备失败时不得触碰TDB', async () => {
    const { db, stores, repo } = fixture()
    const first = await repo.write({
      standardName: 'SQLite边界',
      statement: '第一条',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
      operationId: 'shared-operation',
    })
    const store = stores.getSharedStore('facts')
    const nodeCount = store.nodeCount()

    await expect(
      repo.supersede(first.objectId, first.id, {
        statement: '不得提交',
        observedAt: '2026-08-28T10:00:00.000Z',
        createdByAgentId: 'pero',
        operationId: 'shared-operation',
      }),
    ).rejects.toThrow('operationId 已用于其他事实操作')

    expect(store.nodeCount()).toBe(nodeCount)
    expect((await repo.query('SQLite边界')).exactMatch?.activeFacts.map((fact) => fact.id)).toEqual(
      [first.id],
    )

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('档案浏览应按对象聚合当前与历史事实并支持全文过滤', async () => {
    const { db, stores, repo } = fixture()
    const old = await repo.write({
      standardName: '知识对象',
      aliases: ['资料对象'],
      statement: '旧知识内容',
      observedAt: '2026-08-26T10:00:00.000Z',
      createdByAgentId: 'pero',
    })
    const current = await repo.supersede(old.objectId, old.id, {
      statement: '当前知识内容',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'pero',
    })

    const archive = await repo.archive('资料对象')
    expect(archive.stats).toEqual({
      objectCount: 1,
      activeFactCount: 1,
      historicalFactCount: 1,
    })
    expect(archive.items[0]).toMatchObject({
      standardName: '知识对象',
      aliases: ['资料对象'],
      activeFacts: [expect.objectContaining({ id: current.id, statement: '当前知识内容' })],
      historicalFacts: [expect.objectContaining({ id: old.id, supersededBy: current.id })],
    })
    expect((await repo.archive('当前知识')).items).toHaveLength(1)
    expect((await repo.archive('不存在')).items).toHaveLength(0)

    stores.closeAll()
    closeDrizzleConnection(db)
  })

  it('显式取代应更新active事实并建立双向取代边', async () => {
    const { db, stores, repo } = fixture()
    const old = await repo.write({
      standardName: 'TDB',
      statement: '版本是0.8.1',
      observedAt: '2026-08-26T10:00:00.000Z',
      createdByAgentId: 'pero',
    })
    const replacement = await repo.supersede(old.objectId, old.id, {
      statement: '版本是0.8.2',
      observedAt: '2026-08-27T10:00:00.000Z',
      createdByAgentId: 'nana',
    })
    const result = await repo.query('TDB')

    expect(result.exactMatch?.activeFacts.map((fact) => fact.id)).toEqual([replacement.id])
    const store = stores.getSharedStore('facts')
    const nodes = store
      .allNodeIds()
      .map((id) => ({ id, payload: store.get(id)?.payload as { id?: string } }))
    const oldNode = nodes.find((node) => node.payload.id === old.id)!
    const newNode = nodes.find((node) => node.payload.id === replacement.id)!
    expect(store.getEdge(oldNode.id, newNode.id, 'superseded_by')).not.toBeNull()
    expect(store.getEdge(newNode.id, oldNode.id, 'supersedes')).not.toBeNull()

    stores.closeAll()
    closeDrizzleConnection(db)
  })
})
