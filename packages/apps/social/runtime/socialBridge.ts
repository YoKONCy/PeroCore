/**
 * SocialBridge — 社交桥接 (Layer 0)
 *
 * 连接 ISocialAdapter ↔ SocialSessionManager ↔ SocialScheduler ↔ 回复回调。
 *
 * 核心职责:
 * 1. 监听 adapter.on('message') → SessionManager 缓冲 → Scheduler 审视 → generateReply()
 * 2. 将 AI 回复 → adapter.sendMessage()
 * 3. 持久化社交消息到 socialMessages 表
 * 4. 通过SocialEventPort推送社交状态到前端
 * 5. 管理适配器/调度器生命周期
 *
 * 方案 B：回复生成回调由 SocialAppRuntime 提供，
 * 使用应用自己的 Compiler + LLM，不再依赖主 Agent 的 AgentService.chat。
 *
 * @module packages/apps/social/runtime/socialBridge
 */

import type { AbstractSocialAdapter } from '../adapters/ISocialAdapter'
import { createHash, randomUUID } from 'node:crypto'
import {
  assertSocialActive,
  currentSocialRecovery,
  finishSocialTurn,
  runSocialRecovery,
  SOCIAL_TURN_DURATION_MS,
  socialDelay,
  socialFailure,
} from './socialRecovery'
import type {
  SocialEventPort,
  SocialExecutionPort,
  SocialStoragePort,
  SocialTurnRecord,
} from '@infos/shared'
import type { InboundRouteRepository } from '@infos/backend/applicationHostAbi'
import type { Attachment, InboundMessage, OutboundMessage } from './types'
import {
  SocialSessionManager,
  type FlushReason,
  type SocialSession,
  type SocialTurnOutcome,
} from './socialSessionManager'
import { SocialScheduler, type SocialSchedulerConfig } from './socialScheduler'
import type { ImageCacheManager } from './imageCacheManager'
import type { StickerService } from './stickerService'
import { splitStickerSegments } from './stickerService'
import {
  formatSocialMessage,
  isSocialMention,
  restoreSocialMessage,
  socialMessageId,
  socialTriggerMessage,
} from './socialMessageContext'
import { createLogger } from '@infos/backend/applicationHostAbi'

const logger = createLogger('SocialBridge')

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface SocialBridgeDeps {
  socialEvents: SocialEventPort
  executions?: SocialExecutionPort
  socialMessageRepo: SocialStoragePort
  /** 图片缓存管理器 (可选) */
  imageCacheManager?: ImageCacheManager
  /** 表情包服务 (可选) */
  stickerService?: StickerService
  /** 入站路由表 Repository (可选，第七阶段 #7：外部消息按来源+标识查询归属 Agent) */
  inboundRouteRepo?: InboundRouteRepository
  /** 入站策略过滤；返回 false 时不持久化、不缓冲、不回复。 */
  shouldAcceptInbound?: (message: InboundMessage) => boolean
  getOwnerId?: () => string | undefined
  getAgentId?: () => string
  /** 发送前再次核验会话是否仍允许激活，阻止锁定前已启动的并发回复漏发。 */
  shouldAllowSession?: (
    session: Pick<SocialSession, 'agentId' | 'channelType' | 'channelId'>,
  ) => boolean
  onMessagePersisted?: (agentId: string) => Promise<void>
  /** 回复生成回调：由 SocialAppRuntime 使用当前角色自己的主模型与 ReAct 执行。 */
  generateReply: (params: {
    signal?: AbortSignal
    taskOrigin?: import('@infos/shared').TaskOrigin
    agentId: string
    channelType: 'private' | 'group'
    channelId: string
    combinedMessage: string
    trigger: FlushReason
    participation: SocialSession['participation']
    deferredIntent?: SocialSession['deferredIntent']
    routeChannel?: string
    routeThreadId?: string
    /**
     * 本次主要对话对象是否为当前配置的主人，由触发者 QQ 严格比对。
     */
    isOwner?: boolean
    /**
     * 触发本次回复的发送者 ID（群聊中是 @ Agent 的人，私聊中是对方）
     *
     * 用于跨会话上下文注入：
     * - 群聊场景下，用此 senderId 查询与该用户的最近私聊记录
     * - 作为补充上下文注入 system prompt，让 Agent 记得与该用户的历史互动
     * - 私聊场景下不需要（因为当前会话本身就是私聊，已在 history 中）
     */
    triggerSenderId?: string
    triggerSenderName?: string
    /**
     * 本次 flush 的消息 msgId 列表（用于从 DB 历史中排除，避免重复）
     *
     * handleInbound 在消息入库时就持久化了，所以 DB 历史已包含本次消息。
     * 如果不从 history 中排除，combinedMessage 会在 messages 中出现两次。
     */
    flushMsgIds?: string[]
    /**
     * 触发消息中的图片附件（data URL 格式，供多模态 LLM 使用）
     *
     * 最多三张，优先触发消息、引用消息，再取同一发送者近期图片。
     */
    images?: string[]
    imageSources?: string[]
    /**
     * Bot 自身 QQ 号（从适配器 accountInfo 获取）
     *
     * 注入到 system prompt 的 <session_context> 中，
     * 让 Agent 知道自己的 QQ 号，用于身份识别和消息归属判断。
     */
    botSelfId?: string
    /**
     * Bot 自身昵称（从适配器 accountInfo 获取）
     *
     * 注入到 system prompt 的 <session_context> 中，
     * 让 Agent 知道自己在 QQ 平台上的昵称。
     */
    botNickname?: string
  }) => Promise<SocialTurnOutcome>
}

// ─────────────────────────────────────────────
// Bridge
// ─────────────────────────────────────────────

export class SocialBridge {
  private deps: SocialBridgeDeps
  /** 已注册的适配器 (platform → adapter) */
  private adapters = new Map<string, AbstractSocialAdapter>()
  /** 运行标记 */
  private running = false
  private turnControllers = new Map<
    string,
    { controller: AbortController; session: SocialSession }
  >()
  private commandControllers = new Map<
    string,
    { controller: AbortController; session: SocialSession }
  >()
  /** 会话管理器 */
  private sessionManager: SocialSessionManager
  /** 图片缓存 */
  private imageCache: ImageCacheManager | null
  /** 表情包服务 */
  private stickerService: StickerService | null
  /** 同一平台只允许一个历史同步任务，避免重连风暴重复补拉。 */
  private historySyncs = new Map<string, Promise<void>>()
  /** 调度器 */
  private scheduler: SocialScheduler

  constructor(deps: SocialBridgeDeps) {
    this.deps = deps
    this.imageCache = deps.imageCacheManager ?? null
    this.stickerService = deps.stickerService ?? null

    // 初始化 SessionManager (flush 回调 → generateReply)
    this.sessionManager = new SocialSessionManager((session, messages, reason, signal) =>
      this.onFlush(session, messages, reason, signal),
    )

    // 初始化 Scheduler：仅做确定性候选排序和到期唤醒，不调用第二个决策模型。
    this.scheduler = new SocialScheduler({
      sessionManager: this.sessionManager,
      executions: deps.executions,
      maintain: async () => {
        const agentId = this.deps.getAgentId?.()
        if (agentId) {
          await this.expireWaitingTurns(agentId)
          await this.refillInbox(agentId)
        }
      },
    })
  }

