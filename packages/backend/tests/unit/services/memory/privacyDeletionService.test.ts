import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeDrizzleConnection, createDrizzleConnection } from '@infos/backend/database'
import { PrivacyDeletionService } from '@infos/backend/services/maintenance/privacyDeletionService'
import { PrivacyPolicy } from '@infos/backend/services/maintenance/privacyPolicy'
import { PetStateService } from '@infos/backend/services/agent/petStateService'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

function fixture() {
  // 使用正式迁移创建真实表，避免测试夹具误造 thread_id 而掩盖字段错误。
  const connection = createDrizzleConnection(':memory:')
  const db = (connection as unknown as { $client: Database.Database }).$client
  const policy = new PrivacyPolicy(db)
  const characterStates = new PetStateService(connection)
  const rebuildAgentStore = vi.fn(async () => {})
  const deps = {
    db,
    policy,
    memory: { rebuildAgentStore } as unknown as ConstructorParameters<
      typeof PrivacyDeletionService
    >[0]['memory'],
    facts: {} as ConstructorParameters<typeof PrivacyDeletionService>[0]['facts'],
    knowledge: {} as ConstructorParameters<typeof PrivacyDeletionService>[0]['knowledge'],
    stores: {
      discardUpgradeBackup: vi.fn(),
      resolveAgentStorePath: (agentId: string, mode: string) => `${agentId}/${mode}.tdb`,
      resolveSharedStorePath: (kind: string) => `knowledge/${kind}.tdb`,
    } as unknown as ConstructorParameters<typeof PrivacyDeletionService>[0]['stores'],
    invalidateMemory: vi.fn(async () => {}),
    removeDiary: vi.fn(async () => {}),
    listAgentIds: () => ['pero'],
    resetSqlite: vi.fn(async () => {}),
    forgetSocial: vi.fn(async () => {}),
    retractCharacterState: (threadId: string, pairIds: string[]) =>
      characterStates.rollbackPairs(threadId, pairIds),
  }
  const service = new PrivacyDeletionService(deps)
  cleanup.push(async () => {
    await service.stop()
    closeDrizzleConnection(connection)
  })
  const now = '2026-10-17T12:00:00.000Z'
  const origin = {
    threadId: 'thread-delete',
    pairIds: ['pair-delete'],
    messageIds: ['1'],
    channel: 'desktop',
    mode: 'active',
  }
  db.prepare('INSERT INTO threads(id,agent_id,title) VALUES(?,?,?)').run(
    'thread-delete',
    'pero',
    '待清理对话',
  )
  db.prepare('INSERT INTO threads(id,agent_id,title) VALUES(?,?,?)').run(
    'thread-keep',
    'pero',
    '保留对话',
  )
  const message = db.prepare(
    'INSERT INTO thread_messages(thread_id,role,content,pair_id) VALUES(?,?,?,?)',
  )
  message.run('thread-delete', 'user', '来源正文', 'pair-delete')
  message.run('thread-delete', 'user', '同会话其他正文', 'pair-keep')
  message.run('thread-keep', 'user', '另一会话正文', 'pair-other')
  const log = db.prepare(
    'INSERT INTO conversation_logs(session_id,source,role,content,pair_id,agent_id) VALUES(?,?,?,?,?,?)',
  )
  log.run('thread-delete', 'desktop', 'user', '旧来源正文', 'pair-delete', 'pero')
  log.run('thread-keep', 'desktop', 'user', '保留的旧正文', 'pair-other', 'pero')
  db.prepare(
    'INSERT INTO event_notes(id,tdb_id,agent_id,narrative,event_at,created_at,importance,affect_json,origin_json) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run('memory-delete', 1, 'pero', '待删除记忆', now, now, 5, '{}', JSON.stringify(origin))
  return { db, policy, service, deps, rebuildAgentStore, origin, now, characterStates }
}

describe('长记忆永久删除', () => {
  it('删除来源时撤回并清除来源状态正文，保留后续轮次状态和防迟到标记', async () => {
    const { db, service, characterStates } = fixture()
    const publish = vi.fn().mockResolvedValue(undefined)
    characterStates.setPublisher(publish)
    await characterStates.update(
      'pero',
      { mood: '紧张' },
      {
        threadId: 'thread-delete',
        pairId: 'pair-delete',
      },
    )
    await characterStates.update(
      'pero',
      { mind: '保留的后续心声' },
      {
        threadId: 'thread-delete',
        pairId: 'pair-keep',
      },
    )
    const before = (await characterStates.get('pero', 'thread-delete'))!.revision
    await service.deleteMemory('memory-delete', true)
    expect(await characterStates.get('pero', 'thread-delete')).toMatchObject({
      mood: '开心',
      mind: '保留的后续心声',
    })
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-delete',
        mood: '开心',
        mind: '保留的后续心声',
        revision: expect.any(Number),
      }),
    )
    expect((await characterStates.get('pero', 'thread-delete'))!.revision).toBeGreaterThan(before)
    expect(
      db
        .prepare(
          "SELECT patch_json FROM thread_character_state_events WHERE kind='update' AND pair_id='pair-delete'",
        )
        .all(),
    ).toEqual([])
    await expect(
      characterStates.update(
        'pero',
        { mood: '紧张' },
        {
          threadId: 'thread-delete',
          pairId: 'pair-delete',
        },
      ),
    ).rejects.toThrow('已撤回')
  })

  it('同时删除来源时使用真实 session_id 列，完成清理并保留其他会话', async () => {
    const { db, service, policy, rebuildAgentStore, deps } = fixture()
    const columns = db.pragma('table_info(conversation_logs)') as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('session_id')
    expect(columns.map((column) => column.name)).not.toContain('thread_id')

    await service.deleteMemory('memory-delete', true)

    expect(db.prepare('SELECT 1 FROM event_notes WHERE id=?').get('memory-delete')).toBeUndefined()
    expect(
      db.prepare('SELECT 1 FROM conversation_logs WHERE session_id=?').get('thread-delete'),
    ).toBeUndefined()
    expect(
      db.prepare('SELECT content FROM conversation_logs WHERE session_id=?').get('thread-keep'),
    ).toEqual({ content: '保留的旧正文' })
    expect(db.prepare('SELECT pair_id FROM thread_messages ORDER BY id').all()).toEqual([
      { pair_id: 'pair-keep' },
      { pair_id: 'pair-other' },
    ])
    expect(
      db
        .prepare(
          "SELECT status,last_error,metadata_json FROM privacy_deletions WHERE kind='memory'",
        )
        .get(),
    ).toEqual({ status: 'completed', last_error: null, metadata_json: '{}' })
    expect(rebuildAgentStore).toHaveBeenCalledWith('pero', true)
    expect(deps.stores.discardUpgradeBackup).toHaveBeenCalledWith('pero/main.tdb')
    expect(deps.stores.discardUpgradeBackup).not.toHaveBeenCalledWith('pero/social.tdb')
    expect(policy.sourceForgotten('pero', 'thread-delete', 'pair-delete')).toBe(true)
  })

  it('仅删除记忆时保留原对话和旧日志', async () => {
    const { db, service } = fixture()
    await service.deleteMemory('memory-delete', false)
    expect(db.prepare('SELECT count(*) AS count FROM thread_messages').get()).toEqual({ count: 3 })
    expect(db.prepare('SELECT count(*) AS count FROM conversation_logs').get()).toEqual({
      count: 2,
    })
    expect(db.prepare('SELECT count(*) AS count FROM event_notes').get()).toEqual({ count: 0 })
  })

  it('删除所有入边出边及包含旧快照的决策，保留其他事件的关系与待办', async () => {
    const { db, service, now, rebuildAgentStore } = fixture()
    const relation = db.prepare(
      'INSERT INTO event_memory_relations(id,agent_id,source_id,target_id,relation,created_at) VALUES(?,?,?,?,?,?)',
    )
    relation.run('outgoing', 'pero', 'memory-delete', 'memory-keep', 'same_topic', now)
    relation.run('incoming', 'pero', 'memory-keep', 'memory-delete', 'caused_by', now)
    relation.run('unrelated', 'pero', 'memory-keep', 'memory-other', 'same_topic', now)
    const task = db.prepare(
      'INSERT INTO event_memory_reflection_tasks(id,agent_id,event_id,created_at,updated_at) VALUES(?,?,?,?,?)',
    )
    task.run('task-delete', 'pero', 'memory-delete', now, now)
    task.run('task-keep', 'pero', 'memory-keep', now, now)
    const operation = db.prepare(
      'INSERT INTO event_memory_operations(operation_id,agent_id,operation,payload_json,created_at) VALUES(?,?,?,?,?)',
    )
    operation.run(
      'decision-stale',
      'pero',
      'reflection_decision',
      JSON.stringify({
        event: { id: 'memory-keep' },
        candidates: [{ id: 'memory-delete', narrative: '待删除正文' }],
      }),
      now,
    )
    operation.run(
      'decision-keep',
      'pero',
      'reflection_decision',
      '{"event":{"id":"memory-other"}}',
      now,
    )
    await service.deleteMemory('memory-delete')
    expect(db.prepare('SELECT id FROM event_memory_relations').all()).toEqual([{ id: 'unrelated' }])
    expect(db.prepare('SELECT id FROM event_memory_reflection_tasks').all()).toEqual([
      { id: 'task-keep' },
    ])
    expect(db.prepare('SELECT operation_id FROM event_memory_operations').all()).toEqual([
      { operation_id: 'decision-keep' },
    ])
    expect(rebuildAgentStore).toHaveBeenCalledWith('pero', true)
  })

  it('启动时接续已达重试上限的清理记录，不需要重新建立删除任务', async () => {
    const { db, service, origin, now, rebuildAgentStore } = fixture()
    const metadata = {
      ids: ['memory-delete'],
      agents: ['pero'],
      sources: [{ threadId: origin.threadId, pairIds: origin.pairIds }],
      deleteSource: true,
    }
    db.prepare(
      'INSERT INTO privacy_deletions(id,kind,target_id,agent_id,metadata_json,status,attempts,last_error,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      'failed-job',
      'memory',
      'memory-delete',
      'pero',
      JSON.stringify(metadata),
      'failed',
      5,
      'SqliteError: no such column: thread_id',
      now,
    )

    await service.initialize()

    expect(
      db
        .prepare("SELECT id,status,attempts,last_error FROM privacy_deletions WHERE kind='memory'")
        .all(),
    ).toEqual([{ id: 'failed-job', status: 'completed', attempts: 1, last_error: null }])
    expect(rebuildAgentStore).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT 1 FROM event_notes WHERE id=?').get('memory-delete')).toBeUndefined()
  })
})
