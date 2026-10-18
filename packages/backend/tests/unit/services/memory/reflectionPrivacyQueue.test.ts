import { afterEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3'
import type { EventNote } from '@infos/shared'
import { createDrizzleConnection, closeDrizzleConnection } from '@infos/backend/database'
import { EventNoteRepository } from '@infos/backend/repositories/eventNote.repo'
import { PrivacyPolicy } from '@infos/backend/services/maintenance/privacyPolicy'

const connections: ReturnType<typeof createDrizzleConnection>[] = []
afterEach(() => {
  for (const db of connections.splice(0)) closeDrizzleConnection(db)
})

function fixture() {
  const db = createDrizzleConnection(':memory:')
  connections.push(db)
  const sqlite = (db as unknown as { $client: Database.Database }).$client
  const policy = new PrivacyPolicy(sqlite)
  const repo = new EventNoteRepository(db)
  repo.setPrivacyPolicy(policy)
  const event = (id: string): EventNote => ({
    id,
    agentId: 'pero',
    narrative: `事件${id}`,
    eventAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    importance: 5,
    affect: { tones: [], valence: 5, arousal: 0 },
    participants: [],
    places: [],
    objects: [],
    topics: [],
    status: 'active',
    origin: {
      mode: 'background',
      threadId: 'thread',
      pairIds: [id],
      messageIds: [],
      channel: 'desktop',
    },
  })
  function forget(note: EventNote) {
    sqlite
      .prepare(
        "INSERT INTO privacy_deletions(id,kind,target_id,agent_id,metadata_json,status,created_at) VALUES(?,'memory-source',?,'pero','{}','completed',?)",
      )
      .run(
        `forget-${note.id}`,
        policy.sourceKey(note.agentId, note.origin.threadId, note.origin.pairIds[0]!),
        new Date().toISOString(),
      )
    policy.reload()
  }
  return { db, sqlite, repo, policy, event, forget }
}

describe('关系维护历史失败队列的隐私收口', () => {
  it('事件行仍存在但来源已遗忘时，收口已耗尽重试的任务并清掉旧决策', async () => {
    const { repo, sqlite, event, forget } = fixture()
    const note = event('forgotten')
    await repo.create(note, 1)
    await repo.enqueueReflectionTask({ id: 'task', agentId: 'pero', eventId: note.id })
    await repo.createOperation(
      'reflection:decision:pero:forgotten',
      'pero',
      'reflection_decision',
      { event: note, candidates: [], decision: {} },
    )
    sqlite
      .prepare("UPDATE event_memory_reflection_tasks SET status='failed',attempts=5,last_error=?")
      .run('Error: 该记忆或来源已被永久删除，已阻止后台重新写入')
    forget(note)
    expect(await repo.pendingReflectionTasks()).toEqual([])
    expect(await repo.findOperation('reflection:decision:pero:forgotten')).toBeUndefined()
    expect(
      sqlite.prepare('SELECT status,last_error FROM event_memory_reflection_tasks').get(),
    ).toEqual({ status: 'completed', last_error: null })
    expect(await repo.enqueueMissingReflectionTasks()).toBe(0)
    expect(await repo.findById(note.id)).toBeDefined()
  })

  it('主事件有效时恢复旧隐私错误任务，不消耗错误重试预算或沿用旧候选决策', async () => {
    const { repo, sqlite, event, forget } = fixture()
    const main = event('main')
    const candidate = event('candidate')
    await repo.create(main, 1)
    await repo.create(candidate, 2)
    await repo.enqueueReflectionTask({ id: 'task', agentId: 'pero', eventId: main.id })
    await repo.createOperation('reflection:decision:pero:main', 'pero', 'reflection_decision', {
      event: main,
      candidates: [candidate],
      decision: {},
    })
    sqlite
      .prepare("UPDATE event_memory_reflection_tasks SET status='failed',attempts=5,last_error=?")
      .run('Error: 该记忆或来源已被永久删除，已阻止后台重新写入')
    forget(candidate)
    expect(await repo.pendingReflectionTasks()).toEqual([
      { id: 'task', agentId: 'pero', eventId: main.id },
    ])
    expect(await repo.findOperation('reflection:decision:pero:main')).toBeUndefined()
    expect(
      sqlite.prepare('SELECT status,attempts,last_error FROM event_memory_reflection_tasks').get(),
    ).toEqual({ status: 'pending', attempts: 0, last_error: null })
    expect(await repo.findById(main.id)).toBeDefined()
  })
})