  getSchedulerConfig(): SocialSchedulerConfig {
    return this.scheduler.getConfig()
  }

  updateSchedulerConfig(config: Partial<SocialSchedulerConfig>): SocialSchedulerConfig {
    return this.scheduler.updateConfig(config)
  }

  // ── 适配器管理 ──

  /** 注册一个社交适配器 */
  registerAdapter(adapter: AbstractSocialAdapter): void {
    const platform = adapter.platform
    if (this.adapters.has(platform)) {
      logger.warn(`适配器 ${platform} 已存在, 将替换`)
      this.unregisterAdapter(platform)
    }

    this.adapters.set(platform, adapter)

    // 监听消息事件 → SessionManager 缓冲
    adapter.on('message', (msg: InboundMessage) => {
      this.handleInbound(msg).catch((err) => {
        logger.error(`处理入站消息失败: ${err}`)
      })
    })

    adapter.on('connected', () => {
      logger.info(`社交适配器已连接: ${platform}`)
      this.notifyFrontend('social_adapter_connected', { platform })
      // 注册连接事件早于 Bot 信息查询，稍后启动补拉以等待账号信息就绪。
      setTimeout(() => {
        if (this.running)
          this.syncOfflineHistory(platform).catch((err) =>
            logger.warn(`离线历史补拉失败 [${platform}]: ${err}`),
          )
      }, 800)
    })

    adapter.on('disconnected', (reason?: string) => {
      logger.info(`社交适配器已断开: ${platform}, reason=${reason}`)
      this.notifyFrontend('social_adapter_disconnected', { platform, reason })
    })

    adapter.on('error', (err: Error) => {
      logger.error(`社交适配器错误 [${platform}]: ${err.message}`)
    })

    logger.info(`社交适配器已注册: ${platform}`)
  }

  /** 注销适配器 */
  unregisterAdapter(platform: string): void {
    const adapter = this.adapters.get(platform)
    if (adapter) {
      adapter.removeAllListeners()
      this.adapters.delete(platform)
      logger.info(`社交适配器已注销: ${platform}`)
    }
  }

  /** 获取适配器 */
  getAdapter(platform: string): AbstractSocialAdapter | undefined {
    return this.adapters.get(platform)
  }

  async syncOfflineHistory(platform: string): Promise<void> {
    const existing = this.historySyncs.get(platform)
    if (existing) return existing
    const task = this.performOfflineHistorySync(platform).finally(() =>
      this.historySyncs.delete(platform),
    )
    this.historySyncs.set(platform, task)
    return task
  }

  private async performOfflineHistorySync(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    const accountIds = adapter.getConnectedAccountIds()
    if (accountIds.length === 0) return
    const channels = await this.deps.socialMessageRepo.getRecentChannelsForPlatform(platform, 100)
    if (channels.length === 0) return

    for (const accountId of accountIds) {
      const agentId = adapter.resolveAgentId(accountId)
      if (!agentId) {
        logger.warn(`无法确定平台账号 ${accountId} 对应的 Agent，跳过历史补拉`)
        continue
      }
      const accountChannels = channels.filter((channel) => channel.agentId === agentId)
      if (accountChannels.length === 0) continue
      const startedAt = Math.floor(Date.now() / 1000)
      const cursor = await this.deps.socialMessageRepo.getSyncCursor(agentId, platform, accountId)
      // 首次启用只建立游标，不导入账号既有历史；后续仅补断开窗口。
      if (!cursor) {
        await this.deps.socialMessageRepo.markSyncCompleted(agentId, platform, accountId, startedAt)
        continue
      }
      await this.deps.socialMessageRepo.markSyncStarted(agentId, platform, accountId, startedAt)
      try {
        for (const channel of accountChannels.filter((item) => item.agentId === agentId)) {
          let beforeMessageSeq: number | undefined
          const seenPageStarts = new Set<number>()
          while (this.running) {
            const history = await adapter.getMessageHistory(
              channel.channelId,
              channel.channelType as 'private' | 'group',
              100,
              beforeMessageSeq,
              accountId,
            )
            if (history.length === 0) break
            for (const message of history) {
              if (message.timestamp <= cursor.lastSuccessfulSyncAt || message.timestamp > startedAt)
                continue
              if (
                await this.deps.socialMessageRepo.isDeletedByTombstone({
                  agentId,
                  platform,
                  accountId,
                  channelType: message.channelType,
                  channelId: message.channelId,
                  timestamp: message.timestamp,
                })
              )
                continue
              await this.deps.socialMessageRepo.insert({
                msgId: message.msgId,
                platform,
                accountId,
                channelId: message.channelId,
                channelType: message.channelType,
                senderId: message.senderId,
                senderName: message.senderName,
                content: message.content,
                agentId,
                rawEventJson: JSON.stringify({
                  ...((message.rawEvent as object) ?? {}),
                  _historySync: true,
                }),
                timestamp: new Date(message.timestamp * 1000).toISOString(),
              })
            }

            const oldestTimestamp = Math.min(...history.map((message) => message.timestamp))
            if (oldestTimestamp <= cursor.lastSuccessfulSyncAt || history.length < 100) break
            const sequences = history
              .map((message) => message.messageSeq)
              .filter(
                (value): value is number => typeof value === 'number' && Number.isFinite(value),
              )
            if (sequences.length === 0) {
              throw new Error(
                `NapCat 未返回 message_seq，无法继续分页补拉 ${channel.channelType}:${channel.channelId}`,
              )
            }
            const oldestSequence = Math.min(...sequences)
            if (seenPageStarts.has(oldestSequence) || oldestSequence === beforeMessageSeq) {
              throw new Error(
                `NapCat 历史分页游标未前进: ${channel.channelType}:${channel.channelId}`,
              )
            }
            seenPageStarts.add(oldestSequence)
            // NapCat 会将 message_seq 对应消息包含在下一页，唯一索引负责消除页间重叠。
            beforeMessageSeq = oldestSequence
          }
          if (!this.running) throw new Error('社交应用停止，历史同步将在下次启动时继续')
        }
        // 所有频道成功后一次推进游标；中途断电不会丢消息，重启会依靠唯一索引安全重放。
        await this.deps.socialMessageRepo.markSyncCompleted(agentId, platform, accountId, startedAt)
      } catch (err) {
        await this.deps.socialMessageRepo.markSyncFailed(agentId, platform, accountId, String(err))
        throw err
      }
    }
  }

  // ── 启动 / 停止 ──

