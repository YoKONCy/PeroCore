/**
 * Session Service — 会话生命周期管理
 *
 * 管理会话的创建、切换、恢复。
 * 支持工作模式隔离 (独立 session_id 避免历史污染)。
 * 支持 Profile 切换。
 *
 * @module packages/backend/src/services/session/sessionService
 */

import type { ConfigRepository } from '../../repositories/config.repo'
import type { ConversationLogService } from '../memory/conversationLog'
import { createLogger } from '../../lib/logger'

const logger = createLogger('SessionService')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 支持的 Profile */
export type DesktopProfile = 'default' | 'lightweight' | 'companion' | 'work'

/** 陪伴调度器句柄 (轻接口，避免直接依赖 CompanionScheduler) */
export interface CompanionSchedulerHandle {
  start(): void
  stop(): Promise<void>
  notifyActivity(): void
  readonly isRunning: boolean
}

/** 陪伴调度器工厂函数 (由 container 注入) */
export type CompanionSchedulerFactory = (agentId: string) => CompanionSchedulerHandle

/** 会话信息 */
export interface SessionInfo {
  sessionId: string
  agentId: string
  mode: 'default' | 'work'
  profile: DesktopProfile
  taskName?: string
  createdAt: number
  /** 会话内消息计数 */
  messageCount: number
}

