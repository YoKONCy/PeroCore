/**
 * SocialBridge — 社交桥接 (Layer 0)
 *
 * 连接 ISocialAdapter ↔ SocialSessionManager ↔ SocialScheduler ↔ 回复回调。
 *
 * 核心职责:
 * 1. 监听 adapter.on('message') → SessionManager 缓冲 → Scheduler 审视 → generateReply()
 * 2. 将 AI 回复 → adapter.sendMessage()
 * 3. 持久化社交消息到 socialMessages 表
 * 4. 通过 GatewayHub 推送社交状态到前端
 * 5. 管理适配器/调度器生命周期
 *
 * 方案 B：回复生成回调由 SocialAppRuntime 提供，
 * 使用应用自己的 Compiler + LLM，不再依赖主 Agent 的 AgentService.chat。
 *
 * @module packages/apps/social/runtime/socialBridge
 */

import type { AbstractSocialAdapter } from '../adapters/ISocialAdapter'
import type { GatewayHub } from '../../../backend/src/services/gateway/gatewayHub'
import type { LlmService, ModelConfig } from '../../../backend/src/services/llm/llmService'
import type { MdpEngine } from '../../../backend/src/services/prompt/mdpEngine'

import type { SocialMessageRepository } from './socialMessage.repo'
import type { Attachment, InboundMessage, OutboundMessage } from './types'
import type { InboundRouteRepository } from '../../../backend/src/repositories/inboundRoute.repo'
import { SocialSessionManager, type SocialSession } from './socialSessionManager'
import { SocialScheduler, type SocialSchedulerConfig } from './socialScheduler'
import type { ImageCacheManager } from './imageCacheManager'
import type { StickerService } from './stickerService'
import { createEnvelope } from '../../../backend/src/services/gateway/types'
import { createLogger } from '../../../backend/src/lib/logger'

