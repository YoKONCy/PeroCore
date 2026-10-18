import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as schema from '@infos/backend/database/schema'
import { BackgroundTaskRepository } from '@infos/backend/repositories/backgroundTask.repo'
import { readTaskLifecycle } from '@infos/backend/services/task/taskLifecycle'

const connections: Database.Database[] = []
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close()
})

function setup() {
  const sqlite = new Database(':memory:')
  connections.push(sqlite)
  const db = drizzle(sqlite, { schema })
  migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL('../../../../src/database/migrations/', import.meta.url),
    ),
  })
  const repo = new BackgroundTaskRepository(db)
  const create = (id: string, status: 'queued' | 'running' = 'queued') =>
    repo.create({
      id,
      agentId: 'pero',
      threadId: `thread-${id}`,
      title: id,
      instruction: '整理资料',
      status,
      lifecycleJson: JSON.stringify(readTaskLifecycle(null, '整理资料')),
    })
  return { sqlite, db, repo, create }
}

describe('持久任务的事务边界', () => {
  it('同一修订的并发修改只有一个成功，旧执行不能覆盖新要求', async () => {
    const { repo, create } = setup()
    await create('task')
    const results = await Promise.all([
      repo.revise('task', 1, { instruction: '改为整理照片' }),
      repo.revise('task', 1, { instruction: '改为整理账单' }),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repo.transition('task', 'queued', 'completed', { result: '旧结果' }, 1)).toBe(
      false,
    )
    expect(await repo.findById('task')).toMatchObject({
      revision: 2,
      status: 'queued',
      result: null,
    })
  })

  it('完成状态与待通知事件一起提交，重复提交不重复生成通知', async () => {
    const { db, repo, create } = setup()
    await create('task', 'running')
    expect(await repo.transition('task', 'running', 'completed', { result: '资料清单' }, 1)).toBe(
      true,
    )
    expect(await repo.transition('task', 'running', 'completed', { result: '重复结果' }, 1)).toBe(
      false,
    )
    expect(await repo.findById('task')).toMatchObject({ status: 'completed', result: '资料清单' })
    expect(db.select().from(schema.kernelOutboxEvents).all()).toHaveLength(1)
  })

  it('通知入库失败时回滚完成状态，避免完成后永久丢失通知', async () => {
    const { sqlite, repo, create } = setup()
    await create('task', 'running')
    sqlite.exec(
      `CREATE TRIGGER reject_notification BEFORE INSERT ON kernel_outbox_events BEGIN SELECT RAISE(ABORT, '测试注入的持久化故障'); END;`,
    )
    await expect(
      repo.transition('task', 'running', 'completed', { result: '资料清单' }, 1),
    ).rejects.toThrow(Error)
    expect(await repo.findById('task')).toMatchObject({ status: 'running', result: null })
  })

  it('互相等待的第二条边被事务拒绝，原任务不会进入永久等待', async () => {
    const { repo, create } = setup()
    await create('first')
    await create('second')
    const waitingFor = (key: string) =>
      JSON.stringify({ ...readTaskLifecycle(null, '整理资料'), wait: { kind: 'task', key } })
    await repo.transition('first', 'queued', 'waiting', { lifecycleJson: waitingFor('second') }, 1)
    await expect(
      repo.transition('second', 'queued', 'waiting', { lifecycleJson: waitingFor('first') }, 1),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(await repo.findById('first')).toMatchObject({ status: 'waiting' })
    expect(await repo.findById('second')).toMatchObject({ status: 'queued' })
  })
})