/** 会话列表条目 (前端展示用) */
export interface SessionListItem {
  sessionId: string
  agentId: string
  profile: DesktopProfile
  lastActivity: number
  messageCount: number
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class SessionService {
  /** 当前活跃会话 */
  private activeSessions = new Map<string, SessionInfo>()

  constructor(
    private configRepo: ConfigRepository,
    private logService: ConversationLogService,
  ) {}

  /**
   * 获取或创建默认会话
   */
  async getOrCreateDefault(agentId: string): Promise<SessionInfo> {
    // 检查内存中是否已有
    const existing = this.activeSessions.get(agentId)
    if (existing) return existing

    // 从 ConfigRepo 恢复
    const key = `session.${agentId}.current`
    const stored = await this.configRepo.get(key)
    const sessionId = stored ?? 'default'
    const profileKey = `session.${agentId}.profile`
    const profile = ((await this.configRepo.get(profileKey)) ?? 'default') as DesktopProfile

    const info: SessionInfo = {
      sessionId,
      agentId,
      mode: sessionId.startsWith('work_') ? 'work' : 'default',
      profile,
      createdAt: Date.now(),
      messageCount: 0,
    }
    this.activeSessions.set(agentId, info)
    return info
  }

  /**
   * 切换 Profile
   *
   * Profile 影响 Enricher 门控:
   * - default: 全部启用
   * - lightweight: 跳过 MemoryEnricher、ToolEnricher
   * - companion: 全部启用 + 定时主动行为 (自动启动 CompanionScheduler)
   * - work: 全部启用 + 工作工具链 (通过 enterWorkMode 触发)
   */
  async switchProfile(agentId: string, profile: DesktopProfile): Promise<SessionInfo> {
    if (profile === 'work') {
      throw new Error('请使用 enterWorkMode() 进入工作模式')
    }

    const current = this.activeSessions.get(agentId) ?? (await this.getOrCreateDefault(agentId))
    const previousProfile = current.profile

    await this.configRepo.set(`session.${agentId}.profile`, profile)

    const updated: SessionInfo = { ...current, profile }
    this.activeSessions.set(agentId, updated)

    // ── 陪伴模式联动 ──
    // 切入 companion → 启动调度
    if (profile === 'companion' && previousProfile !== 'companion') {
      await this.startCompanionScheduler(agentId)
    }
    // 切出 companion → 停止调度
    if (profile !== 'companion' && previousProfile === 'companion') {
      await this.stopCompanionScheduler(agentId)
    }

    logger.info(`Profile 已切换: agent=${agentId}, ${previousProfile} → ${profile}`)
    return updated
  }

  // ── 陪伴调度器管理 ──

  /** 注入的调度器工厂 (由 container 设置) */
  private companionSchedulerFactory: CompanionSchedulerFactory | null = null

  /** 运行中的调度器实例 */
  private activeCompanionSchedulers = new Map<string, CompanionSchedulerHandle>()

  /**
   * 设置陪伴调度器工厂 (DI 注入)
   *
   * container.ts 初始化后调用此方法注入工厂函数。
   */
  setCompanionSchedulerFactory(factory: CompanionSchedulerFactory): void {
    this.companionSchedulerFactory = factory
  }

  /**
   * 通知陪伴调度器：用户有活动 (重置空闲计时器)
   */
  notifyCompanionActivity(agentId: string): void {
    const handle = this.activeCompanionSchedulers.get(agentId)
    if (handle) {
      handle.notifyActivity()
    }
  }

  /** 启动陪伴调度 */
  private async startCompanionScheduler(agentId: string): Promise<void> {
    // 已在运行则跳过
    if (this.activeCompanionSchedulers.has(agentId)) return

    if (!this.companionSchedulerFactory) {
      logger.warn('陪伴调度器工厂未注入，无法启动')
      return
    }

    const handle = this.companionSchedulerFactory(agentId)
    handle.start()
    this.activeCompanionSchedulers.set(agentId, handle)
    logger.info(`陪伴调度已启动: agent=${agentId}`)
  }

  /** 停止陪伴调度 */
  private async stopCompanionScheduler(agentId: string): Promise<void> {
    const handle = this.activeCompanionSchedulers.get(agentId)
    if (!handle) return

    await handle.stop()
    this.activeCompanionSchedulers.delete(agentId)
    logger.info(`陪伴调度已停止: agent=${agentId}`)
  }

  /**
   * 获取当前 Profile
   */
  async getCurrentProfile(agentId: string): Promise<DesktopProfile> {
    const session = this.activeSessions.get(agentId)
    if (session) return session.profile

    const stored = await this.configRepo.get(`session.${agentId}.profile`)
    return (stored as DesktopProfile) ?? 'default'
  }

  /**
   * 进入工作模式 — 创建隔离会话
   */
  async enterWorkMode(agentId: string, taskName = '未知任务'): Promise<SessionInfo> {
    const current = this.activeSessions.get(agentId)
    if (current?.mode === 'work') {
      throw new Error('已在工作模式中，请先退出')
    }

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
    const sessionId = `work_${agentId}_${timestamp}`

    // 持久化
    await this.configRepo.set(`session.${agentId}.current`, sessionId)
    await this.configRepo.set(`session.${agentId}.work_task`, taskName)
    await this.configRepo.set(`session.${agentId}.profile`, 'work')

    // 保存切换前的 profile (退出时恢复)
    const prevProfile = current?.profile ?? 'default'
    await this.configRepo.set(`session.${agentId}.prev_profile`, prevProfile)

    const info: SessionInfo = {
      sessionId,
      agentId,
      mode: 'work',
      profile: 'work',
      taskName,
      createdAt: Date.now(),
      messageCount: 0,
    }
    this.activeSessions.set(agentId, info)

    logger.info(`进入工作模式: session=${sessionId}, task=${taskName}`)
    return info
  }

  /**
   * 退出工作模式 — 恢复默认会话
   * @returns 工作模式期间的对话日志数
   */
  async exitWorkMode(agentId: string): Promise<{ logCount: number }> {
    const current = this.activeSessions.get(agentId)
    if (!current || current.mode !== 'work') {
      throw new Error('当前不在工作模式')
    }

    // 统计工作会话日志
    const logCount = await this.logService.count(agentId, current.sessionId)

    // 恢复之前的 profile
    const prevProfile = ((await this.configRepo.get(`session.${agentId}.prev_profile`)) ??
      'default') as DesktopProfile
    await this.configRepo.set(`session.${agentId}.current`, 'default')
    await this.configRepo.set(`session.${agentId}.profile`, prevProfile)
    await this.configRepo.delete(`session.${agentId}.work_task`)
    await this.configRepo.delete(`session.${agentId}.prev_profile`)

    const defaultInfo: SessionInfo = {
      sessionId: 'default',
      agentId,
      mode: 'default',
      profile: prevProfile,
      createdAt: Date.now(),
      messageCount: 0,
    }
    this.activeSessions.set(agentId, defaultInfo)

    logger.info(`退出工作模式: agent=${agentId}, logs=${logCount}, 恢复 profile=${prevProfile}`)
    return { logCount }
  }

  /** 获取当前会话信息 */
  getCurrentSession(agentId: string): SessionInfo | undefined {
    return this.activeSessions.get(agentId)
  }

  /** 增加消息计数 */
  incrementMessageCount(agentId: string): void {
    const session = this.activeSessions.get(agentId)
    if (session) {
      session.messageCount++
    }
  }

  /** 清除会话 (新建对话) */
  async clearSession(agentId: string): Promise<SessionInfo> {
    const current = this.activeSessions.get(agentId)
    if (current?.mode === 'work') {
      throw new Error('工作模式中不能清除会话，请先退出工作模式')
    }

    const profile = current?.profile ?? 'default'
    const info: SessionInfo = {
      sessionId: `chat_${Date.now()}`,
      agentId,
      mode: 'default',
      profile,
      createdAt: Date.now(),
      messageCount: 0,
    }

    await this.configRepo.set(`session.${agentId}.current`, info.sessionId)
    this.activeSessions.set(agentId, info)

    logger.info(`会话已清除: agent=${agentId}, new session=${info.sessionId}`)
    return info
  }
}