const logger = createLogger('SocialBridge')

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface SocialBridgeDeps {
  gatewayHub: GatewayHub
  llmService: LlmService
  /** 社交决策模型获取器 (社交思考状态机使用) */
  getSocialSchedulerModel: () => Promise<ModelConfig | null>
  socialMessageRepo: SocialMessageRepository
  mdpEngine: MdpEngine
  /** 图片缓存管理器 (可选) */
  imageCacheManager?: ImageCacheManager
  /** 表情包服务 (可选) */
  stickerService?: StickerService
  /** 入站路由表 Repository (可选，第七阶段 #7：外部消息按来源+标识查询归属 Agent) */
  inboundRouteRepo?: InboundRouteRepository
  /** 获取社交决策使用的主 Agent 身份框架。 */
  getDecisionIdentity?: (agentId: string) => Promise<{
    agentName: string
    systemCore: string
    personaDefinition: string
    socialPatch: string
    /** 主人在主 app 登记的名称（owner.name），客观/中性指代用 */
    ownerName: string
    /** 角色对主人的亲密称呼（agent.json owner_appellation） */
    ownerAppellation: string
  }>
  /** 入站策略过滤；返回 false 时不持久化、不缓冲、不回复。 */
  shouldAcceptInbound?: (message: InboundMessage) => boolean
  /** 回复生成回调（方案 B：由 SocialAppRuntime 提供，使用应用自己的 Compiler + LLM） */
  generateReply: (params: {
    agentId: string
    channelType: 'private' | 'group'
    channelId: string
    combinedMessage: string
    routeChannel?: string
    routeThreadId?: string
    /**
     * 本次触发回复的消息中，是否包含主人发送的消息
     *
     * 由 executeReply 遍历入站消息的 isOwner 标记得出，
     * 只要有一条来自主人即为 true。用于 compiler 注入权限提示。
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
     * 由 executeReply 按优先级策略收集后传入：
     * 1. 最高：触发@消息的图片
     * 2. 中：触发者最近 20 条消息内的图片
     * 3. 最低：flush 缓冲区最近 5 条消息内的其他图片
     */
    images?: string[]
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
  }) => Promise<string | null>
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
    this.sessionManager = new SocialSessionManager(async (session, messages, reason) => {
      await this.onFlush(session, messages, reason)
    })

    // 初始化 Scheduler (思考状态机决策 → generateReply)
    this.scheduler = new SocialScheduler({
      sessionManager: this.sessionManager,
      llmService: deps.llmService,
      mdpEngine: deps.mdpEngine,
      getSocialSchedulerModel: deps.getSocialSchedulerModel,
      getDecisionIdentity: deps.getDecisionIdentity,
      onDecideReply: async (session, messages) => {
        await this.executeReply(session, messages)
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
    this.scheduler.stop()

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
   * 流程: adapter → 持久化 → SessionManager 缓冲 → (计时器/秘书) → flush → generateReply
   */
  private async handleInbound(inbound: InboundMessage): Promise<void> {
    if (!this.running) return
    if (this.deps.shouldAcceptInbound && !this.deps.shouldAcceptInbound(inbound)) {
      logger.debug(
        `入站消息被社交名单策略忽略: channel=${inbound.channelId}, sender=${inbound.senderId}`,
      )
      return
    }

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

    // 1. 持久化到 social_messages 表
    try {
      await this.deps.socialMessageRepo.insert({
        msgId: String((inbound.rawEvent as Record<string, unknown>)?.message_id ?? Date.now()),
        platform,
        channelId,
        channelType,
        senderId: inbound.senderId,
        senderName,
        content,
        agentId: inbound.agentId,
        rawEventJson: JSON.stringify(inbound.rawEvent ?? {}),
      })
    } catch (err) {
      logger.warn(`消息持久化失败 (非致命): ${err}`)
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

  /**
   * flush 回调 (SessionManager 缓冲到期时调用)
   */
  private async onFlush(
    session: SocialSession,
    messages: InboundMessage[],
    _reason: string,
  ): Promise<void> {
    await this.executeReply(session, messages)
  }

  /**
   * 执行 AI 回复
   *
   * 将缓冲消息合并后调用 generateReply 回调，
   * 由 SocialAppRuntime 使用应用自己的 Compiler + LLM 生成回复。
   */
  private async executeReply(session: SocialSession, messages: InboundMessage[]): Promise<void> {
    if (messages.length === 0) return

    const { channelId, channelType, agentId } = session
    // 外部平台会话始终使用 social；routeThreadId 仅决定上下文复用。
    const firstMsg = messages[0]!
    const routeChannel = 'social'
    const routeThreadId = firstMsg.routeThreadId

    // 构建合并的用户消息
    // 每条消息带上 message_id，供 AI 调用 social_read_image 工具时引用
    const combined = messages
      .map((m) => {
        const msgId = String((m.rawEvent as Record<string, unknown>)?.message_id ?? '')
        const idTag = msgId ? ` [msg:${msgId}]` : ''
        return `[${m.senderName}]${idTag}: ${m.content}`
      })
      .join('\n')

    // 权限识别：只要缓冲消息中有任一条来自主人，本次回复即视为"主人发起"
    // 用于 compiler 注入权限提示，让 Agent 区分对话对象是否为主人
    const isOwner = messages.some((m) => m.isOwner === true)

    // 提取触发者 senderId（用于跨会话上下文注入）
    // 群聊场景：取最后一条提及 Bot 的消息发送者
    // 私聊场景：取唯一发送者（虽然私聊不需要跨会话补充，但统一传递由 generateReply 判断）
    const triggerSenderId = extractTriggerSenderId(messages)

    // 提取本次 flush 消息的 msgId 列表（用于从 DB 历史中排除，避免重复）
    // handleInbound 已将这些消息持久化到 DB，如果不排除，combinedMessage 会在 messages 中出现两次
    const flushMsgIds = messages
      .map((m) => String((m.rawEvent as Record<string, unknown>)?.message_id ?? ''))
      .filter((id) => id.length > 0)

    // ── 收集图片附件，转换为 data URL 供多模态 LLM 使用 ──
    // 轻量化策略：只读取触发@消息本身带的图片（最多 1 张）
    // 其余图片由 AI 通过 social_read_image 工具按需读取
    const images: string[] = []
    if (this.imageCache) {
      const triggerMsg = triggerSenderId
        ? messages.find((m) => m.senderId === triggerSenderId && m.isMentioned)
        : undefined
      const triggerImageAtt = triggerMsg?.attachments?.find((a) => a.type === 'image')
      if (triggerImageAtt?.url) {
        const dataUrl = await this.attachmentToDataUrl(triggerImageAtt)
        if (dataUrl) {
          images.push(dataUrl)
        }
      }

      if (images.length > 0) {
        logger.info(`[${channelId}] 收集到 ${images.length} 张图片（@触发消息），将作为多模态输入`)
      }
    }

    // ── 获取 Bot 自身信息（QQ 号 + 昵称），注入到上下文让 Agent 知道自己是谁 ──
    const platform = messages[0]!.platform
    const adapter = this.getAdapter(platform)
    let botSelfId: string | undefined
    let botNickname: string | undefined
    if (adapter) {
      try {
        const status = await adapter.getStatus()
        const acct = status.accountInfo as Record<string, unknown> | undefined
        if (acct) {
          botSelfId = acct.user_id != null ? String(acct.user_id) : undefined
          botNickname = acct.nickname != null ? String(acct.nickname) : undefined
        }
      } catch {
        // 获取 Bot 信息失败不影响主流程
      }
    }

    try {
      const reply = await this.deps.generateReply({
        agentId,
        channelType,
        channelId,
        combinedMessage: combined,
        routeChannel,
        routeThreadId,
        isOwner,
        triggerSenderId,
        flushMsgIds: flushMsgIds.length > 0 ? flushMsgIds : undefined,
        images: images.length > 0 ? images : undefined,
        botSelfId,
        botNickname,
      })

      if (reply) {
        // PASS 检测：LLM 决定跳过回复时输出 [PASS]
        // 不发送、不持久化、不标记活跃 → 直接切换会话到非活跃期 (observing)
        // 这样下次被 @ 时能正常启动新的累积计时器，避免卡在 summoned 状态
        if (isPassReply(reply)) {
          logger.info(`[${channelId}] LLM 输出 PASS，跳过回复并切换会话到非活跃期`)
          this.sessionManager.markPass(session)
          return
        }

        // 分段发送: 文字和表情包分开发
        if (this.stickerService && this.stickerService.hasStickers(agentId)) {
          const segments = this.stickerService.splitIntoSegments(reply, agentId)

          for (const seg of segments) {
            if (seg.type === 'text') {
              await this.sendReply(platform, { channelId, channelType, content: seg.content })
            } else {
              // 表情包作为 sticker 附件独立发送 (适配器层决定具体格式)
              await this.sendReply(platform, {
                channelId,
                channelType,
                content: '',
                attachments: [
                  {
                    type: 'sticker',
                    localPath: seg.filePath,
                    name: seg.name,
                  },
                ],
              })
            }
            // 段间延迟 300ms，避免乱序
            await new Promise((r) => setTimeout(r, 300))
          }
        } else {
          // 无表情包，直接发送
          await this.sendReply(platform, { channelId, channelType, content: reply })
        }

        // 标记会话为活跃
        this.sessionManager.markReplied(session)

        // 持久化 Agent 回复 (保存原始完整文本)
        try {
          await this.deps.socialMessageRepo.insert({
            msgId: `agent_${Date.now()}`,
            platform,
            channelId,
            channelType,
            senderId: 'self',
            senderName: agentId,
            content: reply,
            agentId,
          })
        } catch (err) {
          logger.warn(`Agent 回复持久化失败 (非致命): ${err}`)
        }

        // 通知前端
        this.notifyFrontend('social_message', {
          platform,
          channelId,
          direction: 'outbound',
          content: reply.slice(0, 100),
        })
      } else {
        // generateReply 返回空（LLM 无回复 / 应用未就绪）时同样恢复会话到非活跃期，
        // 否则 session 会像异常路径一样卡死在 summoned，导致后续无法被唤醒
        this.sessionManager.markReplyFailed(
          session,
          new Error('generateReply 返回空回复（LLM 无回复或应用未就绪）'),
        )
      }
    } catch (err) {
      logger.error(`回复生成失败: ${err}`)
      // 关键修复：失败时必须恢复会话状态到非活跃期 (observing)。
      // 否则 session 会卡死在 summoned 状态，下次被 @ 时 handleInbound
      // 无法启动新的累积计时器（`if (session.state !== 'summoned')` 分支进不去），
      // 导致会话永久失聪、无法再被唤醒（如 LLM 网络错误 fetch failed）。
      this.sessionManager.markReplyFailed(session, err)
    }
  }

  /**
   * 发送回复到指定平台
   */
  async sendReply(platform: string, msg: OutboundMessage): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) {
      logger.warn(`无法发送回复: 适配器 ${platform} 未找到`)
      return
    }
    await adapter.sendMessage(msg)
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
    this.deps.gatewayHub.broadcast(createEnvelope('push', { action, ...data })).catch(() => {
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
      // 查最近 20 条活跃频道记录 (所有 Agent，内存去重取前 10)
      const recentChannels = await this.deps.socialMessageRepo.getRecentChannels('', 20)

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
          agentId: '',
        })

        // 让复活的会话延迟扫描 (5-15 分钟)
        const sessions = this.sessionManager.getActiveSessions(undefined, 50)
        const session = sessions.find((s) => s.channelId === ch.channelId)
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
    } catch (err) {
      logger.warn(`冷启动会话恢复失败 (非致命): ${err}`)
    }
  }

  // ── 社交工具 Provider 桥接 ──

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
        // 通知走 GatewayHub 推送到前端
        bridge.notifyFrontend('social_owner_notification', {
          content,
          importance: importance ?? 'medium',
          platform: defaultPlatform,
        })
      },
    }
  }
}

