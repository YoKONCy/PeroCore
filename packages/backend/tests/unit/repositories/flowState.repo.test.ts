import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flowStateRevisions, flowStates } from '@infos/backend/database/schema'
import { FlowStateRepository } from '@infos/backend/repositories/flowState.repo'

let sqlite: Database.Database

describe('FlowStateRepository 对话检查点回退', () => {
  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE flow_states (
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        current_goal TEXT DEFAULT '' NOT NULL,
        private_facts TEXT DEFAULT '' NOT NULL,
        work_context TEXT DEFAULT '' NOT NULL,
        work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL,
        revision INTEGER DEFAULT 1 NOT NULL,
        updated_by_pair_id TEXT,
        updated_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
      CREATE UNIQUE INDEX idx_flow_states_thread_agent ON flow_states(thread_id, agent_id);
      CREATE TABLE flow_state_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        pair_id TEXT,
        before_current_goal TEXT DEFAULT '' NOT NULL,
        before_private_facts TEXT DEFAULT '' NOT NULL,
        after_current_goal TEXT DEFAULT '' NOT NULL,
        after_private_facts TEXT DEFAULT '' NOT NULL,
        before_work_context TEXT DEFAULT '' NOT NULL,
        before_work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL,
        after_work_context TEXT DEFAULT '' NOT NULL,
        after_work_context_updated_at_pair_count INTEGER DEFAULT 0 NOT NULL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')) NOT NULL
      );
    `)
  })

  afterEach(() => sqlite.close())

  it('A 与 D 更新心流时，撤销 D 后恢复到 A 完成后的状态', async () => {
    const db = drizzle(sqlite, { schema: { flowStates, flowStateRevisions } })
    const repo = new FlowStateRepository(db as never)

    await repo.save({
      threadId: 'thread-1',
      agentId: 'nana',
      pairId: 'A',
      currentGoal: '主持海龟汤',
      privateFacts: 'A 的汤底',
    })
    await repo.save({
      threadId: 'thread-1',
      agentId: 'nana',
      pairId: 'D',
      currentGoal: '继续主持并回应新线索',
      privateFacts: 'D 更新后的汤底进度',
    })

    await repo.rollbackPairs('thread-1', ['D'])

    expect(await repo.get('thread-1', 'nana')).toMatchObject({
      currentGoal: '主持海龟汤',
      privateFacts: 'A 的汤底',
    })
  })

  it('同一待撤销轮次多次更新时恢复到该轮开始前的状态', async () => {
    const db = drizzle(sqlite, { schema: { flowStates, flowStateRevisions } })
    const repo = new FlowStateRepository(db as never)
    await repo.save({
      threadId: 'thread-1',
      agentId: 'nana',
      pairId: 'A',
      currentGoal: 'A 目标',
      privateFacts: 'A 事实',
    })
    await repo.save({
      threadId: 'thread-1',
      agentId: 'nana',
      pairId: 'D',
      currentGoal: 'D 第一次',
      privateFacts: 'A 事实',
    })
    await repo.save({
      threadId: 'thread-1',
      agentId: 'nana',
      pairId: 'D',
      currentGoal: 'D 第二次',
      privateFacts: 'D 事实',
    })

    await repo.rollbackPairs('thread-1', ['D'])

    expect(await repo.get('thread-1', 'nana')).toMatchObject({
      currentGoal: 'A 目标',
      privateFacts: 'A 事实',
    })
  })
})
