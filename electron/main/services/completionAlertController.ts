import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_COMPLETION_ALERT_SETTINGS,
  type CompletionAlert,
  type CompletionAlertSettings,
} from '@infos/shared'

export interface CompletionAlertPorts {
  applicationFocused(): boolean
  petVisible(): boolean | Promise<boolean>
  playSound(): Promise<void>
  stopSound?(): void
  showNotification(alert: CompletionAlert): void
  windowsNotificationsSupported(): boolean
  warn(message: string, error: unknown): void
  now?: () => number
}

/** 单个客户端统一去重；关闭某种提醒时也结算事件，重新开启后不补播旧任务。 */
export class CompletionAlertController {
  private settings: CompletionAlertSettings = { ...DEFAULT_COMPLETION_ALERT_SETTINGS }
  private seen = new Map<string, number>()
  private now: () => number
  constructor(
    private file: string,
    private seenFile: string,
    private ports: CompletionAlertPorts,
  ) {
    this.now = ports.now ?? Date.now
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CompletionAlertSettings>
      for (const key of ['soundEnabled', 'windowsNotificationsEnabled'] as const) {
        if (typeof saved[key] === 'boolean') this.settings[key] = saved[key]!
      }
    } catch {
      /* 首次启动或旧配置无效时使用默认偏好。 */
    }
    try {
      const saved = JSON.parse(fs.readFileSync(seenFile, 'utf8')) as unknown
      if (Array.isArray(saved))
        for (const item of saved.slice(-1024)) {
          if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number')
            this.seen.set(item[0], item[1])
        }
    } catch {
      /* 去重记录不可用时仍保留当前进程的去重能力。 */
    }
  }

  snapshot() {
    return {
      ...this.settings,
      windowsNotificationsSupported: this.ports.windowsNotificationsSupported(),
    }
  }

  update(patch: unknown) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new Error('完成提醒设置格式不正确')
    const next = { ...this.settings }
    for (const key of ['soundEnabled', 'windowsNotificationsEnabled'] as const) {
      if (key in patch) {
        const value = (patch as Record<string, unknown>)[key]
        if (typeof value !== 'boolean') throw new Error('完成提醒开关必须为布尔值')
        next[key] = value
      }
    }
    this.write(this.file, next)
    this.settings = next
    if (!next.soundEnabled) this.ports.stopSound?.()
    return this.snapshot()
  }

  async preview(): Promise<boolean> {
    if (!this.settings.soundEnabled) return false
    await this.ports.playSound()
    return true
  }

  async notify(value: unknown): Promise<{ accepted: boolean }> {
    const alert = this.parse(value)
    const now = this.now()
    const completedAt = Date.parse(alert.completedAt)
    if (
      !Number.isFinite(completedAt) ||
      now - completedAt > 5 * 60_000 ||
      completedAt - now > 60_000 ||
      this.seen.has(alert.id)
    )
      return { accepted: false }
    // 在异步播放与读取窗口状态之前占位，保证并发投递也只提醒一次。
    this.seen.set(alert.id, now)
    while (this.seen.size > 1024) this.seen.delete(this.seen.keys().next().value!)
    try {
      this.write(this.seenFile, [...this.seen])
    } catch (error) {
      this.ports.warn('保存完成提醒去重记录失败', error)
    }
    let petVisible = true
    try {
      petVisible = await this.ports.petVisible()
    } catch (error) {
      this.ports.warn('读取桌宠显示状态失败', error)
    }
    // 通知不依赖声音是否播放成功，声音开关也不会影响静音的 Windows 通知。
    if (
      !petVisible &&
      !this.ports.applicationFocused() &&
      this.settings.windowsNotificationsEnabled &&
      this.ports.windowsNotificationsSupported()
    ) {
      try {
        this.ports.showNotification(alert)
      } catch (error) {
        this.ports.warn('发送任务完成通知失败', error)
      }
    }
    if (this.settings.soundEnabled) {
      try {
        await this.ports.playSound()
      } catch (error) {
        this.ports.warn('播放任务完成提示音失败', error)
      }
    }
    return { accepted: true }
  }

  private write(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(value), 'utf8')
    fs.renameSync(temporary, file)
  }

  private parse(value: unknown): CompletionAlert {
    if (!value || typeof value !== 'object') throw new Error('完成提醒内容无效')
    const item = value as Record<string, unknown>
    if (
      !['conversation', 'task'].includes(String(item.kind)) ||
      typeof item.id !== 'string' ||
      !item.id ||
      item.id.length > 512 ||
      typeof item.agentId !== 'string' ||
      !item.agentId ||
      item.agentId.length > 200 ||
      typeof item.completedAt !== 'string'
    )
      throw new Error('完成提醒缺少有效的事件或角色标识')
    const optionalId = (key: string) => {
      const candidate = item[key]
      return typeof candidate === 'string' && candidate.length <= 200 ? candidate : undefined
    }
    return {
      id: item.id,
      kind: item.kind as CompletionAlert['kind'],
      agentId: item.agentId,
      agentName: String(item.agentName ?? item.agentId).slice(0, 60),
      title: String(item.title ?? '任务已完成')
        .replace(/[\r\n]+/g, ' ')
        .slice(0, 120),
      completedAt: item.completedAt,
      threadId: optionalId('threadId'),
      messageId: optionalId('messageId'),
      taskId: optionalId('taskId'),
    }
  }
}
