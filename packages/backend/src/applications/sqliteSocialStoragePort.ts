import { currentKernelExecution } from '../kernel/executionContext'
import type { KernelOutboxRepository } from '../kernel/kernelOutboxRepository'
import type Database from 'better-sqlite3'
import type { SocialTurnRecord } from '@infos/shared'
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
    private readonly purgeMemory?: (agentId: string) => Promise<void>,
    readonly memoryBackground?: import('@infos/shared').MemoryBackgroundPolicy,
  ) {}

  async getTurn(id: string): Promise<SocialTurnRecord | null> {
    const row = this.db.prepare('SELECT record_json FROM social_turns WHERE id=?').get(id) as
      | { record_json: string }
      | undefined
    return row ? (JSON.parse(row.record_json) as SocialTurnRecord) : null
  }

  async saveTurn(record: SocialTurnRecord): Promise<void> {
    const fence = this.db
      .prepare(
        "SELECT max(cleared_at) AS value FROM social_data_fences WHERE agent_id=? AND (channel_type='' OR (channel_type=? AND channel_id=?))",
      )
      .get(record.agentId, record.channelType, record.channelId) as { value: number | null }
    if (fence.value !== null && Date.parse(record.startedAt) <= fence.value)
      throw new Error('社交数据已清理，已阻止旧任务回写')
    this.db
      .prepare(
        `INSERT INTO social_turns(id,agent_id,account_id,channel_type,channel_id,status,record_json,updated_at)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,record_json=excluded.record_json,updated_at=excluded.updated_at`,
      )
      .run(
        record.id,
        record.agentId,
        record.accountId,
        record.channelType,
        record.channelId,
        record.status,
        JSON.stringify(record),
        record.updatedAt,
      )
  }

  async listRecoverableTurns(
    agentId: string,
    includeTerminal = false,
  ): Promise<SocialTurnRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT record_json FROM social_turns WHERE agent_id=? AND status IN ('running','retrying','waiting') ORDER BY updated_at DESC",
      )
      .all(agentId) as Array<{ record_json: string }>
    if (includeTerminal)
      rows.push(
        ...(this.db
          .prepare(
            "SELECT record_json FROM social_turns WHERE agent_id=? AND status NOT IN ('running','retrying','waiting') ORDER BY updated_at DESC LIMIT 100",
          )
          .all(agentId) as Array<{ record_json: string }>),
      )
    return rows.map((row) => JSON.parse(row.record_json) as SocialTurnRecord)
  }

  async deleteTurns(agentId: string, channelType?: string, channelId?: string): Promise<void> {
    this.clearTurnRows(agentId, channelType, channelId)
  }
  private clearTurnRows(agentId: string, channelType?: string, channelId?: string): void {
    this.db.transaction(() => {
      const id = JSON.stringify([agentId, channelType ?? '', channelId ?? ''])
      this.db
        .prepare(
          `INSERT INTO social_data_fences(id,agent_id,channel_type,channel_id,version,cleared_at) VALUES(?,?,?,?,1,?)
        ON CONFLICT(id) DO UPDATE SET version=version+1,cleared_at=excluded.cleared_at`,
        )
        .run(id, agentId, channelType ?? '', channelId ?? '', Date.now())
      if (channelType && channelId) {
        this.db
          .prepare(
            'DELETE FROM social_inbox WHERE agent_id=? AND msg_id IN (SELECT msg_id FROM social_messages WHERE agent_id=? AND channel_type=? AND channel_id=?)',
          )
          .run(agentId, agentId, channelType, channelId)
        this.db
          .prepare('DELETE FROM social_turns WHERE agent_id=? AND channel_type=? AND channel_id=?')
          .run(agentId, channelType, channelId)
      } else {
        this.db.prepare('DELETE FROM social_inbox WHERE agent_id=?').run(agentId)
        this.db.prepare('DELETE FROM social_turns WHERE agent_id=?').run(agentId)
      }
    })()
  }
  async getDataVersion(agentId: string, channelType?: string, channelId?: string): Promise<number> {
    return (
      this.db
        .prepare(
          `SELECT coalesce(sum(version),0) AS value FROM social_data_fences WHERE agent_id=?
      ${channelType && channelId ? "AND (channel_type='' OR (channel_type=? AND channel_id=?))" : ''}`,
        )
        .get(agentId, ...(channelType && channelId ? [channelType, channelId] : [])) as {
        value: number
      }
    ).value
  }
  async queuedMessages(agentId: string): Promise<SocialMessageRecord[]> {
    return this.db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM social_messages WHERE agent_id=?
      AND EXISTS(SELECT 1 FROM social_inbox i WHERE i.agent_id=social_messages.agent_id AND i.account_id=social_messages.account_id AND i.msg_id=social_messages.msg_id)
      AND NOT EXISTS(SELECT 1 FROM social_turns t,json_each(t.record_json,'$.sourceMessageIds') refs
        WHERE t.agent_id=social_messages.agent_id AND t.account_id=social_messages.account_id
        AND refs.value=social_messages.msg_id)
      ORDER BY id LIMIT 1000`,
      )
      .all(agentId) as SocialMessageRecord[]
  }
  async completeQueuedMessages(
    agentId: string,
    accountId: string,
    msgIds: string[],
  ): Promise<void> {
    this.db
      .prepare(
        'DELETE FROM social_inbox WHERE agent_id=? AND account_id=? AND msg_id IN (SELECT value FROM json_each(?))',
      )
      .run(agentId, accountId, JSON.stringify(msgIds))
  }
  async forgetLongMemory(agentId: string): Promise<void> {
    this.db.transaction(() => {
      this.clearTurnRows(agentId)
      this.db.prepare('UPDATE social_messages SET is_summarized=1 WHERE agent_id=?').run(agentId)
    })()
  }
  async deleteLongMemory(agentId: string): Promise<void> {
    if (!this.purgeMemory) throw new Error('社交记忆清理服务尚未就绪')
    await this.purgeMemory(agentId)
  }
  async memoryAvailable(agentId: string): Promise<boolean> {
    return !this.db
      .prepare(
        `SELECT 1 FROM privacy_deletions p,json_each(p.metadata_json,'$.agents') agents
      WHERE p.status!='completed' AND (p.kind='social-memory' OR (p.kind='reset-memory' AND json_extract(p.metadata_json,'$.includeSocial')=1))
      AND agents.value=? LIMIT 1`,
      )
      .get(agentId)
  }

  async insert(message: Parameters<SocialStoragePort['insert']>[0]): Promise<void> {
    const transaction = this.db.transaction(() => {
      this.assertTurnWritable(message.turnId, message.agentId)
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
      if (inserted.changes && message.queueForReply)
        this.db
          .prepare('INSERT OR IGNORE INTO social_inbox(agent_id,account_id,msg_id) VALUES(?,?,?)')
          .run(message.agentId, message.accountId ?? '', message.msgId)
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
  async getByMsgId(
    agentId: string,
    msgId: string,
    accountId?: string,
  ): Promise<SocialMessageRecord | null> {
    return (
      (this.db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM social_messages WHERE agent_id=? AND msg_id=? ${accountId === undefined ? '' : 'AND account_id=?'} LIMIT 1`,
        )
        .get(agentId, msgId, ...(accountId === undefined ? [] : [accountId])) as
        | SocialMessageRecord
        | undefined) ?? null
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
    const startedAt = this.assertTurnWritable(input.turnId, input.agentId)
    const target = JSON.stringify([input.agentId, input.platform, input.userId])
    const fence = this.db
      .prepare(
        "SELECT json_extract(metadata_json,'$.clearedAt') AS value FROM privacy_deletions WHERE kind='social-contact' AND target_id=?",
      )
      .get(target) as { value: number } | undefined
    if (startedAt !== undefined && fence && startedAt <= fence.value)
      throw new Error('联系人印象已被删除，已阻止旧任务重新写入')
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
    this.db.transaction(() => {
      const target = JSON.stringify([agentId, platform, userId])
      this.db
        .prepare(
          `INSERT INTO privacy_deletions(id,kind,target_id,agent_id,metadata_json,status,created_at)
        VALUES(?,'social-contact',?,?,?,'completed',?) ON CONFLICT(kind,target_id) DO UPDATE SET metadata_json=excluded.metadata_json`,
        )
        .run(
          `social-contact:${target}`,
          target,
          agentId,
          JSON.stringify({ clearedAt: Date.now() }),
          new Date().toISOString(),
        )
      this.db
        .prepare(
          `DELETE FROM social_contact_impressions WHERE agent_id=? AND platform=? AND user_id=?`,
        )
        .run(agentId, platform, userId)
    })()
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
  private assertTurnWritable(id?: string, agentId?: string): number | undefined {
    if (!id) return
    const row = this.db
      .prepare(
        "SELECT json_extract(record_json,'$.startedAt') AS startedAt FROM social_turns WHERE id=? AND agent_id=? AND status IN ('running','retrying')",
      )
      .get(id, agentId ?? '') as { startedAt: string } | undefined
    if (!row) throw new Error('社交任务已经取消或数据已经清理，已阻止旧结果回写')
    return Date.parse(row.startedAt)
  }
}

const MESSAGE_COLUMNS = `id,msg_id AS msgId,platform,account_id AS accountId,channel_id AS channelId,
channel_type AS channelType,sender_id AS senderId,sender_name AS senderName,content,agent_id AS agentId,
raw_event_json AS rawEventJson,is_summarized AS isSummarized,timestamp`
