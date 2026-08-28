import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { SqliteSocialStoragePort } from '@infos/backend/applications/sqliteSocialStoragePort'
import { KernelOutboxRepository, runWithKernelExecution } from '@infos/backend/kernel'

let db: Database.Database
let port: SqliteSocialStoragePort

beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE social_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,msg_id TEXT NOT NULL,platform TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',channel_id TEXT NOT NULL,channel_type TEXT NOT NULL,sender_id TEXT NOT NULL,sender_name TEXT NOT NULL DEFAULT '',content TEXT NOT NULL,agent_id TEXT NOT NULL,raw_event_json TEXT NOT NULL DEFAULT '{}',timestamp TEXT,is_summarized INTEGER DEFAULT 0,UNIQUE(agent_id,platform,account_id,msg_id));
    CREATE TABLE social_contact_impressions(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL,platform TEXT NOT NULL,user_id TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',identity TEXT NOT NULL DEFAULT '',impression TEXT NOT NULL,source_channel_id TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(agent_id,platform,user_id));
    CREATE TABLE social_history_tombstones(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL,platform TEXT NOT NULL,account_id TEXT NOT NULL DEFAULT '',channel_type TEXT NOT NULL DEFAULT '*',channel_id TEXT NOT NULL DEFAULT '*',deleted_before INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(agent_id,platform,account_id,channel_type,channel_id));
    CREATE TABLE social_sync_cursors(id INTEGER PRIMARY KEY AUTOINCREMENT,agent_id TEXT NOT NULL,platform TEXT NOT NULL,account_id TEXT NOT NULL,last_successful_sync_at INTEGER NOT NULL DEFAULT 0,sync_started_at INTEGER,status TEXT NOT NULL DEFAULT 'idle',last_error TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(agent_id,platform,account_id));
    CREATE TABLE kernel_outbox_events(event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,durability TEXT NOT NULL,principal_id TEXT NOT NULL,process_id TEXT,execution_id TEXT,correlation_id TEXT,causation_id TEXT,object_type TEXT,object_id TEXT,object_generation INTEGER,payload_json TEXT NOT NULL,occurred_at TEXT NOT NULL,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,last_error TEXT,next_attempt_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,published_at TEXT);
  `)
  port = new SqliteSocialStoragePort(db)
})
afterEach(() => db.close())

describe('SqliteSocialStoragePort', () => {
  it('Execution内消息与Durable Event应同事务提交并继承因果身份', async () => {
    const outbox = new KernelOutboxRepository(drizzle(db) as never)
    const transactional = new SqliteSocialStoragePort(db, outbox)
    await runWithKernelExecution(
      {
        executionId: 'execution-social',
        processId: 'process-social',
        principalId: 'pero',
        class: 'background',
        priority: 4,
        budget: {},
      } as never,
      () =>
        transactional.insert({
          msgId: 'event-1',
          platform: 'qq',
          channelId: 'g1',
          channelType: 'group',
          senderId: 'self',
          senderName: 'Pero',
          content: '回复',
          agentId: 'pero',
        }),
    )
    const event = db
      .prepare(
        `SELECT event_type AS eventType,execution_id AS executionId,correlation_id AS correlationId,payload_json AS payloadJson FROM kernel_outbox_events`,
      )
      .get() as {
      eventType: string
      executionId: string
      correlationId: string
      payloadJson: string
    }
    expect(event).toMatchObject({
      eventType: 'social.message.committed',
      executionId: 'execution-social',
      correlationId: 'execution-social',
    })
    expect(JSON.parse(event.payloadJson)).toMatchObject({ msgId: 'event-1', channelId: 'g1' })
  })

  it('应完整支持消息写入、去重、查询、总结和删除', async () => {
    const message = {
      msgId: 'm1',
      platform: 'qq',
      accountId: 'a1',
      channelId: 'g1',
      channelType: 'group',
      senderId: 'u1',
      senderName: '用户',
      content: '你好',
      agentId: 'pero',
      rawEventJson: '{}',
      timestamp: '2026-01-01 00:00:00',
    }
    await port.insert(message)
    await port.insert(message)
    expect(await port.countChannelMessages('pero', 'group', 'g1')).toBe(1)
    expect(await port.getRecent('pero', 'g1', 'group')).toMatchObject([
      { msgId: 'm1', content: '你好' },
    ])
    expect(await port.getRecentBySender('pero', 'u1')).toHaveLength(1)
    expect(await port.getRecentGroupsByContact('pero', 'u1')).toEqual(['g1'])
    expect(await port.getUnsummarizedStats('pero')).toEqual({ count: 1, totalChars: 2 })
    const unsummarized = await port.getUnsummarized('pero')
    await port.markSummarized(unsummarized.map((item) => item.id))
    expect((await port.getUnsummarizedStats('pero')).count).toBe(0)
    expect(await port.deleteChannelMessages('pero', 'group', 'g1')).toBe(1)
  })

  it('应支持联系人印象、删除墓碑和离线同步游标', async () => {
    await port.upsertContactImpression({
      agentId: 'pero',
      platform: 'qq',
      userId: 'u1',
      identity: '朋友',
      impression: '友好',
    })
    await port.upsertContactImpression({
      agentId: 'pero',
      platform: 'qq',
      userId: 'u1',
      impression: '可靠',
    })
    expect(await port.getContactImpression('pero', 'qq', 'u1')).toMatchObject({
      identity: '朋友',
      impression: '可靠',
    })
    await port.upsertTombstone({
      agentId: 'pero',
      platform: 'qq',
      channelType: 'group',
      channelId: 'g1',
      deletedBefore: 100,
    })
    expect(
      await port.isDeletedByTombstone({
        agentId: 'pero',
        platform: 'qq',
        accountId: '',
        channelType: 'group',
        channelId: 'g1',
        timestamp: 99,
      }),
    ).toBe(true)
    await port.markSyncStarted('pero', 'qq', 'a1', 10)
    expect(await port.getSyncCursor('pero', 'qq', 'a1')).toMatchObject({
      status: 'running',
      syncStartedAt: 10,
    })
    await port.markSyncCompleted('pero', 'qq', 'a1', 20)
    expect(await port.getSyncCursor('pero', 'qq', 'a1')).toMatchObject({
      status: 'idle',
      lastSuccessfulSyncAt: 20,
    })
    await port.deleteContactImpression('pero', 'qq', 'u1')
    expect(await port.getContactImpression('pero', 'qq', 'u1')).toBeNull()
  })
})
