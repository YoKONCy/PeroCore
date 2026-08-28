import { currentKernelExecution } from '../kernel/executionContext'
import type { KernelOutboxRepository } from '../kernel/kernelOutboxRepository'
import type Database from 'better-sqlite3'
import type {
  SocialContactImpressionRecord,
  SocialMessageRecord,
  SocialStoragePort,
  SocialSyncCursorRecord,
} from '../applications/socialPorts'

/** Kernel侧Social存储Authority；Social Realm只获得收窄Port。 */
export class SqliteSocialStoragePort implements SocialStoragePort {
  constructor(
    private readonly db: Database.Database,
    private readonly outbox?: KernelOutboxRepository,
  ) {}

  async insert(message: Parameters<SocialStoragePort['insert']>[0]): Promise<void> {
    const transaction = this.db.transaction(() => {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO social_messages
        (msg_id, platform, account_id, channel_id, channel_type, sender_id, sender_name, content, agent_id, raw_event_json, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))`,
        )
        .run(
          message.msgId,
          message.platform,
          message.accountId ?? '',
          message.channelId,
          message.channelType,
          message.senderId,
          message.senderName,
          message.content,
          message.agentId,
          message.rawEventJson ?? '{}',
          message.timestamp ?? null,
        )
      const execution = currentKernelExecution()
      if (!inserted.changes || !execution || !this.outbox) return
      const event = this.outbox.createEvent({
        protocolVersion: 1,
        type: 'social.message.committed',
        durability: 'durable',
        principalId: execution.principalId,
        processId: execution.processId,
        executionId: execution.executionId,
        correlationId: execution.executionId,
        payload: {
          msgId: message.msgId,
          platform: message.platform,
          channelId: message.channelId,
          channelType: message.channelType,
          agentId: message.agentId,
        },
      })
      const row = this.outbox.toRow(event)
      this.db
        .prepare(
          `INSERT INTO kernel_outbox_events
          (event_id,event_type,durability,principal_id,process_id,execution_id,correlation_id,causation_id,
           object_type,object_id,object_generation,payload_json,occurred_at,status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          row.eventId,
          row.eventType,
          row.durability,
          row.principalId,
          row.processId,
          row.executionId,
          row.correlationId,
          row.causationId,
          row.objectType,
          row.objectId,
          row.objectGeneration,
          row.payloadJson,
          row.occurredAt,
          row.status,
        )
    })
    transaction()
  }

  async getRecent(agentId: string, channelId: string, channelType: string, limit = 20) {
    return this.messages(
      `agent_id=? AND channel_id=? AND channel_type=?`,
      [agentId, channelId, channelType],
      limit,
    )
  }
  async getRecentPrivateBySender(agentId: string, senderId: string, limit = 10) {
    return this.messages(
      `agent_id=? AND channel_type='private' AND channel_id=?`,
      [agentId, senderId],
      limit,
    )
  }
  async getRecentBySender(agentId: string, senderId: string, limit = 20) {
    return this.messages(`agent_id=? AND sender_id=?`, [agentId, senderId], limit)
  }
  async getRecentSelfGroupMessages(agentId: string, groupId: string, limit = 5) {
    return this.messages(
      `agent_id=? AND channel_type='group' AND channel_id=? AND sender_id='self'`,
      [agentId, groupId],
      limit,
    )
  }
  async getContactGroupMessages(agentId: string, senderId: string, groupId: string, limit = 30) {
    return this.messages(
      `agent_id=? AND channel_type='group' AND channel_id=? AND sender_id=?`,
      [agentId, groupId, senderId],
      limit,
    )
  }
  async getByMsgId(agentId: string, msgId: string): Promise<SocialMessageRecord | null> {
    return (
      (this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM social_messages WHERE agent_id=? AND msg_id=? LIMIT 1`,
        )
        .get(agentId, msgId) as SocialMessageRecord | undefined) ?? null
    )
  }
  async getRecentChannels(agentId: string, limit = 10) {
    const rows = this.db
      .prepare(
        `SELECT channel_id AS channelId, channel_type AS channelType, timestamp AS lastTimestamp
      FROM social_messages WHERE agent_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(agentId, limit * 5) as Array<{
      channelId: string
      channelType: string
      lastTimestamp: string | null
    }>
    const seen = new Set<string>()
    return rows.filter((row) => {
      const key = `${row.channelId}:${row.channelType}`
      if (seen.has(key) || seen.size >= limit) return false
      seen.add(key)
      return true
    })
  }
  async getRecentGroupsByContact(agentId: string, userId: string, groupLimit = 5) {
    const rows = this.db
      .prepare(
        `SELECT channel_id AS channelId FROM social_messages
      WHERE agent_id=? AND channel_type='group' AND sender_id=? ORDER BY id DESC LIMIT ?`,
      )
      .all(agentId, userId, groupLimit * 20) as Array<{ channelId: string }>
    return [...new Set(rows.map((row) => row.channelId))].slice(0, groupLimit)
  }

  async getContactImpression(agentId: string, platform: string, userId: string) {
    return (
      (this.db
        .prepare(
          `SELECT id, agent_id AS agentId, platform, user_id AS userId, display_name AS displayName,
      identity, impression, source_channel_id AS sourceChannelId, updated_at AS updatedAt
      FROM social_contact_impressions WHERE agent_id=? AND platform=? AND user_id=? LIMIT 1`,
        )
        .get(agentId, platform, userId) as SocialContactImpressionRecord | undefined) ?? null
    )
  }
  async upsertContactImpression(
    input: Parameters<SocialStoragePort['upsertContactImpression']>[0],
  ) {
    this.db
      .prepare(
        `INSERT INTO social_contact_impressions
      (agent_id,platform,user_id,display_name,identity,impression,source_channel_id)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(agent_id,platform,user_id) DO UPDATE SET
      display_name=excluded.display_name, identity=CASE WHEN excluded.identity='' THEN identity ELSE excluded.identity END,
      impression=excluded.impression, source_channel_id=excluded.source_channel_id, updated_at=datetime('now','localtime')`,
      )
      .run(
        input.agentId,
        input.platform,
        input.userId,
        input.displayName ?? '',
        input.identity ?? '',
        input.impression,
        input.sourceChannelId ?? null,
      )
  }
  async listContactImpressions(agentId: string) {
    return this.db
      .prepare(
        `SELECT id, agent_id AS agentId, platform, user_id AS userId, display_name AS displayName,
      identity, impression, source_channel_id AS sourceChannelId, updated_at AS updatedAt
      FROM social_contact_impressions WHERE agent_id=? ORDER BY updated_at DESC`,
      )
      .all(agentId) as SocialContactImpressionRecord[]
  }
  async deleteContactImpression(agentId: string, platform: string, userId: string) {
    this.db
      .prepare(
        `DELETE FROM social_contact_impressions WHERE agent_id=? AND platform=? AND user_id=?`,
      )
      .run(agentId, platform, userId)
  }
  async deleteAllContactImpressions(agentId: string) {
    return this.db.prepare(`DELETE FROM social_contact_impressions WHERE agent_id=?`).run(agentId)
      .changes
  }

  async countChannelMessages(agentId: string, channelType: string, channelId: string) {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS total FROM social_messages WHERE agent_id=? AND channel_type=? AND channel_id=?`,
          )
          .get(agentId, channelType, channelId) as { total: number }
      ).total,
    )
  }
  async deleteChannelMessages(agentId: string, channelType: string, channelId: string) {
    return this.db
      .prepare(`DELETE FROM social_messages WHERE agent_id=? AND channel_type=? AND channel_id=?`)
      .run(agentId, channelType, channelId).changes
  }
  async deleteAllMessages(agentId: string) {
    return this.db.prepare(`DELETE FROM social_messages WHERE agent_id=?`).run(agentId).changes
  }

  async isDeletedByTombstone(input: Parameters<SocialStoragePort['isDeletedByTombstone']>[0]) {
    const rows = this.db
      .prepare(
        `SELECT account_id AS accountId, channel_type AS channelType, channel_id AS channelId,
      deleted_before AS deletedBefore FROM social_history_tombstones WHERE agent_id=? AND platform=?`,
      )
      .all(input.agentId, input.platform) as Array<{
      accountId: string
      channelType: string
      channelId: string
      deletedBefore: number
    }>
    return rows.some(
      (row) =>
        (row.accountId === '' || row.accountId === input.accountId) &&
        (row.channelType === '*' || row.channelType === input.channelType) &&
        (row.channelId === '*' || row.channelId === input.channelId) &&
        input.timestamp <= row.deletedBefore,
    )
  }
  async upsertTombstone(input: Parameters<SocialStoragePort['upsertTombstone']>[0]) {
    this.db
      .prepare(
        `INSERT INTO social_history_tombstones(agent_id,platform,account_id,channel_type,channel_id,deleted_before)
      VALUES(?,?,?,?,?,?) ON CONFLICT(agent_id,platform,account_id,channel_type,channel_id) DO UPDATE SET
      deleted_before=excluded.deleted_before, created_at=datetime('now','localtime')`,
      )
      .run(
        input.agentId,
        input.platform,
        input.accountId ?? '',
        input.channelType ?? '*',
        input.channelId ?? '*',
        input.deletedBefore,
      )
  }

  async getSyncCursor(agentId: string, platform: string, accountId: string) {
    return (
      (this.db
        .prepare(
          `SELECT agent_id AS agentId, platform, account_id AS accountId,
      last_successful_sync_at AS lastSuccessfulSyncAt, sync_started_at AS syncStartedAt, status, last_error AS lastError
      FROM social_sync_cursors WHERE agent_id=? AND platform=? AND account_id=? LIMIT 1`,
        )
        .get(agentId, platform, accountId) as SocialSyncCursorRecord | undefined) ?? null
    )
  }
  async markSyncStarted(agentId: string, platform: string, accountId: string, startedAt: number) {
    this.db
      .prepare(
        `INSERT INTO social_sync_cursors(agent_id,platform,account_id,sync_started_at,status,last_error)
      VALUES(?,?,?,?,'running',NULL) ON CONFLICT(agent_id,platform,account_id) DO UPDATE SET
      sync_started_at=excluded.sync_started_at,status='running',last_error=NULL,updated_at=datetime('now','localtime')`,
      )
      .run(agentId, platform, accountId, startedAt)
  }
  async markSyncCompleted(
    agentId: string,
    platform: string,
    accountId: string,
    completedThrough: number,
  ) {
    this.db
      .prepare(
        `INSERT INTO social_sync_cursors(agent_id,platform,account_id,last_successful_sync_at,status,last_error)
      VALUES(?,?,?,?,'idle',NULL) ON CONFLICT(agent_id,platform,account_id) DO UPDATE SET
      last_successful_sync_at=excluded.last_successful_sync_at,sync_started_at=NULL,status='idle',last_error=NULL,updated_at=datetime('now','localtime')`,
      )
      .run(agentId, platform, accountId, completedThrough)
  }
  async markSyncFailed(agentId: string, platform: string, accountId: string, error: string) {
    this.db
      .prepare(
        `UPDATE social_sync_cursors SET status='failed',last_error=?,updated_at=datetime('now','localtime')
      WHERE agent_id=? AND platform=? AND account_id=?`,
      )
      .run(error, agentId, platform, accountId)
  }
  async getRecentChannelsForPlatform(platform: string, limit = 100) {
    return this.db
      .prepare(
        `SELECT agent_id AS agentId,channel_id AS channelId,channel_type AS channelType
      FROM social_messages WHERE platform=? GROUP BY agent_id,channel_id,channel_type ORDER BY MAX(timestamp) DESC LIMIT ?`,
      )
      .all(platform, limit) as Array<{ agentId: string; channelId: string; channelType: string }>
  }

  async getUnsummarizedStats(agentId: string) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count,COALESCE(SUM(LENGTH(content)),0) AS totalChars FROM social_messages WHERE agent_id=? AND is_summarized=0`,
      )
      .get(agentId) as { count: number; totalChars: number }
    return { count: Number(row.count), totalChars: Number(row.totalChars) }
  }
  async getUnsummarized(agentId: string, limit = 200) {
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM social_messages WHERE agent_id=? AND is_summarized=0 ORDER BY id LIMIT ?`,
      )
      .all(agentId, limit) as SocialMessageRecord[]
  }
  async markSummarized(messageIds: number[]) {
    if (!messageIds.length) return
    const update = this.db.prepare(`UPDATE social_messages SET is_summarized=1 WHERE id=?`)
    this.db.transaction((ids: number[]) => {
      for (const id of ids) update.run(id)
    })(messageIds)
  }

  private async messages(
    where: string,
    args: unknown[],
    limit: number,
  ): Promise<SocialMessageRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM social_messages WHERE ${where} ORDER BY id DESC LIMIT ?`,
        )
        .all(...args, limit) as SocialMessageRecord[]
    ).reverse()
  }
}

const MESSAGE_COLUMNS = `id,msg_id AS msgId,platform,account_id AS accountId,channel_id AS channelId,
channel_type AS channelType,sender_id AS senderId,sender_name AS senderName,content,agent_id AS agentId,
raw_event_json AS rawEventJson,is_summarized AS isSummarized,timestamp`
