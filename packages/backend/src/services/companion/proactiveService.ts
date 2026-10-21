import { t as __t } from '../../lib/i18n'
import type { ProactiveMode, ProactiveSettings, ProactiveState } from '@infos/shared'
import type { ConfigRepository } from '../../repositories/config.repo'
import { AppError } from '../../lib/appError'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ProactiveService')
const SETTINGS_KEY = 'proactive.settings'
const STATE_KEY = 'proactive.state'
type Target = {
  id: string
  agentId: string
  channel: string
  purpose?: string
  status?: string
  title?: string | null
}
interface ProactiveDeps {
  listAgents(): string[]
  resolveThread(agentId: string): Promise<Target>
  isBusy(agentId: string): boolean
  run(input: {
    mode: Exclude<ProactiveMode, 'off'>
    thread: Target
    content: string
    signal: AbortSignal
  }): Promise<string | null>
  changed(state: ProactiveState): Promise<void>
}
interface AgentSchedule {
  consecutiveMessages: number
  nextEligibleAt: number
}
interface PersistedState extends Partial<ProactiveState> {
  day?: string
  cursor?: string
  agents?: Record<string, AgentSchedule>
}
const DEFAULT_SETTINGS: ProactiveSettings = {
  mode: 'off',
  companionIntervalMinutes: 3,
  autonomousIntervalMinutes: 15,
  goal: '',
  maxDailyRuns: 48,
  timeZone: 'Asia/Shanghai',
}
const timeValue = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0

/** 全局策略覆盖所有启用角色；角色轮转和会话解析只属于内部调度。 */
export class ProactiveService {
  private settings = { ...DEFAULT_SETTINGS }
  private state: Omit<ProactiveState, 'settings'> = {
    agentId: null,
    phase: 'off',
    nextRunAt: null,
    lastRunAt: null,
    lastActivityAt: Date.now(),
    lastOutcome: '尚未启用',
    lastError: null,
    dailyRuns: 0,
    recent: [],
  }
  private agents = new Map<string, AgentSchedule>()
  private day = ''
  private cursor = ''
  private deps?: ProactiveDeps
  private timer?: ReturnType<typeof setTimeout>
  private controller?: AbortController
  private inFlight?: Promise<void>
  private writes: Promise<unknown> = Promise.resolve()
  private changes: Promise<unknown> = Promise.resolve()
  private stopped = false
  private schedulingHolds = 0

  constructor(private config: ConfigRepository) {}

  async initialize(deps: ProactiveDeps): Promise<void> {
    this.deps = deps
    try {
      const settings = await this.config.getJson<Partial<ProactiveSettings>>(SETTINGS_KEY)
      this.settings = this.validate({ ...DEFAULT_SETTINGS, ...settings })
      const saved = await this.config.getJson<PersistedState>(STATE_KEY)
      if (saved) {
        this.day = typeof saved.day === 'string' ? saved.day : ''
        this.cursor = typeof saved.cursor === 'string' ? saved.cursor : ''
        this.state.dailyRuns = Math.floor(timeValue(saved.dailyRuns))
        this.state.lastRunAt = timeValue(saved.lastRunAt) || null
        this.state.lastActivityAt = timeValue(saved.lastActivityAt) || Date.now()
        this.state.recent = Array.isArray(saved.recent)
          ? saved.recent
              .filter(
                (item) =>
                  item &&
                  timeValue(item.at) &&
                  typeof item.outcome === 'string' &&
                  ['off', 'companion', 'autonomous'].includes(item.mode),
              )
              .slice(-20)
              .map(({ at, mode, agentId, outcome, error }) => ({
                at,
                mode,
                agentId,
                outcome,
                error,
              }))
          : []
        const enabled = new Set(deps.listAgents())
        for (const [id, item] of Object.entries(saved.agents ?? {})) {
          if (enabled.has(id) && item)
            this.agents.set(id, {
              consecutiveMessages: Math.floor(timeValue(item.consecutiveMessages)),
              nextEligibleAt: timeValue(item.nextEligibleAt),
            })
        }
      }
      this.state.phase = this.settings.mode === 'off' ? 'off' : 'waiting'
      // 旧版固定会话与信息源配置不会继续落盘，也不会影响恢复。
      this.state.nextRunAt =
        this.settings.mode === 'off'
          ? null
          : Math.max(timeValue(saved?.nextRunAt), Date.now() + this.interval())
      this.state.lastOutcome =
        this.settings.mode === 'off' ? '主动行为已关闭' : '全局模式已恢复，等待下一次唤醒'
    } catch (error) {
      this.settings.mode = 'off'
      this.state.phase = 'error'
      this.state.nextRunAt = null
      this.state.lastError = error instanceof Error ? error.message : String(error)
      logger.warn(__t('logs.companion', '全局主动模式恢复失败，已保持关闭'), {
        error: this.state.lastError,
      })
    }
    await this.config.set(SETTINGS_KEY, JSON.stringify(this.settings))
    await this.persist()
    this.schedule()
  }

