/**
 * social-ports.types — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
export interface SocialMessageRecord {
  id: number
  msgId: string
  platform: string
  accountId: string
  channelId: string
  channelType: string
  senderId: string
  senderName: string
  content: string
  agentId: string
  rawEventJson: string
  isSummarized: boolean
  timestamp: string | null
}

export interface SocialContactImpressionRecord {
  id: number
  agentId: string
  platform: string
  userId: string
  displayName: string
  identity: string
  impression: string
  sourceChannelId: string | null
  updatedAt: string
}

export interface SocialSyncCursorRecord {
  agentId: string
  platform: string
  accountId: string
  lastSuccessfulSyncAt: number
  syncStartedAt: number | null
  status: string
  lastError: string | null
}

/** 恢复记录归 Social Realm 所有；终态只保留标识与结果，不保留上下文正文。 */
export interface SocialTurnRecord {
  id: string
  agentId: string
  accountId: string
  channelType: 'private' | 'group'
  channelId: string
  status:
    | 'running'
    | 'retrying'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'delivery_unknown'
  startedAt: string
  deadline: string
  attempts: number
  error?: string
  updatedAt: string
  checkpoint: Record<string, unknown>
  sourceMessageIds?: string[]
  outcome?: 'reply' | 'pass' | 'wait' | 'defer'
  acknowledgedAt?: string
}

export interface SocialStoragePort {
  /** 只控制后台炼化，不影响已有社交记忆的读取。 */
  readonly memoryBackground?: import('../memorySettings').MemoryBackgroundPolicy
  getTurn(id: string): Promise<SocialTurnRecord | null>
  saveTurn(record: SocialTurnRecord): Promise<void>
  listRecoverableTurns(agentId: string, includeTerminal?: boolean): Promise<SocialTurnRecord[]>
  deleteTurns(agentId: string, channelType?: string, channelId?: string): Promise<void>
  getDataVersion(agentId: string, channelType?: string, channelId?: string): Promise<number>
  forgetLongMemory(agentId: string): Promise<void>
  deleteLongMemory(agentId: string): Promise<void>
  memoryAvailable(agentId: string): Promise<boolean>
  queuedMessages(agentId: string): Promise<SocialMessageRecord[]>
  completeQueuedMessages(agentId: string, accountId: string, msgIds: string[]): Promise<void>
  insert(msg: {
    msgId: string
    platform: string
    accountId?: string
    channelId: string
    channelType: string
    senderId: string
    senderName: string
    content: string
    agentId: string
    rawEventJson?: string
    timestamp?: string
    queueForReply?: boolean
    turnId?: string
  }): Promise<void>
  getRecent(
    agentId: string,
    channelId: string,
    channelType: string,
    limit?: number,
  ): Promise<SocialMessageRecord[]>
  getRecentChannels(
    agentId: string,
    limit?: number,
  ): Promise<Array<{ channelId: string; channelType: string; lastTimestamp: string | null }>>
  getRecentPrivateBySender(
    agentId: string,
    senderId: string,
    limit?: number,
  ): Promise<SocialMessageRecord[]>
  getRecentBySender(
    agentId: string,
    senderId: string,
    limit?: number,
  ): Promise<SocialMessageRecord[]>
  getByMsgId(
    agentId: string,
    msgId: string,
    accountId?: string,
  ): Promise<SocialMessageRecord | null>
  getRecentGroupsByContact(agentId: string, userId: string, groupLimit?: number): Promise<string[]>
  getRecentSelfGroupMessages(
    agentId: string,
    groupId: string,
    limit?: number,
  ): Promise<SocialMessageRecord[]>
  getContactGroupMessages(
    agentId: string,
    senderId: string,
    groupId: string,
    limit?: number,
  ): Promise<SocialMessageRecord[]>
  getContactImpression(
    agentId: string,
    platform: string,
    userId: string,
  ): Promise<SocialContactImpressionRecord | null>
  upsertContactImpression(input: {
    turnId?: string
    agentId: string
    platform: string
    userId: string
    displayName?: string
    identity?: string
    impression: string
    sourceChannelId?: string
  }): Promise<void>
  listContactImpressions(agentId: string): Promise<SocialContactImpressionRecord[]>
  countChannelMessages(agentId: string, channelType: string, channelId: string): Promise<number>
  deleteChannelMessages(agentId: string, channelType: string, channelId: string): Promise<number>
  deleteAllMessages(agentId: string): Promise<number>
  deleteContactImpression(agentId: string, platform: string, userId: string): Promise<void>
  deleteAllContactImpressions(agentId: string): Promise<number>
  isDeletedByTombstone(input: {
    agentId: string
    platform: string
    accountId: string
    channelType: string
    channelId: string
    timestamp: number
  }): Promise<boolean>
  upsertTombstone(input: {
    agentId: string
    platform: string
    accountId?: string
    channelType?: string
    channelId?: string
    deletedBefore: number
  }): Promise<void>
  getSyncCursor(
    agentId: string,
    platform: string,
    accountId: string,
  ): Promise<SocialSyncCursorRecord | null>
  markSyncStarted(
    agentId: string,
    platform: string,
    accountId: string,
    startedAt: number,
  ): Promise<void>
  markSyncCompleted(
    agentId: string,
    platform: string,
    accountId: string,
    completedThrough: number,
  ): Promise<void>
  markSyncFailed(agentId: string, platform: string, accountId: string, error: string): Promise<void>
  getRecentChannelsForPlatform(
    platform: string,
    limit?: number,
  ): Promise<Array<{ agentId: string; channelId: string; channelType: string }>>
  getUnsummarizedStats(agentId: string): Promise<{ count: number; totalChars: number }>
  getUnsummarized(agentId: string, limit?: number): Promise<SocialMessageRecord[]>
  markSummarized(messageIds: number[]): Promise<void>
}

export interface SocialExecutionPort {
  run<T>(input: {
    taskId: string
    class: 'background' | 'resident'
    priority?: number
    resourceKey?: string
    maxDurationMs: number
    signal?: AbortSignal
    run(context: {
      signal: AbortSignal
      executionId: string
      processId: string
      consume(usage: Record<string, number>): void
      beginIo(): () => void
    }): Promise<T>
  }): Promise<T>
}

export interface SocialEventPort {
  publish(action: string, data: Record<string, unknown>): Promise<void>
}
