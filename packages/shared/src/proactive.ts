export type ProactiveMode = 'off' | 'companion' | 'autonomous'

/** 所有已启用角色共用的主动行为策略，不绑定角色或会话。 */
export interface ProactiveSettings {
  mode: ProactiveMode
  companionIntervalMinutes: number
  autonomousIntervalMinutes: number
  goal: string
  maxDailyRuns: number
  timeZone: string
}

export interface ProactiveState {
  settings: ProactiveSettings
  /** 仅表示当前正在执行的角色，不是模式绑定。 */
  agentId: string | null
  phase: 'off' | 'waiting' | 'running' | 'error'
  nextRunAt: number | null
  lastRunAt: number | null
  lastActivityAt: number
  lastOutcome: string
  lastError: string | null
  dailyRuns: number
  recent: Array<{
    at: number
    mode: ProactiveMode
    agentId?: string
    outcome: string
    error?: string
  }>
}