  async start(): Promise<void> {
    this.running = true

    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.connect()
        logger.info(`社交适配器启动: ${platform}`)
      } catch (err) {
        logger.error(`社交适配器 ${platform} 启动失败: ${err}`)
      }
    }

    // 冷启动: 从 DB 恢复最近活跃的会话
    await this.reviveSessionsFromDb()

    // 启动调度器
    this.scheduler.start()
  }

  async stop(): Promise<void> {
    this.running = false
    for (const { controller } of this.commandControllers.values())
      controller.abort(new Error('社交任务已取消：应用停止'))
    const ids = new Set([
      ...this.turnControllers.keys(),
      ...this.commandControllers.keys(),
      ...this.sessionManager
        .listSessions()
        .flatMap((session) =>
          [session.turnId, session.waitingTurnId].filter((id): id is string => Boolean(id)),
        ),
    ])
    await Promise.allSettled([...ids].map((id) => this.cancelTurn(id)))
    for (const { controller } of this.turnControllers.values())
      controller.abort(new Error('社交任务已取消：应用停止'))
    this.scheduler.stop()
    this.sessionManager.stop()

    for (const [platform, adapter] of this.adapters) {
      try {
        await adapter.disconnect()
      } catch (err) {
        logger.error(`社交适配器 ${platform} 停止失败: ${err}`)
      }
    }
  }

  // ── 核心消息处理 ──

  /**
   * 处理入站消息
   *
   * 流程: adapter → 路由归属 → 激活策略 → 持久化 → SessionManager 缓冲 → flush → generateReply
   */
  private async handleInbound(inbound: InboundMessage): Promise<void> {
    if (!this.running) return

    const { channelId, channelType, senderName, platform, content } = inbound
    logger.info(
      `[${platform}] 入站: channel=${channelId}(${channelType}), ` +
        `from=${senderName}, "${content.slice(0, 50)}..."`,
    )

    // 第七阶段 #7: 入站路由表查询，覆盖 agentId
    // 根据 (source, identifier) 查询 inbound_routes 表决定归属 Agent
    // 未命中时保持 inbound.agentId（由 adapter 设置的默认值）
    if (this.deps.inboundRouteRepo) {
      const routeSource = `${platform}_${channelType}`
      const resolved = await this.deps.inboundRouteRepo.resolve(routeSource, channelId)
      if (resolved) {
        inbound.agentId = resolved.agentId
        logger.info(`入站路由命中: ${routeSource}/${channelId} → agent=${resolved.agentId}`)
        // 外部平台私聊与群聊统一使用 social，具体会话形态由 channelType 区分。
        inbound.routeChannel = 'social'
        inbound.routeThreadId = resolved.threadId ?? undefined
      }
    }

    if (this.deps.shouldAcceptInbound && !this.deps.shouldAcceptInbound(inbound)) {
      logger.debug(
        `入站消息被社交激活策略忽略: agent=${inbound.agentId}, channel=${channelId}, sender=${inbound.senderId}`,
      )
      return
    }

    const raw = inbound.rawEvent as Record<string, unknown> | undefined
    const accountId = String(raw?.self_id ?? '')
    const msgId = String(raw?.message_id ?? randomUUID())
    if (
      raw?.message_id !== undefined &&
      (await this.deps.socialMessageRepo.getByMsgId(inbound.agentId, msgId, accountId))
    ) {
      await this.refillInbox(inbound.agentId)
      return
    }
    inbound.rawEvent = { ...raw, message_id: msgId }
    const observed = this.sessionManager.getOrCreate(inbound)
    const queueForReply =
      channelType === 'private' ||
      raw?._isMentioned === true ||
      inbound.isMentioned === true ||
      observed.participation === 'engaged'
    // 入站正文与待处理标识在同一事务提交，进程退出后仍能恢复明确请求。
    try {
      await this.deps.socialMessageRepo.insert({
        msgId,
        platform,
        accountId,
        queueForReply,
        channelId,
        channelType,
        senderId: inbound.senderId,
        senderName,
        content,
        agentId: inbound.agentId,
        rawEventJson: JSON.stringify({
          ...(inbound.rawEvent as Record<string, unknown>),
          _infosQueuedForReply: queueForReply,
          _infosInbound: {
            attachments: inbound.attachments,
            replyTo: inbound.replyTo,
            routeThreadId: inbound.routeThreadId,
            isMentioned: inbound.isMentioned,
          },
        }),
      })
    } catch (err) {
      logger.warn(`消息持久化失败 (非致命): ${err}`)
    }

    if (this.deps.onMessagePersisted) {
      void this.deps.onMessagePersisted(inbound.agentId).catch((err) => {
        logger.warn(`社交消息后置任务触发失败: ${err}`)
      })
    }

    // 2. 异步下载图片到本地缓存 (非阻塞)
    if (this.imageCache && inbound.attachments) {
      for (const att of inbound.attachments) {
        if (att.type === 'image' && att.url && !att.localPath) {
          // 异步下载，不阻塞消息处理
          this.imageCache
            .download(att.url)
            .then((localPath) => {
              if (localPath) att.localPath = localPath
            })
            .catch(() => {
              /* 下载失败不影响主流程 */
            })
        }
      }
    }

    // 3. 交给 SessionManager 缓冲处理
    await this.sessionManager.handleInbound(inbound)

    // 3. 通知前端
    this.notifyFrontend('social_message', {
      platform,
      channelId,
      channelType,
      direction: 'inbound',
      senderName,
      content: content.slice(0, 100),
    })
  }

  /**
   * 将附件转换为 data URL（base64）
   *
   * 优先用已下载的本地路径，否则等待下载完成。
   * 用于多模态 LLM 图片输入。
   */
  private async attachmentToDataUrl(att: Attachment): Promise<string | null> {
    if (!this.imageCache) return null
    try {
      // att.localPath 类型是 string | undefined，download 返回 string | null
      // 用 ?? null 统一为 string | null，避免类型不兼容
      let localPath: string | null = att.localPath ?? null
      if (!localPath && att.url) {
        localPath = await this.imageCache.download(att.url)
      }
      if (localPath) {
        return this.imageCache.readAsDataUrl(localPath)
      }
    } catch {
      // 单张图片失败不影响其他图片
    }
    return null
  }

  /** 只读取当前账号、当前会话的图片；按消息标识保留来源并限制每轮图片数量。 */
  private async collectImageContext(
    messages: InboundMessage[],
    trigger: InboundMessage,
    accountId?: string,
  ): Promise<{ images: string[]; sources: string[]; context: string }> {
    const signal = currentSocialRecovery()?.signal
    const candidates = [trigger]
    const context: string[] = []
    if (trigger.replyTo && accountId) {
      try {
        const row = await this.deps.socialMessageRepo.getByMsgId(
          trigger.agentId,
          trigger.replyTo,
          accountId,
        )
        const stored =
          row &&
          row.platform === trigger.platform &&
          row.accountId === accountId &&
          row.channelId === trigger.channelId &&
          row.channelType === trigger.channelType
            ? restoreSocialMessage(row)
            : null
        const reference =
          stored ??
          (await this.getAdapter(trigger.platform)?.getMessage?.(
            trigger.replyTo,
            trigger.channelId,
            trigger.channelType,
            accountId,
            signal,
          ))
        if (reference) {
          candidates.push(reference)
          const excerpt = { ...reference, content: reference.content.slice(0, 4000) }
          context.push(`引用原消息：${formatSocialMessage(excerpt, this.deps.getOwnerId?.())}`)
        } else {
          context.push(`引用消息 ${trigger.replyTo} 暂不可读取，不要推测其内容。`)
        }
      } catch (error) {
        signal?.throwIfAborted()
        logger.warn(`引用消息读取失败：${error instanceof Error ? error.message : String(error)}`)
        context.push(`引用消息 ${trigger.replyTo} 读取失败，不要推测其内容。`)
      }
    }
    const sameSender = [...messages]
      .reverse()
      .filter((message) => message !== trigger && message.senderId === trigger.senderId)
    candidates.push(...sameSender)

    // 支持先发图再单独提及，补图仅看同一发送者最近两分钟内的消息。
    if (
      accountId &&
      !candidates.some((message) => message.attachments?.some((item) => item.type === 'image'))
    ) {
      try {
        const rows = await this.deps.socialMessageRepo.getRecent(
          trigger.agentId,
          trigger.channelId,
          trigger.channelType,
          20,
        )
        const raw = trigger.rawEvent as Record<string, unknown> | undefined
        const triggerTime = Number(raw?.time) * 1000 || Date.now()
        const recent = [...rows].sort(
          (a, b) => Date.parse(b.timestamp ?? '') - Date.parse(a.timestamp ?? ''),
        )
        for (const row of recent) {
          const time = Date.parse(row.timestamp ?? '')
          if (
            row.accountId === accountId &&
            row.platform === trigger.platform &&
            row.senderId === trigger.senderId &&
            time <= triggerTime &&
            time >= triggerTime - 120_000
          ) {
            candidates.push(restoreSocialMessage(row))
          }
        }
      } catch (error) {
        signal?.throwIfAborted()
        logger.debug(`近期图片上下文读取失败：${String(error)}`)
      }
    }

    const seen = new Set<string>()
    const selected: Array<{ attachment: Attachment; source: string }> = []
    for (const message of candidates) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.type !== 'image') continue
        const key = attachment.url || attachment.localPath
        if (!key || seen.has(key)) continue
        seen.add(key)
        selected.push({
          attachment,
          source: `消息 ${socialMessageId(message) || '当前'}，发送者 ${JSON.stringify(message.senderName)}（QQ:${message.senderId}）`,
        })
        if (selected.length >= 3) break
      }
      if (selected.length >= 3) break
    }
    const loaded = await Promise.all(
      selected.map(async (item) => ({
        ...item,
        image: await this.attachmentToDataUrl(item.attachment),
      })),
    )
    signal?.throwIfAborted()
    const images: string[] = []
    const sources: string[] = []
    for (const item of loaded) {
      if (item.image) {
        images.push(item.image)
        sources.push(item.source)
      } else {
        context.push(`${item.source} 的图片未能读取，不要声称已经看过。`)
      }
    }
    if (images.length) logger.info(`[${trigger.channelId}] 已准备 ${images.length} 张社交图片`)
    return { images, sources, context: context.join('\n') }
  }

  /**
   * flush 回调 (SessionManager 缓冲到期时调用)
   */
  private async onFlush(
    session: SocialSession,
    messages: InboundMessage[],
    reason: FlushReason,
    signal: AbortSignal,
  ): Promise<SocialTurnOutcome> {
    return this.executeReply(session, messages, reason, signal)
  }

  /** 主 Agent 委派也进入相同的持久化、取消和发送检查点。 */
  async runCommand(
    id: string,
    agentId: string,
    channelId: string,
    content: string,
    senderId: string,
  ): Promise<SocialTurnOutcome> {
    if (!this.running) throw new Error('社交应用尚未运行')
    const adapter = this.adapters.get('qq')
    if (!adapter) throw new Error('QQ 适配器尚未连接')
    const accounts = adapter
      .getConnectedAccountIds()
      .filter((account) => adapter.resolveAgentId(account) === agentId)
    if (accounts.length !== 1) throw new Error('无法唯一确定发送账号，请检查社交账号连接')
    const message: InboundMessage = {
      platform: 'qq',
      agentId,
      channelId,
      channelType: 'group',
      senderId,
      senderName: '主 Agent',
      content,
      isOwner: true,
      rawEvent: { message_id: `command:${id}`, self_id: accounts[0], _infosSingleTask: true },
    }
    const session = {
      ...this.sessionManager.getOrCreate(message),
      turnId: `social:command:${createHash('sha256').update(id).digest('hex')}`,
      waitingTurnId: undefined,
      pendingMessages: [],
      inFlightMessages: [message],
    }
    const controller = new AbortController()
    this.commandControllers.set(session.turnId, { controller, session })
    try {
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          return await this.executeReply(session, [message], 'proactive_review', controller.signal)
        } catch (error) {
          controller.signal.throwIfAborted()
          if (
            (await this.deps.socialMessageRepo.getTurn(session.turnId))?.status !== 'retrying' ||
            attempt === 2
          )
            throw error
          await socialDelay(30_000 * 2 ** attempt, controller.signal)
        }
      }
      throw new Error('社交委派已结束重试')
    } finally {
      this.commandControllers.delete(session.turnId)
    }
  }

  /**
   * 执行 AI 回复
   *
   * 将缓冲消息合并后调用 generateReply 回调，
   * 由 SocialAppRuntime 使用应用自己的 Compiler + LLM 生成回复。
   */
  private async executeReply(
    session: SocialSession,
    messages: InboundMessage[],
    reason: FlushReason,
    cancellation: AbortSignal,
  ): Promise<SocialTurnOutcome> {
    if (messages.length === 0) return { type: 'pass' }
    if (!(await this.deps.socialMessageRepo.memoryAvailable(session.agentId)))
      throw new Error('社交数据正在清理，请先完成数据清理再继续')
    const accountId = String(
      (messages[0]?.rawEvent as Record<string, unknown> | undefined)?.self_id ?? '',
    )
    const identity = messages
      .map((message) =>
        String((message.rawEvent as Record<string, unknown> | undefined)?.message_id ?? ''),
      )
      .filter(Boolean)
    const id = session.turnId ?? `social:${randomUUID()}`
    session.turnId = id
    const stored = await this.deps.socialMessageRepo.getTurn(id)
    if (
      stored &&
      ['completed', 'failed', 'cancelled', 'delivery_unknown'].includes(stored.status)
    ) {
      if (stored.status !== 'completed')
        throw new Error(stored.error || '该任务已经结束，未重复执行')
      return stored.outcome === 'reply'
        ? { type: 'reply', content: '', delivered: true }
        : { type: 'pass' }
    }
    const now = new Date().toISOString()
    const record: SocialTurnRecord = stored ?? {
      id,
      agentId: session.agentId,
      accountId,
      channelType: session.channelType,
      channelId: session.channelId,
      status: 'running' as const,
      startedAt: now,
      deadline: new Date(
        Date.now() +
          (this.scheduler.getConfig().taskTimeoutMinutes * 60_000 || SOCIAL_TURN_DURATION_MS),
      ).toISOString(),
      attempts: 0,
      updatedAt: now,
      sourceMessageIds: identity,
      checkpoint: { inbound: messages, policy: this.scheduler.getConfig() } as Record<
        string,
        unknown
      >,
    }
    if (!stored && session.waitingTurnId) {
      const previous = await this.deps.socialMessageRepo.getTurn(session.waitingTurnId)
      if (previous) record.deadline = previous.deadline
    }
    const remaining = Date.parse(record.deadline) - Date.now()
    if (remaining <= 0) {
      await finishSocialTurn(this.deps.socialMessageRepo, record, 'failed', '社交任务已超时')
      throw new Error('社交任务已超时')
    }
    record.attempts++
    record.status = 'running'
    record.error = undefined
    const controller = new AbortController()
    this.turnControllers.set(id, { controller, session })
    const lifetime = AbortSignal.any([
      cancellation,
      controller.signal,
      AbortSignal.timeout(remaining),
    ])
    const run = async (kernelSignal?: AbortSignal) => {
      const dataController = new AbortController()
      const version = await this.deps.socialMessageRepo.getDataVersion(
        record.agentId,
        record.channelType,
        record.channelId,
      )
      const signal = AbortSignal.any([
        lifetime,
        dataController.signal,
        ...(kernelSignal ? [kernelSignal] : []),
      ])
      const dataTimer = setInterval(() => {
        void this.deps.socialMessageRepo
          .getDataVersion(record.agentId, record.channelType, record.channelId)
          .then((current) => {
            if (current !== version) dataController.abort(new Error('社交任务已取消：数据已经清理'))
          })
          .catch(() => {
            dataController.abort(new Error('社交任务已取消：无法核验数据版本'))
          })
      }, 2000)
      dataTimer.unref?.()
      const recovery = {
        record,
        signal,
        save: async () => {
          signal.throwIfAborted()
          record.updatedAt = new Date().toISOString()
          await this.deps.socialMessageRepo.saveTurn(record)
          this.notifyFrontend('social_turn_progress', {
            id,
            channelId: record.channelId,
            status: record.status,
            error: record.error,
            attempts: record.attempts,
          })
        },
      }
      try {
        return await runSocialRecovery(recovery, async () => {
          try {
            await recovery.save()
            if (session.waitingTurnId) {
              const previous = await this.deps.socialMessageRepo.getTurn(session.waitingTurnId)
              if (previous?.status === 'waiting') {
                if (Date.parse(previous.deadline) <= Date.now()) {
                  await finishSocialTurn(
                    this.deps.socialMessageRepo,
                    previous,
                    'failed',
                    '等待任务已超过期限',
                  )
                  throw new Error('社交任务已超时')
                }
                await finishSocialTurn(this.deps.socialMessageRepo, previous, 'completed')
              }
              session.waitingTurnId = undefined
            }
            let outcome = await this.executeReplyWork(session, messages, reason)
            signal.throwIfAborted()
            if (
              (messages[0]?.rawEvent as Record<string, unknown> | undefined)?._infosSingleTask &&
              outcome.type !== 'reply'
            )
              outcome = { type: 'pass' }
            if (
              outcome.type === 'wait' &&
              (session.waitCount >= 2 || Date.now() - session.collectionStartedAt >= 20_000)
            )
              outcome = { type: 'pass' }
            if (outcome.type === 'defer')
              outcome.schedule ??= this.sessionManager.deferredSchedule(outcome.intent)
            record.outcome = outcome.type
            record.checkpoint.outcome = outcome
            const waiting = outcome.type === 'wait' || outcome.type === 'defer'
            await finishSocialTurn(
              this.deps.socialMessageRepo,
              record,
              waiting ? 'waiting' : 'completed',
            )
            if (waiting) session.waitingTurnId = id
            else
              await this.deps.socialMessageRepo.completeQueuedMessages(
                record.agentId,
                record.accountId,
                record.sourceMessageIds ?? [],
              )
            return outcome
          } catch (error) {
            const failure = socialFailure(error)
            const generation = record.checkpoint.generation as
              | { toolStarted?: boolean; retries?: number }
              | undefined
            const deliveries = record.checkpoint.deliveries as Record<string, string> | undefined
            const unknown =
              generation?.toolStarted || Object.values(deliveries ?? {}).includes('sending')
            const retryLimit =
              (record.checkpoint.policy as SocialSchedulerConfig | undefined)?.maxRetries ?? 2
            const retry =
              !signal.aborted &&
              !unknown &&
              failure.retryable &&
              record.attempts + (generation?.retries ?? 0) <= retryLimit
            if (retry) {
              record.status = 'retrying'
              record.error = failure.message
              await recovery.save()
            } else {
              await finishSocialTurn(
                this.deps.socialMessageRepo,
                record,
                unknown ? 'delivery_unknown' : signal.aborted ? 'cancelled' : 'failed',
                failure.message,
              )
              await this.deps.socialMessageRepo.completeQueuedMessages(
                record.agentId,
                record.accountId,
                record.sourceMessageIds ?? [],
              )
            }
            if (!retry && failure.retryable)
              throw new Error(`${failure.message}；自动恢复已结束，未重复执行操作`)
            throw error
          }
        })
      } finally {
        clearInterval(dataTimer)
        if (!signal.aborted)
          await this.refillInbox(record.agentId).catch((error) =>
            logger.warn(`社交待处理消息补入失败: ${String(error)}`),
          )
      }
    }
    try {
      lifetime.throwIfAborted()
      await this.deps.socialMessageRepo.saveTurn(record)
      if (!this.deps.executions) return await run()
      return await this.deps.executions.run({
        taskId: id,
        class: 'background',
        priority: session.channelType === 'private' ? 6 : 4,
        resourceKey: `social-session:${session.agentId}:${session.channelType}:${session.channelId}`,
        maxDurationMs: remaining,
        signal: lifetime,
        run: ({ signal }) => run(signal),
      })
    } catch (error) {
      if (record.status === 'running') {
        await finishSocialTurn(
          this.deps.socialMessageRepo,
          record,
          lifetime.aborted ? 'cancelled' : 'failed',
          socialFailure(error).message,
        ).catch(() => {})
        await this.deps.socialMessageRepo.completeQueuedMessages(
          record.agentId,
          record.accountId,
          record.sourceMessageIds ?? [],
        )
      }
      throw error
    } finally {
      if (this.turnControllers.get(id)?.controller === controller) this.turnControllers.delete(id)
    }
  }

  private async executeReplyWork(
    session: SocialSession,
    messages: InboundMessage[],
    reason: FlushReason,
  ): Promise<SocialTurnOutcome> {
    assertSocialActive()
    if (messages.length === 0) return { type: 'pass' }

    const { channelId, channelType, agentId } = session
    // 外部平台会话始终使用 social；routeThreadId 仅决定上下文复用。
    const firstMsg = messages[0]!
    const routeChannel = 'social'
    const routeThreadId = firstMsg.routeThreadId
    const directMessage = [...messages].reverse().find(isSocialMention)
    const triggerMessage = socialTriggerMessage(messages)!
    const replyTo =
      channelType === 'group' && directMessage
        ? String(
            (directMessage.rawEvent as Record<string, unknown> | undefined)?.message_id ?? '',
          ) || undefined
        : undefined

    // 构建合并的用户消息
    // 每条消息带上 message_id，供 AI 调用 social_read_image 工具时引用
    const ownerId = this.deps.getOwnerId?.()
    const combined = messages.map((message) => formatSocialMessage(message, ownerId)).join('\n')

    // 提取触发者 senderId（用于跨会话上下文注入）
    // 群聊场景：取最后一条提及 Bot 的消息发送者
    // 私聊场景：取唯一发送者（虽然私聊不需要跨会话补充，但统一传递由 generateReply 判断）
    const triggerSenderId = triggerMessage.senderId
    const isOwner = Boolean(ownerId && triggerSenderId === ownerId)

    // 提取本次 flush 消息的 msgId 列表（用于从 DB 历史中排除，避免重复）
    // handleInbound 已将这些消息持久化到 DB，如果不排除，combinedMessage 会在 messages 中出现两次
    const flushMsgIds = messages
      .map((m) => String((m.rawEvent as Record<string, unknown>)?.message_id ?? ''))
      .filter((id) => id.length > 0)

    // ── 获取 Bot 自身信息（QQ 号 + 昵称），注入到上下文让 Agent 知道自己是谁 ──
    const platform = messages[0]!.platform
    const adapter = this.getAdapter(platform)
    // 使用本批消息的 self_id，不能拿适配器默认账号管理另一账号的收藏。
    const sourceAccounts = [
      ...new Set(
        messages
          .map((message) =>
            String((message.rawEvent as Record<string, unknown> | undefined)?.self_id ?? ''),
          )
          .filter(Boolean),
      ),
    ]
    if (sourceAccounts.length > 1) throw new Error('社交消息批次混入多个账号，已阻止跨账号发送')
    let botSelfId: string | undefined = sourceAccounts[0]
    let botNickname: string | undefined
    if (adapter) {
      try {
        const status = await adapter.getStatus()
        const acct = status.accountInfo as Record<string, unknown> | undefined
        if (acct) {
          if (!botSelfId && adapter.getConnectedAccountIds().length === 1)
            botSelfId = acct.user_id != null ? String(acct.user_id) : undefined
          if (String(acct.user_id ?? '') === botSelfId)
            botNickname = acct.nickname != null ? String(acct.nickname) : undefined
        }
      } catch {
        // 获取 Bot 信息失败不影响主流程
      }
    }

    const imageContext = await this.collectImageContext(messages, triggerMessage, botSelfId)

    try {
      const recovery = currentSocialRecovery()
      const outcome =
        (recovery?.record.checkpoint.outcome as SocialTurnOutcome | undefined) ??
        (await this.deps.generateReply({
          signal: recovery?.signal,
          taskOrigin:
            channelType === 'private' &&
            messages.at(-1)?.senderId === this.deps.getOwnerId?.() &&
            String(
              (messages.at(-1)?.rawEvent as Record<string, unknown> | undefined)?.message_id ?? '',
            )
              ? {
                  platform,
                  accountId: String(
                    (messages.at(-1)?.rawEvent as Record<string, unknown> | undefined)?.self_id ??
                      botSelfId ??
                      '',
                  ),
                  channelType: 'private',
                  channelId,
                  senderId: messages.at(-1)!.senderId,
                  messageId: String(
                    (messages.at(-1)?.rawEvent as Record<string, unknown>).message_id,
                  ),
                }
              : undefined,
          agentId,
          channelType,
          channelId,
          combinedMessage: [combined, imageContext.context].filter(Boolean).join('\n'),
          trigger: reason,
          participation: session.participation,
          deferredIntent: reason === 'intent_due' ? session.deferredIntent : undefined,
          routeChannel,
          routeThreadId,
          isOwner,
          triggerSenderId,
          triggerSenderName: triggerMessage.senderName,
          flushMsgIds: flushMsgIds.length > 0 ? flushMsgIds : undefined,
          images: imageContext.images,
          imageSources: imageContext.sources,
          botSelfId,
          botNickname,
        }))

      assertSocialActive()
      if (recovery) {
        recovery.record.checkpoint.outcome = outcome
        await recovery.save()
      }
      if (outcome.type !== 'reply') return outcome
      // 状态卡片等工具已经投递，仍按已回复推进会话，避免重复发送或记为放弃。
      if (outcome.delivered) return outcome
      if (this.deps.shouldAllowSession && !this.deps.shouldAllowSession(session)) {
        logger.info(`[${channelId}] 社交激活策略已变化，丢弃尚未发送的回复`)
        return { type: 'pass' }
      }
      const reply = outcome.content.trim()
      if (!reply) throw new Error('角色 Agent 返回了空回复')

      // 保留原始换行与标点，仅在表情包标记处保留必要的媒体顺序。
      const segments = splitStickerSegments(reply)
      const delivered: string[] = []

      for (let index = 0; index < segments.length; index++) {
        assertSocialActive()
        if (recovery) recovery.record.checkpoint.deliveryCursor = index
        const segment = segments[index]!
        if (segment.type === 'text') {
          await this.sendReply(platform, {
            accountId: botSelfId,
            channelId,
            channelType,
            content: segment.content,
            // 混合媒体回复仅在首条文字中引用，避免重复引用同一消息。
            replyTo: delivered.length === 0 ? replyTo : undefined,
          })
          delivered.push(segment.content)
        } else {
          let attachment: Attachment
          try {
            if (!this.stickerService || !botSelfId) throw new Error('当前账号没有收藏表情服务')
            attachment = await this.stickerService.resolve(botSelfId, segment.stickerId)
          } catch (error) {
            logger.warn(`表情未发送：${error instanceof Error ? error.message : String(error)}`)
            continue
          }
          await this.sendReply(platform, {
            accountId: botSelfId,
            channelId,
            channelType,
            content: '',
            attachments: [attachment],
          })
          delivered.push(`[sticker:${segment.stickerId}]`)
        }
      }

      if (!delivered.length) return { type: 'pass' }
      const deliveredReply = delivered.join('\n')

      try {
        await this.deps.socialMessageRepo.insert({
          msgId: `agent_${Date.now()}`,
          turnId: recovery?.record.id,
          platform,
          accountId: botSelfId,
          channelId,
          channelType,
          senderId: 'self',
          senderName: agentId,
          content: deliveredReply,
          agentId,
        })
      } catch (error) {
        logger.warn(`Agent 回复持久化失败 (非致命): ${error}`)
      }

      this.notifyFrontend('social_message', {
        platform,
        channelId,
        direction: 'outbound',
        content: deliveredReply.slice(0, 100),
      })
      return { type: 'reply', content: deliveredReply }
    } catch (error) {
      logger.error(`回复生成或发送失败: ${error}`)
      throw error
    }
  }

  /**
   * 发送回复到指定平台
   */
  async sendReply(platform: string, msg: OutboundMessage, signal?: AbortSignal): Promise<void> {
    assertSocialActive()
    const recovery = currentSocialRecovery()
    signal ??= recovery?.signal
    signal?.throwIfAborted()
    if (!msg.accountId && recovery?.record.accountId)
      msg = { ...msg, accountId: recovery.record.accountId }
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      throw new Error(`社交适配器 ${platform} 未连接，无法发送到 ${msg.channelId}`)
    }
    const generation = recovery?.record.checkpoint.generation as
      | { round: number; index: number; pending?: unknown }
      | undefined
    const stage = generation?.pending
      ? `tool:${generation.round}:${generation.index}`
      : `reply:${recovery?.record.checkpoint.deliveryCursor ?? 0}`
    const key = `${stage}:${createHash('sha256')
      .update(JSON.stringify([platform, msg]))
      .digest('hex')}`
    const deliveries = (recovery?.record.checkpoint.deliveries ?? {}) as Record<string, string>
    if (deliveries[key] === 'sent') return
    if (deliveries[key] === 'sending') throw new Error('社交消息发送结果无法确认，已停止自动重发')
    if (recovery) {
      deliveries[key] = 'sending'
      recovery.record.checkpoint.deliveries = deliveries
      await recovery.save()
    }
    try {
      await adapter.sendMessage(msg, signal)
    } catch (error) {
      if ((error as { code?: string }).code === 'DELIVERY_NOT_SENT' && recovery) {
        delete deliveries[key]
        await recovery.save()
      }
      throw error
    }
    assertSocialActive()
    signal?.throwIfAborted()
    if (recovery) {
      deliveries[key] = 'sent'
      await recovery.save()
    }
    logger.debug(`回复已发送: platform=${platform}, channel=${msg.channelId}`)
  }

  // ── 状态查询 ──

  /** 获取所有适配器状态 */
  async getAllStatus(): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = []
    for (const [platform, adapter] of this.adapters) {
      try {
        const status = await adapter.getStatus()
        results.push({ ...status })
      } catch {
        results.push({ platform, connected: false, error: '获取状态失败' })
      }
    }
    return results
  }

  // ── 前端通知 ──

  private notifyFrontend(action: string, data: Record<string, unknown>): void {
    this.deps.socialEvents.publish(action, data).catch(() => {
      /* 忽略广播错误 */
    })
  }

  // ── 冷启动会话复活 ──

  /**
   * 从 DB 恢复最近活跃的会话到 SessionManager
   *
   * 查询每个 Agent 最近活跃的频道，为每个频道创建一个 session。
   * 复活的会话 nextScanTime 延迟 5~15 分钟，防止启动爆发。
   */
  private async reviveSessionsFromDb(): Promise<void> {
    try {
      const recentChannels = await this.deps.socialMessageRepo.getRecentChannelsForPlatform(
        'qq',
        20,
      )

      // 为每个频道创建 session
      let revivedCount = 0
      for (const ch of recentChannels) {
        if (revivedCount >= 10) break

        // 创建虚拟入站消息来触发 session 创建
        this.sessionManager.getOrCreate({
          platform: 'qq',
          channelId: ch.channelId,
          channelType: ch.channelType as 'private' | 'group',
          senderId: '',
          senderName: '',
          content: '',
          agentId: ch.agentId,
        })

        // 让复活的会话延迟扫描 (5-15 分钟)
        const sessions = this.sessionManager.getActiveSessions(undefined, 50)
        const session = sessions.find(
          (item) =>
            item.agentId === ch.agentId &&
            item.channelType === ch.channelType &&
            item.channelId === ch.channelId,
        )
        if (session) {
          const delay = 300 + Math.floor(Math.random() * 600) // 5~15 分钟
          session.nextScanTime = Date.now() + delay * 1000
          revivedCount++
        }
      }

      if (revivedCount > 0) {
        logger.info(`冷启动: 从 DB 恢复了 ${revivedCount} 个会话`)
      } else {
        logger.info('冷启动: 无历史会话需要恢复')
      }
      const agentIds = new Set(
        [...recentChannels.map((channel) => channel.agentId), this.deps.getAgentId?.()].filter(
          (id): id is string => Boolean(id),
        ),
      )
      for (const agentId of agentIds) {
        for (const record of await this.deps.socialMessageRepo.listRecoverableTurns(agentId)) {
          if (Date.parse(record.deadline) <= Date.now()) {
            await finishSocialTurn(
              this.deps.socialMessageRepo,
              record,
              'failed',
              '进程恢复时任务已超过期限',
            )
            continue
          }
          const inbound = record.checkpoint.inbound as InboundMessage[] | undefined
          if (
            !inbound?.length ||
            (!this.deps.shouldAllowSession?.(record) && this.deps.shouldAllowSession)
          ) {
            await finishSocialTurn(this.deps.socialMessageRepo, record, 'cancelled', '原会话已关闭')
            continue
          }
          const session = this.sessionManager.getOrCreate(inbound[0]!)
          if (record.status === 'waiting') {
            const outcome = record.checkpoint.outcome as SocialTurnOutcome | undefined
            session.waitingTurnId = record.id
            if (
              outcome?.type === 'defer' &&
              outcome.schedule &&
              outcome.schedule.expiresAt > Date.now()
            ) {
              session.deferredIntent = {
                ...outcome.intent,
                ...outcome.schedule,
                sourceMessages: inbound,
              }
              session.nextScanTime = outcome.schedule.notBefore
            } else if (
              outcome?.type === 'wait' &&
              Date.now() - Date.parse(record.startedAt) < 20_000
            ) {
              session.pendingMessages.push(...inbound)
              session.waitCount = 1
              session.collectionStartedAt = Date.parse(record.startedAt)
              session.phase = 'ready'
              void this.sessionManager
                .review(session, 'direct_timeout')
                .catch((error) => logger.warn(`等待任务恢复失败: ${String(error)}`))
            } else {
              await finishSocialTurn(
                this.deps.socialMessageRepo,
                record,
                'cancelled',
                '等待窗口已结束',
              )
              await this.deps.socialMessageRepo.completeQueuedMessages(
                agentId,
                record.accountId,
                record.sourceMessageIds ?? [],
              )
            }
            continue
          }
          if (session.retryMessages?.length) {
            await finishSocialTurn(
              this.deps.socialMessageRepo,
              record,
              'cancelled',
              '已有更新的恢复批次，旧任务不再重放',
            )
            continue
          }
          session.turnId = record.id
          session.retryMessages = inbound
          session.retryCount = Math.max(0, record.attempts - 1)
          session.phase = 'retrying'
          session.nextScanTime = Date.now() + 30_000
        }
        await this.refillInbox(agentId)
      }
    } catch (err) {
      logger.warn(`冷启动会话恢复失败 (非致命): ${err}`)
    }
  }

  private async refillInbox(agentId: string): Promise<void> {
    if (!this.running) return
    if (!(await this.deps.socialMessageRepo.memoryAvailable(agentId))) return
    for (const row of await this.deps.socialMessageRepo.queuedMessages(agentId)) {
      const inbound = restoreSocialMessage(row)
      const ownerId = this.deps.getOwnerId?.()
      inbound.isOwner = Boolean(ownerId && row.senderId === ownerId)
      if (this.deps.shouldAcceptInbound && !this.deps.shouldAcceptInbound(inbound)) {
        await this.deps.socialMessageRepo.completeQueuedMessages(agentId, row.accountId, [
          row.msgId,
        ])
        continue
      }
      await this.sessionManager.handleInbound(inbound)
    }
  }

  listSessions() {
    return this.sessionManager
      .listSessions()
      .map(({ controller: _controller, flushTimer: _timer, ...session }) => session)
  }

  async listTurns(agentId: string) {
    await this.expireWaitingTurns(agentId)
    return (await this.deps.socialMessageRepo.listRecoverableTurns(agentId, true)).map(
      ({ checkpoint: _checkpoint, ...record }) => record,
    )
  }
  private async expireWaitingTurns(agentId: string): Promise<void> {
    const records = await this.deps.socialMessageRepo.listRecoverableTurns(agentId)
    for (const record of records) {
      const outcome = record.checkpoint.outcome as SocialTurnOutcome | undefined
      const timedOut = Date.parse(record.deadline) <= Date.now()
      const expired =
        outcome?.type === 'defer' && outcome.schedule && outcome.schedule.expiresAt <= Date.now()
      if (record.status !== 'waiting' || (!timedOut && !expired)) continue
      this.sessionManager.cancel(
        record.agentId,
        record.channelType,
        record.channelId,
        record.accountId,
        record.sourceMessageIds,
      )
      await finishSocialTurn(
        this.deps.socialMessageRepo,
        record,
        timedOut ? 'failed' : 'cancelled',
        timedOut ? '等待任务已超过期限' : '延后意图已过期',
      )
      await this.deps.socialMessageRepo.completeQueuedMessages(
        record.agentId,
        record.accountId,
        record.sourceMessageIds ?? [],
      )
    }
  }
  async cancelTurn(id: string): Promise<void> {
    this.turnControllers.get(id)?.controller.abort(new Error('社交任务已取消'))
    this.commandControllers.get(id)?.controller.abort(new Error('社交任务已取消'))
    const record = await this.deps.socialMessageRepo.getTurn(id)
    if (!record || !['running', 'retrying', 'waiting'].includes(record.status)) return
    this.sessionManager.cancel(
      record.agentId,
      record.channelType,
      record.channelId,
      record.accountId,
      record.sourceMessageIds,
    )
    await finishSocialTurn(
      this.deps.socialMessageRepo,
      record,
      'cancelled',
      '用户取消了本次社交任务',
    )
    await this.deps.socialMessageRepo.completeQueuedMessages(
      record.agentId,
      record.accountId,
      record.sourceMessageIds ?? [],
    )
  }
  async acknowledgeTurn(id: string): Promise<void> {
    const record = await this.deps.socialMessageRepo.getTurn(id)
    if (!record || ['running', 'retrying', 'waiting'].includes(record.status)) return
    record.acknowledgedAt = new Date().toISOString()
    await this.deps.socialMessageRepo.saveTurn(record)
  }

  closeSession(agentId: string, channelId: string): boolean {
    for (const session of this.sessionManager.listSessions())
      if (session.agentId === agentId && session.channelId === channelId)
        this.cancelSessionRecords(session)
    for (const entry of this.turnControllers.values())
      if (entry.session.agentId === agentId && entry.session.channelId === channelId)
        entry.controller.abort(new Error('社交任务已取消：会话关闭'))
    for (const entry of this.commandControllers.values())
      if (entry.session.agentId === agentId && entry.session.channelId === channelId)
        entry.controller.abort(new Error('社交任务已取消：会话关闭'))
    return this.sessionManager.closeSession(agentId, channelId)
  }

  closeSessionsExcept(predicate: (session: SocialSession) => boolean): number {
    for (const session of this.sessionManager.listSessions())
      if (!predicate(session)) this.cancelSessionRecords(session)
    for (const entry of this.turnControllers.values())
      if (!predicate(entry.session))
        entry.controller.abort(new Error('社交任务已取消：会话策略已变化'))
    for (const entry of this.commandControllers.values())
      if (!predicate(entry.session))
        entry.controller.abort(new Error('社交任务已取消：会话策略已变化'))
    return this.sessionManager.closeSessionsExcept(predicate)
  }
  private cancelSessionRecords(session: SocialSession): void {
    for (const id of [session.turnId, session.waitingTurnId])
      if (id)
        void this.cancelTurn(id).catch((error) =>
          logger.warn(`社交任务取消记录失败: ${String(error)}`),
        )
  }

  // ── 社交工具Provider桥接 ──

  /** 检查是否有已注册的活跃适配器 */
  hasActiveAdapter(): boolean {
    return this.adapters.size > 0
  }

  /**
   * 创建 SocialMessagingProvider — 桥接适配器到工具层
   *
   * 将 AbstractSocialAdapter 的方法包装为 SocialMessagingProvider 接口，
   * 供 SocialAppRuntime 注入到社交工具 (socialOps) 使用。
   *
   * 使用第一个已注册的适配器作为默认平台。
   * 未来可扩展为按 platform 参数路由到不同适配器。
   */
  createMessagingProvider(): import('../tools').SocialMessagingProvider | null {
    if (this.adapters.size === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 对象字面量方法需通过闭包引用外层 this
    const bridge = this
    // 取第一个适配器作为默认
    const [defaultPlatform, defaultAdapter] = this.adapters.entries().next().value!

    return {
      get platform() {
        return defaultPlatform
      },

      async sendMessage(agentId, target, content, type) {
        await bridge.sendReply(defaultPlatform, {
          channelId: target,
          channelType: type,
          content,
        })
        await bridge.deps.socialMessageRepo.insert({
          msgId: `agent_tool_${Date.now()}`,
          turnId: currentSocialRecovery()?.record.id,
          platform: defaultPlatform,
          channelId: target,
          channelType: type,
          senderId: 'self',
          senderName: agentId,
          content,
          agentId,
        })
      },

      async getContacts() {
        return defaultAdapter.getContacts()
      },
      async getGroups() {
        return defaultAdapter.getGroups()
      },
      async getContactInfo(userId) {
        return defaultAdapter.getContactInfo(userId)
      },
      async getGroupInfo(groupId) {
        return defaultAdapter.getGroupInfo(groupId)
      },
      async getGroupMembers(groupId) {
        return defaultAdapter.getGroupMembers(groupId)
      },
      async handleFriendRequest(flag, approve, remark) {
        return defaultAdapter.handleFriendRequest(flag, approve, remark)
      },
      async removeFriend(userId) {
        return defaultAdapter.removeFriend(userId)
      },
      async getForwardMsg(forwardId) {
        return defaultAdapter.getForwardMsg(forwardId)
      },

      async notifyOwner(content, importance) {
        const owner = bridge.deps.getOwnerId?.()
        if (!owner) throw new Error('尚未绑定主人账号，无法发送通知')
        const status = await defaultAdapter.getStatus()
        const accountId = String(status.accountInfo?.user_id ?? '')
        if (!status.connected || !accountId) throw new Error('社交账号未连接，无法发送通知')
        await bridge.sendReply(defaultPlatform, {
          accountId,
          channelId: owner,
          channelType: 'private',
          content,
        })
        bridge.notifyFrontend('social_owner_notification', {
          content,
          importance: importance ?? 'medium',
          platform: defaultPlatform,
        })
      },
    }
  }
}