  getState(): ProactiveState {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: this.settings.timeZone }).format(
      new Date(),
    )
    return structuredClone({
      ...this.state,
      dailyRuns: this.day === today ? this.state.dailyRuns : 0,
      settings: this.settings,
    })
  }

  configure(patch: Partial<ProactiveSettings>): Promise<ProactiveState> {
    const operation = this.changes
      .catch(() => {})
      .then(async () => {
        const settings = this.validate({ ...this.settings, ...patch })
        const modeChanged = settings.mode !== this.settings.mode
        this.schedulingHolds++
        try {
          await this.cancelCurrent('全局主动行为设置已切换')
          await this.config.set(SETTINGS_KEY, JSON.stringify(settings))
          this.settings = settings
          this.state.agentId = null
          this.state.phase = settings.mode === 'off' ? 'off' : 'waiting'
          this.state.nextRunAt = settings.mode === 'off' ? null : Date.now() + this.interval()
          this.state.lastError = null
          this.state.lastOutcome =
            settings.mode === 'off'
              ? '主动行为已关闭，已有定时任务继续按计划运行'
              : '全局模式已更新，对所有已启用角色生效'
          if (modeChanged) this.agents.clear()
          await this.persist()
          return this.getState()
        } finally {
          this.schedulingHolds--
          this.schedule()
        }
      })
    this.changes = operation
    return operation
  }

  /** 兼容旧 API 的角色参数，但开关始终作用于全局。 */
  async start(_agentId?: string): Promise<void> {
    await this.configure({ mode: 'companion' })
  }
  async stop(_agentId?: string): Promise<void> {
    await this.configure({ mode: 'off' })
  }
  isRunning(agentId: string): boolean {
    return this.settings.mode === 'companion' && !!this.deps?.listAgents().includes(agentId)
  }
  listStates(agentIds: string[]) {
    return agentIds.map((agentId) => ({ agentId, enabled: this.isRunning(agentId) }))
  }

  async notifyActivity(agentId: string, _threadId?: string): Promise<void> {
    if (this.settings.mode === 'off') return
    this.state.lastActivityAt = Date.now()
    this.agents.set(agentId, {
      consecutiveMessages: 0,
      nextEligibleAt: Date.now() + this.interval(),
    })
    this.schedulingHolds++
    try {
      if (this.settings.mode === 'companion' || agentId === this.state.agentId) {
        // 先等待主动回合退出，避免与新用户输入交叉入库。
        await this.cancelCurrent('用户开始交互，主动回合让出执行')
        if (this.isEnabled()) this.state.nextRunAt = Date.now() + this.interval()
      }
      await this.persist().catch((error) =>
        logger.warn(__t('logs.companion', '保存主动行为活动时间失败'), { error }),
      )
    } finally {
      this.schedulingHolds--
      this.schedule()
    }
  }

  async checkNow(): Promise<ProactiveState> {
    if (this.settings.mode === 'off')
      throw new AppError('INVALID_PARAMETER', { message: '请先开启智能陪伴或自主行动' })
    if (!this.inFlight) {
      this.state.nextRunAt = Date.now()
      this.schedule()
    }
    return this.getState()
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    await this.cancelCurrent('服务正在关闭')
    await this.persist()
  }

  private interval(): number {
    return (
      (this.settings.mode === 'companion'
        ? this.settings.companionIntervalMinutes
        : this.settings.autonomousIntervalMinutes) * 60_000
    )
  }

  /** 等待取消回传期间，全局模式可能已被另一项设置操作关闭。 */
  private isEnabled(): boolean {
    return this.settings.mode !== 'off'
  }

  private validate(input: ProactiveSettings): ProactiveSettings {
    if (
      !['off', 'companion', 'autonomous'].includes(input.mode) ||
      ![input.companionIntervalMinutes, input.autonomousIntervalMinutes].every(
        (value) => Number.isFinite(value) && value >= 1 && value <= 1440,
      ) ||
      !Number.isInteger(input.maxDailyRuns) ||
      input.maxDailyRuns < 1 ||
      input.maxDailyRuns > 1440 ||
      typeof input.goal !== 'string' ||
      input.goal.length > 8000
    )
      throw new AppError('INVALID_PARAMETER', {
        message: '主动行为配置无效，请检查模式、间隔和每日预算',
      })
    try {
      new Intl.DateTimeFormat('en', { timeZone: input.timeZone })
    } catch {
      throw new AppError('INVALID_PARAMETER', { message: '主动行为时区无效' })
    }
    // 仅保留正式设置，避免旧配置中的会话和 URL 字段随展开运算符重新保存。
    return {
      mode: input.mode,
      companionIntervalMinutes: input.companionIntervalMinutes,
      autonomousIntervalMinutes: input.autonomousIntervalMinutes,
      goal: input.goal.trim(),
      maxDailyRuns: input.maxDailyRuns,
      timeZone: input.timeZone,
    }
  }

  private async cancelCurrent(reason: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.controller?.abort(new Error(reason))
    await this.inFlight?.catch(() => {})
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    if (this.stopped || this.schedulingHolds || this.settings.mode === 'off' || this.inFlight)
      return
    const delay = Math.min(
      2_147_483_647,
      Math.max(100, (this.state.nextRunAt ?? Date.now() + this.interval()) - Date.now()),
    )
    this.timer = setTimeout(() => {
      const controller = new AbortController()
      this.controller = controller
      this.inFlight = this.tick(controller.signal)
        .catch(async (error) => {
          this.state.agentId = null
          this.state.phase = controller.signal.aborted ? 'waiting' : 'error'
          this.state.lastError = controller.signal.aborted
            ? null
            : error instanceof Error
              ? error.message
              : String(error)
          this.state.lastOutcome = controller.signal.aborted
            ? '主动回合已取消'
            : '调度发生异常，稍后重试'
          this.state.nextRunAt = Date.now() + this.interval()
          if (!controller.signal.aborted)
            logger.error(__t('logs.companion', '主动行为调度失败'), { error })
          await this.persist().catch(() => {})
        })
        .finally(() => {
          this.inFlight = undefined
          this.controller = undefined
          this.schedule()
        })
    }, delay)
    this.timer.unref?.()
  }

  private async tick(signal: AbortSignal): Promise<void> {
    if (!this.deps || this.settings.mode === 'off') return
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: this.settings.timeZone }).format(
      new Date(),
    )
    if (this.day !== day) {
      this.day = day
      this.state.dailyRuns = 0
    }
    if (this.state.dailyRuns >= this.settings.maxDailyRuns) {
      this.state.phase = 'waiting'
      this.state.lastOutcome = '今日主动回合已达全局预算，等待次日恢复'
      this.state.nextRunAt = Date.now() + 60 * 60_000
      await this.persist()
      return
    }
    const ids = [...new Set(this.deps.listAgents())].sort()
    for (const id of this.agents.keys()) if (!ids.includes(id)) this.agents.delete(id)
    const offset = ids.indexOf(this.cursor) + 1
    const ordered = [...ids.slice(offset), ...ids.slice(0, offset)]
    const agentId = ordered.find(
      (id) => (this.agents.get(id)?.nextEligibleAt ?? 0) <= Date.now() && !this.deps!.isBusy(id),
    )
    if (!agentId) {
      this.state.phase = 'waiting'
      this.state.lastError = null
      this.state.lastOutcome = ids.length
        ? '角色正在忙碌或冷却，稍后唤醒'
        : '当前没有已启用角色，等待角色启用'
      this.state.nextRunAt = Date.now() + Math.min(60_000, this.interval())
      await this.persist()
      return
    }
    this.cursor = agentId
    this.state.agentId = agentId
    const mode = this.settings.mode
    const agent = this.agents.get(agentId) ?? { consecutiveMessages: 0, nextEligibleAt: 0 }
    this.agents.set(agentId, agent)
    let outcome = '',
      error: string | undefined
    try {
      // 会话仅在本次执行时自动解析，删除或新建会话不会关闭全局模式。
      const thread = await this.deps.resolveThread(agentId)
      signal.throwIfAborted()
      if (
        thread.agentId !== agentId ||
        thread.channel !== 'desktop' ||
        thread.purpose !== 'conversation' ||
        (thread.status && thread.status !== 'active')
      )
        throw new Error('自动取得的执行会话无效，本轮稍后重试')
      if (!this.deps.listAgents().includes(agentId) || this.deps.isBusy(agentId)) {
        outcome = '角色状态已改变，本轮暂缓执行'
        return
      }
      this.state.phase = 'running'
      this.state.dailyRuns++
      this.state.lastRunAt = Date.now()
      await this.persist()
      signal.throwIfAborted()
      const content =
        mode === 'companion'
          ? '【全局智能陪伴唤醒】依据你的真实记忆、当前会话和用户近期互动，判断是否值得主动交流。没有新内容或用户没有回应时可安静结束，不要反复问候。不得凭空声称看到了用户活动；需要观察或联网时实际调用当前已开放工具。执行模式和审批权限沿用本次会话，不自行修改。'
          : `【全局自主行动唤醒】结合你的记忆、用户授权事项、已有任务与当前会话，判断现在值得推进什么。优先延续已授权的工作，按需要收集信息、整理结果或安排后续；需要最新资料时调用现有联网搜索和网页工具，不编造观察。没有值得行动或通知的内容可安静结束。执行模式和审批权限沿用本次会话，不自行修改；已经完成的操作不要重复执行。${this.settings.goal ? `\n用户的行动偏好：${this.settings.goal}` : ''}`
      const reply = await this.deps.run({ mode, thread, content, signal })
      signal.throwIfAborted()
      if (reply?.trim()) {
        agent.consecutiveMessages++
        outcome =
          mode === 'companion' ? '主动陪伴消息已保存并推送' : '自主行动本轮已完成，结果已保存'
      } else outcome = '本轮没有需要通知的新内容，已安静结束'
    } catch (failure) {
      if (signal.aborted) outcome = '主动回合已取消，未重放已执行操作'
      else {
        error = failure instanceof Error ? failure.message : String(failure)
        outcome = '本轮执行失败，其他角色仍可继续调度'
      }
    } finally {
      this.state.agentId = null
      this.state.phase = error ? 'error' : 'waiting'
      this.state.lastError = error ?? null
      this.state.lastOutcome = outcome
      this.state.recent.push({
        at: Date.now(),
        mode,
        agentId,
        outcome,
        ...(error ? { error } : {}),
      })
      this.state.recent = this.state.recent.slice(-20)
      const backoff = Math.min(16, 2 ** Math.floor(agent.consecutiveMessages / 3))
      const hour = Number(
        new Intl.DateTimeFormat('en', {
          timeZone: this.settings.timeZone,
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date()),
      )
      const night = mode === 'companion' && (hour < 7 || hour >= 23) ? 3 : 1
      agent.nextEligibleAt =
        Date.now() + this.interval() * (mode === 'companion' ? backoff * night : 1)
      this.state.nextRunAt = Date.now() + this.interval()
      logger.info(__t('logs.companion', '全局主动行为本轮结束'), {
        mode,
        agentId,
        outcome,
        dailyRuns: this.state.dailyRuns,
        error,
      })
      await this.persist()
    }
  }

  private persist(): Promise<void> {
    const data = JSON.stringify({
      version: 2,
      ...this.state,
      day: this.day,
      cursor: this.cursor,
      agents: Object.fromEntries(this.agents),
    })
    const write = this.writes
      .catch(() => {})
      .then(async () => {
        await this.config.set(STATE_KEY, data)
        await this.deps
          ?.changed(this.getState())
          .catch((error) => logger.warn(__t('logs.companion', '主动状态推送失败'), { error }))
      })
    this.writes = write
    return write
  }
}
