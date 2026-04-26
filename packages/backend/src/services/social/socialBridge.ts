/**
 * SocialBridge — 主进程社交桥接 (Layer 0)
 *
 * 连接 ISocialAdapter ↔ SocialSessionManager ↔ SocialScheduler ↔ AgentService。
 *
 * 核心职责:
 * 1. 监听 adapter.on('message') → SessionManager 缓冲 → Scheduler 审视 → agentService.chat()
 * 2. 将 AI 回复 → adapter.sendMessage()
 * 3. 持久化社交消息到 socialMessages 表
 * 4. 通过 GatewayHub 推送社交状态到前端
 * 5. 管理适配器/调度器生命周期
 *
 * @module packages/backend/src/services/social/socialBridge
 */

import type { AbstractSocialAdapter } from '../../extensions/adapters/ISocialAdapter'
import type { AgentService } from '../agent/agentService'
import type { GatewayHub } from '../gateway/gatewayHub'
import type { LlmService, ModelConfig } from '../llm/llmService'
import type { MdpEngine } from '../prompt/mdpEngine'

import type { SocialMessageRepository } from '../../repositories/socialMessage.repo'
import type { InboundMessage, OutboundMessage } from './types'
import { SocialSessionManager, type SocialSession } from './socialSessionManager'
import { SocialScheduler } from './socialScheduler'
import type { ImageCacheManager } from './imageCacheManager'
import type { StickerService } from './stickerService'
import { createEnvelope } from '../gateway/types'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SocialBridge')

// ─────────────────────────────────────────────
// 依赖
// ─────────────────────────────────────────────

export interface SocialBridgeDeps {
  agentService: AgentService
  gatewayHub: GatewayHub
  llmService: LlmService
  /** 书记员模型获取器 (社交思考状态机使用) */
  getThinkingModel: () => Promise<ModelConfig | null>
  socialMessageRepo: SocialMessageRepository
  mdpEngine: MdpEngine
  /** 图片缓存管理器 (可选) */
  imageCacheManager?: ImageCacheManager
  /** 表情包服务 (可选) */
  stickerService?: StickerService
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
  /** 调度器 */
  private scheduler: SocialScheduler

  constructor(deps: SocialBridgeDeps) {
    this.deps = deps
    this.imageCache = deps.imageCacheManager ?? null
    this.stickerService = deps.stickerService ?? null

    // 初始化 SessionManager (flush 回调 → agentService.chat)
    this.sessionManager = new SocialSessionManager(async (session, messages, reason) => {
      await this.onFlush(session, messages, reason)
    })

    // 初始化 Scheduler (思考状态机决策 → agentService.chat)
    this.scheduler = new SocialScheduler({
      sessionManager: this.sessionManager,
      llmService: deps.llmService,
      mdpEngine: deps.mdpEngine,
      getThinkingModel: deps.getThinkingModel,
      onDecideReply: async (session, messages) => {
        await this.executeReply(session, messages)
      },
    })
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
   * 流程: adapter → 持久化 → SessionManager 缓冲 → (计时器/秘书) → flush → agentService.chat
   */
  private async handleInbound(inbound: InboundMessage): Promise<void> {
    if (!this.running) return

    const { channelId, channelType, senderName, platform, content } = inbound
    logger.info(
      `[${platform}] 入站: channel=${channelId}(${channelType}), ` +
        `from=${senderName}, "${content.slice(0, 50)}..."`,
    )

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
   * 将缓冲消息合并后调用 agentService.chat()，
   * 社交消息走完全相同的 Pipeline Phase 1-5。
   */
  private async executeReply(session: SocialSession, messages: InboundMessage[]): Promise<void> {
    if (messages.length === 0) return

    const { channelId, channelType, agentId } = session

    // 构建合并的用户消息
    const combined = messages.map((m) => `[${m.senderName}]: ${m.content}`).join('\n')

    try {
      const reply = await this.deps.agentService.chat({
        agentId,
        source: 'social',
        sessionId: `social_${messages[0]!.platform}_${channelId}`,
        messages: [{ role: 'user', content: combined }],
      })

      if (reply) {
        const platform = messages[0]!.platform

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
      }
    } catch (err) {
      logger.error(`AgentService 调用失败: ${err}`)
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
   * 供 container.ts 注入到社交工具 (socialOps) 使用。
   *
   * 使用第一个已注册的适配器作为默认平台。
   * 未来可扩展为按 platform 参数路由到不同适配器。
   */
  createMessagingProvider(): import('../../tools/socialOps').SocialMessagingProvider | null {
    if (this.adapters.size === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 对象字面量方法需通过闭包引用外层 this
    const bridge = this
    // 取第一个适配器作为默认
    const [defaultPlatform, defaultAdapter] = this.adapters.entries().next().value!

    return {
      get platform() {
        return defaultPlatform
      },

      async sendMessage(target, content, type) {
        await bridge.sendReply(defaultPlatform, {
          channelId: target,
          channelType: type,
          content,
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
