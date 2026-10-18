import { app, BrowserWindow, globalShortcut, powerMonitor } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_PET_CONTROLS,
  pttVirtualKeys,
  type PetControlSettings,
  type PetControlSnapshot,
  type PetConversationTarget,
} from '@infos/shared'
import { windowManager } from '../windows/manager'
import { desktopTabs } from '../windows/desktopTabs'
import { logger } from '../utils/logger'

class PetControls {
  private settings: PetControlSettings = { ...DEFAULT_PET_CONTROLS }
  private error = ''
  private keyState?: (key: number) => number
  private timer?: ReturnType<typeof setInterval>
  private armed = false
  private held = false
  private blocked = false
  private suspended = false
  private shortcuts: string[] = []
  private capture?: { owner: Electron.WebContents; cleanup: () => void }
  private target?: PetConversationTarget

  async start(): Promise<void> {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as Partial<PetControlSettings>
      this.settings = this.validate(saved)
    } catch {
      /* 首次使用采用默认设置。 */
    }
    if (process.platform === 'win32') {
      try {
        const { default: koffi } = await import('koffi')
        const user32 = koffi.load('user32.dll')
        this.keyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (
          key: number,
        ) => number
      } catch (error) {
        this.error = '全局按住说话不可用，请检查桌面输入组件'
        logger.warn('PetControls', `Windows 输入组件加载失败：${String(error)}`)
      }
    }
    powerMonitor.on('lock-screen', this.onSuspend)
    powerMonitor.on('suspend', this.onSuspend)
    powerMonitor.on('unlock-screen', this.onResume)
    powerMonitor.on('resume', this.onResume)
    this.registerBindings()
    this.broadcast()
  }

  snapshot(): PetControlSnapshot {
    return { settings: { ...this.settings }, pttSupported: !!this.keyState, error: this.error }
  }

  update(patch: unknown): PetControlSnapshot {
    const next = this.validate({
      ...this.settings,
      ...(patch && typeof patch === 'object' ? patch : {}),
    })
    const prepareAgain =
      next.voiceMode !== this.settings.voiceMode || next.microphoneId !== this.settings.microphoneId
    const inputChanged = prepareAgain || next.pttBinding !== this.settings.pttBinding
    const shortcutsChanged = [
      'toggleVoiceShortcut',
      'stopSpeechShortcut',
      'openConversationShortcut',
      'togglePetShortcut',
    ].some(
      (key) =>
        next[key as keyof PetControlSettings] !== this.settings[key as keyof PetControlSettings],
    )
    fs.mkdirSync(path.dirname(this.file()), { recursive: true })
    fs.writeFileSync(this.file(), JSON.stringify(next, null, 2), 'utf8')
    if (inputChanged) this.release(true)
    if (prepareAgain) this.armed = false
    this.settings = next
    if (shortcutsChanged) this.registerBindings()
    if (inputChanged) this.syncTimer()
    this.broadcast()
    return this.snapshot()
  }

  setArmed(ready: boolean): void {
    this.armed = ready
    this.release(true)
    this.syncTimer()
  }

  /** 录入时让按键交给设置页，窗口失焦、刷新或关闭后恢复原有绑定。 */
  setCapturing(owner: Electron.WebContents, active: boolean): void {
    if (active) {
      if (this.capture?.owner === owner) return
      if (this.capture) throw new Error('另一个窗口正在录入快捷键')
      const win = BrowserWindow.fromWebContents(owner)
      if (!win || !win.isFocused()) throw new Error('请在当前窗口录入快捷键')
      const release = () => this.setCapturing(owner, false)
      owner.once('destroyed', release)
      owner.once('render-process-gone', release)
      owner.once('did-start-loading', release)
      win.once('blur', release)
      this.capture = {
        owner,
        cleanup: () => {
          owner.removeListener('destroyed', release)
          owner.removeListener('render-process-gone', release)
          owner.removeListener('did-start-loading', release)
          win.removeListener('blur', release)
        },
      }
      this.release(true)
    } else {
      if (this.capture?.owner !== owner) return
      this.capture.cleanup()
      this.capture = undefined
    }
    this.registerBindings()
    this.syncTimer()
    if (!active) this.broadcast()
  }

  setConversation(target: PetConversationTarget): void {
    if (!target || typeof target.agentId !== 'string' || !target.agentId.trim()) return
    this.target = {
      agentId: target.agentId,
      threadId: typeof target.threadId === 'string' ? target.threadId : undefined,
      messageId: typeof target.messageId === 'string' ? target.messageId : undefined,
      taskId: typeof target.taskId === 'string' ? target.taskId : undefined,
    }
  }

  openConversation(target?: PetConversationTarget): void {
    if (target) this.setConversation(target)
    windowManager.createDashboardWindow()
    desktopTabs.openHome(this.target?.taskId ? 'tasks' : 'chat', this.target)
  }

  stop(): void {
    this.capture?.cleanup()
    this.capture = undefined
    this.setArmed(false)
    for (const shortcut of this.shortcuts) globalShortcut.unregister(shortcut)
    this.shortcuts = []
    powerMonitor.removeListener('lock-screen', this.onSuspend)
    powerMonitor.removeListener('suspend', this.onSuspend)
    powerMonitor.removeListener('unlock-screen', this.onResume)
    powerMonitor.removeListener('resume', this.onResume)
  }

  private readonly onSuspend = () => {
    this.suspended = true
    this.release(true)
    this.action('suspend-voice')
    this.action('stop-speech')
    this.syncTimer()
  }
  private readonly onResume = () => {
    this.suspended = false
    this.action('resume-voice')
    this.syncTimer()
  }

  private file(): string {
    return path.join(app.getPath('userData'), 'pet-controls.json')
  }

  private validate(patch: Partial<PetControlSettings>): PetControlSettings {
    const next = { ...DEFAULT_PET_CONTROLS }
    if (['off', 'ptt', 'vad'].includes(String(patch.voiceMode))) next.voiceMode = patch.voiceMode!
    if (typeof patch.pttBinding === 'string') {
      if (!pttVirtualKeys(patch.pttBinding))
        throw new Error('该按住说话绑定不受支持，请选择侧键、字母、功能键或组合键')
      next.pttBinding = patch.pttBinding
    }
    for (const key of [
      'toggleVoiceShortcut',
      'stopSpeechShortcut',
      'openConversationShortcut',
      'togglePetShortcut',
    ] as const) {
      if (typeof patch[key] === 'string' && patch[key]!.length <= 100)
        next[key] = patch[key]!.trim()
    }
    if (typeof patch.speechEnabled === 'boolean') next.speechEnabled = patch.speechEnabled
    if (typeof patch.subtitlesEnabled === 'boolean') next.subtitlesEnabled = patch.subtitlesEnabled
    if (typeof patch.microphoneId === 'string' && patch.microphoneId.length <= 500)
      next.microphoneId = patch.microphoneId
    return next
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('pet-controls:changed', this.snapshot())
    }
  }

  private action(action: string): void {
    const win = windowManager.petWin
    if (win && !win.isDestroyed()) win.webContents.send('pet-controls:action', { action })
    if (action === 'stop-speech')
      windowManager.dashboardWin?.webContents.send('pet-controls:action', { action })
  }

  private registerBindings(): void {
    for (const shortcut of this.shortcuts) globalShortcut.unregister(shortcut)
    this.shortcuts = []
    if (this.capture) return
    if (this.keyState) this.error = ''
    const bindings: Array<[string, () => void]> = [
      [
        this.settings.toggleVoiceShortcut,
        () => {
          this.update({ voiceMode: this.settings.voiceMode === 'off' ? 'ptt' : 'off' })
          if (
            this.settings.voiceMode !== 'off' &&
            (!windowManager.petWin || windowManager.petWin.isDestroyed())
          )
            windowManager.createPetWindow()
        },
      ],
      [this.settings.stopSpeechShortcut, () => this.action('stop-speech')],
      [this.settings.openConversationShortcut, () => this.openConversation()],
      [
        this.settings.togglePetShortcut,
        () => {
          const win = windowManager.petWin
          if (!win || win.isDestroyed()) windowManager.createPetWindow()
          else if (win.isVisible()) win.hide()
          else win.showInactive()
        },
      ],
    ]
    for (const [shortcut, handler] of bindings) {
      if (!shortcut) continue
      try {
        if (!globalShortcut.register(shortcut, handler)) throw new Error('快捷键已被占用')
        this.shortcuts.push(shortcut)
      } catch {
        this.error = `快捷键 ${shortcut} 未能注册，请更换绑定`
      }
    }
  }

  private syncTimer(): void {
    clearInterval(this.timer)
    this.timer = undefined
    if (
      !this.keyState ||
      !this.armed ||
      this.suspended ||
      this.capture ||
      this.settings.voiceMode !== 'ptt'
    ) {
      return
    }
    this.blocked = this.isDown()
    // 仅在 PTT 已准备好时读取绑定键的最高状态位，不依赖易丢失的窗口松开事件。
    this.timer = setInterval(() => {
      const down = this.isDown()
      if (this.blocked) {
        if (!down) this.blocked = false
        return
      }
      if (this.held && (this.keyState!(0x1b) & 0x8000) !== 0) {
        this.release(true)
        this.blocked = true
        this.action('cancel-voice')
        return
      }
      if (down === this.held) return
      this.held = down
      const win = windowManager.petWin
      if (!win || win.isDestroyed()) {
        this.setArmed(false)
        return
      }
      win.webContents.send('pet-controls:ptt', { pressed: down, cancelled: false })
    }, 16)
  }

  private isDown(): boolean {
    const keys = pttVirtualKeys(this.settings.pttBinding)
    return !!this.keyState && !!keys && keys.every((key) => (this.keyState!(key) & 0x8000) !== 0)
  }

  private release(cancelled: boolean): void {
    if (!this.held) return
    this.held = false
    const win = windowManager.petWin
    if (win && !win.isDestroyed())
      win.webContents.send('pet-controls:ptt', { pressed: false, cancelled })
  }
}

export const petControls = new PetControls()