// ─────────────────────────────────────────────
// 辅助函数
// ─────────────────────────────────────────────

/**
 * 从缓冲消息中提取触发者 senderId
 *
 * 触发者定义：
 * - 群聊：最后一条提及 Bot 的消息发送者（通常是 @ Agent 的人）
 * - 私聊：唯一发送者
 * - 兜底：缓冲区最后一条消息的发送者
 *
 * 用于跨会话上下文注入：群聊中被 @ 时，拉取该用户的私聊历史作为补充上下文
 */
function extractTriggerSenderId(messages: InboundMessage[]): string | undefined {
  if (messages.length === 0) return undefined

  // 优先取最后一条 isMentioned 的消息
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    const raw = m.rawEvent as Record<string, unknown> | undefined
    if (raw?._isMentioned === true) {
      return m.senderId
    }
  }

  // 兜底：最后一条消息的发送者
  return messages[messages.length - 1]!.senderId
}

/**
 * 检测 LLM 回复是否为 PASS（决定跳过不回复）
 *
 * 容错匹配各种变体：
 * - [PASS] / [pass] / [Pass]
 * - PASS / pass / Pass
 * - "PASS" / 'PASS' / "pass" / 'pass'（带引号）
 * - [ PASS ] / [  pass  ]（带空格）
 * - 整条消息只有 PASS 相关字符（trim 后完全匹配）
 *
 * 不匹配的情况（视为正常回复）：
 * - "PASS 这个话题" / "[PASS] 但我想说..."（PASS 只是内容的一部分）
 * - "Password" / "compass"（PASS 是单词片段）
 *
 * @param reply LLM 的原始回复文本
 * @returns true 表示这是 PASS，应跳过发送
 */
function isPassReply(reply: string): boolean {
  const trimmed = reply.trim()
  if (!trimmed) return false

  // 去除首尾的方括号、引号、空格后，剩的是否为 pass（大小写不敏感）
  // 匹配: [PASS] / [pass] / "PASS" / 'pass' / PASS / pass
  const stripped = trimmed
    .replace(/^\[|\]$/g, '') // 去首尾方括号
    .replace(/^["'`]|["'`]$/g, '') // 去首尾引号
    .trim()

  return stripped.toLowerCase() === 'pass'
}
