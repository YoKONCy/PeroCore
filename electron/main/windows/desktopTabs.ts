import { BrowserWindow, WebContentsView, dialog, nativeTheme, type WebContents } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  DesktopApplication,
  DesktopTab,
  DesktopTabBounds,
  DesktopTabsState,
} from '@infos/shared'
import { logger } from '../utils/logger'
import { desktopToasts } from './desktopToasts'

interface TabEntry {
  surfaceReady?: boolean
  documentLoaded?: boolean
  startupTimer?: ReturnType<typeof setTimeout>
  navigation?: number
  tab: DesktopTab
  view?: WebContentsView
  closing?: Promise<boolean>
  finishClose?: (closed: boolean) => void
}

/** 只有主进程中的受信任适配器可以声明应用入口与 URL 边界。 */
export interface DesktopApplicationDefinition extends DesktopApplication {
  url?: string
  multiple?: boolean
  acceptsUrl: (url: URL) => boolean
  preload?: boolean
  waitForSurfaceReady?: boolean
  partition?: string
  embedded?: boolean
  sensitive?: boolean
  /** 占位页完成加载仍属于启动中，只有正式 WebUI 可以结束加载状态。 */
  isWaitingUrl?: (url: URL) => boolean
}

const HOME: DesktopTab = { id: 'home', kind: 'home', title: 'infOS', icon: 'sparkle' }
const MAX_TABS = 24

/** 管理标签的原生资源；页面隐藏不等于销毁，关闭界面不等于停止后台应用。 */
class DesktopTabManager {
  private host: BrowserWindow | null = null
  private createHost?: () => BrowserWindow
  private readonly entries = new Map<string, TabEntry>([['home', { tab: { ...HOME } }]])
  private readonly applications = new Map<string, DesktopApplicationDefinition>()
  private activeTabId = 'home'
  private lastPresentedTabId?: string
  private motionLevel: 'full' | 'reduced' | 'off' = 'full'
  private homeNavigation?: DesktopTabsState['homeNavigation']
  private revision = 0
  private obscured = false
  private hostLoading = false
  private hostClosing = false
  private bounds: DesktopTabBounds = { x: 0, y: 44, width: 1280, height: 732 }
  private theme: 'light' | 'dark' = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'

  configure(createHost: () => BrowserWindow): void {
    this.createHost = createHost
  }

  ensureHost(): BrowserWindow {
    if (this.host && !this.host.isDestroyed()) return this.host
    if (!this.createHost) throw new Error('桌面标签宿主尚未初始化')
    return this.createHost()
  }

  attach(host: BrowserWindow): void {
    if (this.host === host) return
    this.host = host
    desktopToasts.attach(host)
    this.hostClosing = false
    this.obscured = false
    this.hostLoading = false
    this.installShortcuts(host.webContents)
    host.on('resize', () => this.layout())
    host.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      // 子框架加载不代表外壳重载，主页面加载也不能覆盖弹窗遮挡状态。
      if (!mainFrame || inPlace || this.host !== host) return
      this.hostLoading = true
      this.layout()
    })
    host.webContents.on('did-finish-load', () => {
      if (this.host !== host) return
      this.hostLoading = false
      this.layout()
    })
    host.webContents.on('render-process-gone', () => {
      if (this.host !== host) return
      this.hostLoading = true
      this.layout()
    })
    let closeApproved = false
    host.on('close', (event) => {
      if (closeApproved || ![...this.entries.values()].some((entry) => entry.view)) return
      event.preventDefault()
      if (this.hostClosing) return
      this.hostClosing = true
      void this.closeAll()
        .then((closed) => {
          this.hostClosing = false
          if (!closed || host.isDestroyed()) return
          closeApproved = true
          host.close()
        })
        .catch((error) => {
          this.hostClosing = false
          logger.warn('DesktopTabs', `关闭主窗口标签失败：${String(error)}`)
        })
    })
    host.once('closed', () => {
      if (this.host !== host) return
      this.host = null
      for (const entry of this.entries.values()) {
        if (entry.view && !entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close({ waitForBeforeUnload: false })
        }
      }
      this.entries.clear()
      this.entries.set('home', { tab: { ...HOME } })
      this.activeTabId = 'home'
      this.homeNavigation = undefined
      this.revision += 1
    })
  }

  isHost(sender: WebContents): boolean {
    return Boolean(this.host && !this.host.isDestroyed() && this.host.webContents === sender)
  }

  isApplication(sender: WebContents, appId?: string): boolean {
    return [...this.entries.values()].some(
      (entry) =>
        entry.tab.kind === 'application' &&
        entry.view?.webContents === sender &&
        (!appId || entry.tab.appId === appId),
    )
  }

  assertHost(sender: WebContents): void {
    if (!this.isHost(sender)) throw new Error('仅主窗口可以管理桌面标签')
  }

  snapshot(): DesktopTabsState {
    return {
      revision: this.revision,
      activeTabId: this.activeTabId,
      homeNavigation: this.homeNavigation ? { ...this.homeNavigation } : undefined,
      tabs: [...this.entries.values()].map((entry) => ({ ...entry.tab })),
      applications: [...this.applications.values()].map(({ id, title, description, icon }) => ({
        id,
        title,
        description,
        icon,
      })),
    }
  }

  private publish(): void {
    this.revision += 1
    if (this.host && !this.host.isDestroyed() && !this.host.webContents.isDestroyed()) {
      this.host.webContents.send('desktop-tabs:changed', this.snapshot())
    }
  }

  registerApplication(definition: DesktopApplicationDefinition): void {
    this.applications.set(definition.id, definition)
    this.publish()
  }

  createNew(): DesktopTabsState {
    this.ensureHost()
    if (this.hostClosing) throw new Error('窗口正在关闭，请稍后再试')
    if (this.entries.size >= MAX_TABS) throw new Error(`最多同时打开 ${MAX_TABS} 个标签`)
    const id = `new-${randomUUID()}`
    this.entries.set(id, { tab: { id, kind: 'new', title: '新标签页', icon: 'plus' } })
    this.activate(id)
    return this.snapshot()
  }

  openTarot(replaceId?: string): DesktopTabsState {
    this.ensureHost()
    if (this.hostClosing) throw new Error('窗口正在关闭，请稍后再试')
    const replaced = replaceId ? this.entries.get(replaceId) : undefined
    if (replaceId && replaced?.tab.kind !== 'new') throw new Error('新标签页已关闭或已被使用')
    const existing = [...this.entries.values()].find((entry) => entry.tab.kind === 'tarot')
    if (existing) {
      if (replaceId) this.remove(replaceId)
      return this.activate(existing.tab.id)
    }
    if (!replaced && this.entries.size >= MAX_TABS)
      throw new Error(`最多同时打开 ${MAX_TABS} 个标签`)
    const id = replaceId ?? `tarot-${randomUUID()}`
    this.entries.set(id, { tab: { id, kind: 'tarot', title: '一起抽牌', icon: 'star' } })
    return this.activate(id)
  }

  mountView(tab: DesktopTab, view: WebContentsView, activate = true, replaceId?: string): string {
    const host = this.ensureHost()
    if (this.hostClosing) throw new Error('窗口正在关闭，请稍后再试')
    const replaced = replaceId ? this.entries.get(replaceId) : undefined
    if (replaceId && replaced?.tab.kind !== 'new') throw new Error('新标签页已关闭或已被使用')
    if (!replaced && this.entries.size >= MAX_TABS)
      throw new Error(`最多同时打开 ${MAX_TABS} 个标签`)
    const id = replaced ? replaceId! : tab.id
    if (!replaced && this.entries.has(id)) throw new Error('标签标识已存在')
    const entry: TabEntry = { tab: { ...tab, id }, view }
    view.setVisible(false)
    host.contentView.addChildView(view)
    this.entries.set(id, entry)
    this.installShortcuts(view.webContents)
    view.webContents.on('destroyed', () => {
      clearTimeout(entry.startupTimer)
      entry.finishClose?.(true)
      if (this.entries.get(id) === entry) this.remove(id)
    })
    view.webContents.on('will-prevent-unload', (event) => {
      const owner = this.host
      if (!owner || owner.isDestroyed()) return
      const answer = dialog.showMessageBoxSync(owner, {
        type: 'question',
        title: '关闭标签页',
        message: `${entry.tab.title} 中有尚未提交的内容，要关闭吗？`,
        detail: 'Arca 的本地文稿草稿会保留；尚未提交的其他页面内容可能丢失。',
        buttons: ['继续编辑', '关闭标签页'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      if (answer === 1) event.preventDefault()
      else entry.finishClose?.(false)
    })
    if (activate) this.activate(id)
    else {
      this.layout()
      this.publish()
    }
    return id
  }

  openApplication(
    appId: string,
    requestedUrl?: string,
    replaceId?: string,
    navigateExisting = false,
  ): DesktopTabsState {
    const definition = this.applications.get(appId)
    if (!definition) throw new Error('该应用尚未注册桌面标签入口')
    const url = new URL(requestedUrl ?? definition.url ?? '')
    if (!definition.acceptsUrl(url)) throw new Error('禁止加载该应用地址')
    if (definition.embedded !== false) url.searchParams.set('infosEmbedded', '1')
    this.ensureHost()
    const existing = definition.multiple
      ? undefined
      : [...this.entries.values()].find((entry) => entry.tab.appId === appId)
    if (existing?.view && !existing.view.webContents.isDestroyed()) {
      if (
        existing.tab.error ||
        (navigateExisting && requestedUrl && existing.view.webContents.getURL() !== url.href)
      )
        void this.navigateApplication(appId, url.href)
      if (replaceId && this.entries.get(replaceId)?.tab.kind === 'new') this.remove(replaceId)
      this.activate(existing.tab.id)
      return this.snapshot()
    }
    if (definition.embedded !== false) url.searchParams.set('infosEmbedded', '1')
    const view = new WebContentsView({
      webPreferences: {
        ...(definition.preload
          ? {
              preload: path.join(__dirname, '../preload/index.js'),
              additionalArguments: ['--infos-embedded-app'],
            }
          : {}),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        // 启动期间不节流隐藏视图，界面就绪后再恢复后台标签节流。
        backgroundThrottling: false,
        ...(definition.partition ? { partition: definition.partition } : {}),
      },
    })
    let id: string
    try {
      view.setBackgroundColor?.(this.theme === 'dark' ? '#15151d' : '#f5f6fa')
      id = this.mountView(
        {
          id: `app-${appId}-${randomUUID()}`,
          kind: 'application',
          appId,
          title: definition.title,
          icon: definition.icon,
          loading: true,
        },
        view,
        true,
        replaceId,
      )
    } catch (error) {
      view.webContents.close({ waitForBeforeUnload: false })
      throw error
    }
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      if (!definition.sensitive)
        this.host?.webContents.send('desktop-tabs:open-link', { url: target })
      return { action: 'deny' }
    })
    const guardNavigation = (event: Electron.Event, target: string) => {
      try {
        if (!definition.acceptsUrl(new URL(target))) event.preventDefault()
      } catch {
        event.preventDefault()
      }
    }
    view.webContents.on('will-navigate', guardNavigation)
    view.webContents.on('will-redirect', guardNavigation)
    const entry = this.entries.get(id)!
    const prepare = () => {
      clearTimeout(entry.startupTimer)
      entry.surfaceReady = false
      entry.documentLoaded = false
      view.webContents.setBackgroundThrottling(false)
      this.update(id, { loading: true, error: undefined })
      if (definition.waitForSurfaceReady)
        entry.startupTimer = setTimeout(() => {
          if (this.entries.get(id) !== entry || !entry.tab.loading) return
          view.webContents.setBackgroundThrottling(true)
          this.update(id, { loading: false, error: '应用界面启动超时，请重新打开' })
        }, 20_000)
    }
    view.webContents.on('did-start-navigation', (_event, _target, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) prepare()
    })
    view.webContents.on('did-finish-load', () => {
      entry.documentLoaded = true
      const waiting = definition.isWaitingUrl?.(new URL(view.webContents.getURL())) === true
      const loading = waiting || (definition.waitForSurfaceReady === true && !entry.surfaceReady)
      if (!loading) {
        clearTimeout(entry.startupTimer)
        view.webContents.setBackgroundThrottling(true)
      }
      if (!entry.tab.error) this.update(id, { loading })
      this.sendTheme(view.webContents)
    })
    view.webContents.on('preload-error', (_event, _file, error) => {
      clearTimeout(entry.startupTimer)
      view.webContents.setBackgroundThrottling(true)
      logger.warn('DesktopTabs', `${definition.title} 桥接加载失败：${error.message}`)
      this.update(id, { loading: false, error: '应用桥接加载失败，请重新打开' })
    })
    view.webContents.on('render-process-gone', () => {
      clearTimeout(entry.startupTimer)
      this.update(id, { loading: false, error: '应用界面异常退出，可关闭标签后重新打开' })
      this.layout()
    })
    const initialEntry = this.entries.get(id)!
    prepare()
    const initialVersion = (initialEntry.navigation ?? 0) + 1
    initialEntry.navigation = initialVersion
    void view.webContents.loadURL(url.toString()).catch((error: unknown) => {
      if (this.entries.get(id) !== initialEntry || initialEntry.navigation !== initialVersion)
        return
      this.update(id, {
        loading: false,
        error: definition.sensitive
          ? '管理页加载失败，请重新打开管理页'
          : `应用界面加载失败：${String(error)}`,
      })
      clearTimeout(entry.startupTimer)
    })
    return this.snapshot()
  }

  /** 受信任管理器更新已有应用入口，关闭的标签不会被后台重新打开。 */
  async navigateApplication(appId: string, target: string): Promise<boolean> {
    const definition = this.applications.get(appId)
    const entry = [...this.entries.values()].find((e) => e.tab.appId === appId)
    if (!definition || !entry?.view || entry.view.webContents.isDestroyed()) return false
    if (!definition.acceptsUrl(new URL(target))) throw new Error('禁止加载该应用地址')
    const version = (entry.navigation ?? 0) + 1
    entry.navigation = version
    this.update(entry.tab.id, { loading: true, error: undefined })
    try {
      await entry.view.webContents.loadURL(target)
      return this.entries.get(entry.tab.id) === entry && entry.navigation === version
    } catch {
      if (this.entries.get(entry.tab.id) === entry && entry.navigation === version) {
        clearTimeout(entry.startupTimer)
        this.update(entry.tab.id, { loading: false, error: '应用界面加载失败，请重新打开' })
      }
      return false
    }
  }

  setApplicationError(appId: string, error: string): void {
    const entry = [...this.entries.values()].find((e) => e.tab.appId === appId)
    if (entry) this.update(entry.tab.id, { error, loading: false })
  }

  /** 界面成功挂载后才撤去启动画面；消息只能改变发送者自己的标签。 */
  setSurfaceState(sender: WebContents, value: unknown): void {
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.view?.webContents === sender,
    )
    if (
      !entry ||
      !this.applications.get(entry.tab.appId ?? '')?.waitForSurfaceReady ||
      entry.tab.error
    )
      return
    const state = value as { ready?: unknown; error?: unknown } | null
    if (!state || (state.ready !== true && typeof state.error !== 'string')) return
    if (typeof state.error === 'string') {
      clearTimeout(entry.startupTimer)
      sender.setBackgroundThrottling(true)
      logger.warn('DesktopTabs', `${entry.tab.title} 界面启动失败：${state.error.slice(0, 1000)}`)
      this.update(entry.tab.id, {
        loading: false,
        error: `应用界面启动失败：${state.error.slice(0, 300)}`,
      })
      return
    }
    entry.surfaceReady = true
    if (entry.documentLoaded) {
      clearTimeout(entry.startupTimer)
      sender.setBackgroundThrottling(true)
      this.update(entry.tab.id, { loading: false })
    }
  }

  activate(id: string, focus = true): DesktopTabsState {
    if (!this.entries.has(id)) throw new Error('标签页不存在')
    if (this.activeTabId !== id) this.lastPresentedTabId = undefined
    this.activeTabId = id
    this.layout()
    const entry = this.entries.get(id)!
    if (focus) {
      if (entry.view?.getVisible()) entry.view.webContents.focus()
      else this.host?.webContents.focus()
    }
    this.publish()
    return this.snapshot()
  }

  reveal(id: string): void {
    const host = this.ensureHost()
    if (host.isMinimized()) host.restore()
    host.show()
    host.focus()
    this.activate(id)
  }

  openHome(
    section?: string,
    conversation?: NonNullable<DesktopTabsState['homeNavigation']>['conversation'],
  ): void {
    this.ensureHost()
    if (section) this.homeNavigation = { section, revision: this.revision + 1, conversation }
    this.activate('home')
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        DesktopTab,
        'title' | 'url' | 'loading' | 'locked' | 'error' | 'canGoBack' | 'canGoForward'
      >
    >,
  ): void {
    const entry = this.entries.get(id)
    if (!entry) return
    Object.assign(entry.tab, patch)
    this.layout()
    this.publish()
  }

  setUnsavedChanges(sender: WebContents, dirty: boolean): void {
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.view?.webContents === sender,
    )
    if (!entry || entry.tab.dirty === dirty) return
    entry.tab.dirty = dirty
    this.publish()
  }

  async close(id: string, force = false): Promise<boolean> {
    if (id === 'home') return false
    const entry = this.entries.get(id)
    if (!entry) return true
    if (entry.closing) return entry.closing
    if (!entry.view || entry.view.webContents.isDestroyed()) {
      this.remove(id)
      return true
    }
    const contents = entry.view.webContents
    // 内嵌应用显式上报草稿状态，不依赖原生子视图的 beforeunload 传播。
    entry.closing = (async () => {
      if (!force && entry.tab.dirty && this.host && !this.host.isDestroyed()) {
        const result = await dialog.showMessageBox(this.host, {
          type: 'question',
          title: '关闭应用标签',
          message: `${entry.tab.title} 中还有尚未提交的文稿，确定关闭吗？`,
          detail: '本地文稿草稿会保留，重新打开后可以继续编辑。',
          buttons: ['继续编辑', '关闭标签页'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        if (result.response !== 1) return false
      }
      if (contents.isDestroyed()) return true
      return new Promise<boolean>((resolve) => {
        entry.finishClose = resolve
        contents.close({ waitForBeforeUnload: !force && entry.tab.kind === 'browser' })
      })
    })()
    try {
      return await entry.closing
    } finally {
      entry.closing = undefined
      entry.finishClose = undefined
    }
  }

  async closeBySender(sender: WebContents): Promise<void> {
    const entry = [...this.entries.values()].find(
      (candidate) => candidate.view?.webContents === sender,
    )
    if (entry) await this.close(entry.tab.id)
  }

  async closeAll(): Promise<boolean> {
    const wasClosing = this.hostClosing
    this.hostClosing = true
    const ids = [...this.entries.keys()].filter((id) => id !== 'home')
    ids.sort(
      (left, right) => Number(right === this.activeTabId) - Number(left === this.activeTabId),
    )
    try {
      for (const id of ids) if (!(await this.close(id))) return false
      return true
    } finally {
      this.hostClosing = wasClosing
    }
  }

  private remove(id: string): void {
    const ids = [...this.entries.keys()]
    const index = ids.indexOf(id)
    const entry = this.entries.get(id)
    clearTimeout(entry?.startupTimer)
    if (entry?.view && this.host && !this.host.isDestroyed()) {
      this.host.contentView.removeChildView(entry.view)
    }
    this.entries.delete(id)
    if (this.activeTabId === id) this.activeTabId = ids[index - 1] ?? ids[index + 1] ?? 'home'
    this.layout()
    this.publish()
  }

  setBounds(bounds: DesktopTabBounds): void {
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) return
    if (bounds.width <= 1 || bounds.height <= 1) return
    this.bounds = { ...bounds }
    this.layout()
  }

  setObscured(value: boolean): void {
    this.obscured = value
    this.layout()
  }

  private layout(): void {
    const host = this.host
    if (!host || host.isDestroyed()) return
    const area = host.getContentBounds()
    const zoom = host.webContents.getZoomFactor()
    const x = Math.max(0, Math.min(area.width - 1, Math.round(this.bounds.x * zoom)))
    const y = Math.max(0, Math.min(area.height - 1, Math.round(this.bounds.y * zoom)))
    let nativeVisible = false
    for (const [id, entry] of this.entries) {
      const view = entry.view
      if (!view || view.webContents.isDestroyed()) continue
      view.setBounds({
        x,
        y,
        width: Math.max(1, Math.min(area.width - x, Math.round(this.bounds.width * zoom))),
        height: Math.max(1, Math.min(area.height - y, Math.round(this.bounds.height * zoom))),
      })
      const visible =
        id === this.activeTabId &&
        !this.obscured &&
        !this.hostLoading &&
        !entry.tab.error &&
        !(entry.tab.kind === 'application' && entry.tab.loading)
      view.setVisible(visible)
      if (visible && entry.tab.kind === 'application' && this.lastPresentedTabId !== id) {
        this.lastPresentedTabId = id
        view.webContents.send('desktop-shell:surface-activated', this.motionLevel)
      }
      nativeVisible ||= view.getVisible()
    }
    desktopToasts.setNativeVisible(nativeVisible)
  }

  getApplicationState(appId: string): { open: boolean; visible: boolean } {
    const entry = [...this.entries.values()].find((candidate) => candidate.tab.appId === appId)
    return {
      open: Boolean(entry),
      visible: Boolean(
        entry &&
        entry.tab.id === this.activeTabId &&
        entry.view?.getVisible() &&
        this.host?.isVisible(),
      ),
    }
  }

  isVisible(id: string): boolean {
    return Boolean(
      this.host &&
      !this.host.isDestroyed() &&
      this.host.isVisible() &&
      this.entries.get(id)?.view?.getVisible(),
    )
  }

  async closeApplication(appId: string): Promise<void> {
    const entry = [...this.entries.values()].find((candidate) => candidate.tab.appId === appId)
    if (entry) await this.close(entry.tab.id)
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.theme = theme
    for (const entry of this.entries.values()) {
      if (entry.tab.kind === 'application' && entry.view && !entry.view.webContents.isDestroyed()) {
        entry.view.setBackgroundColor?.(theme === 'dark' ? '#15151d' : '#f5f6fa')
        this.sendTheme(entry.view.webContents)
      }
    }
  }

  getTheme(): 'light' | 'dark' {
    return this.theme
  }

  setMotionLevel(value: unknown): void {
    if (value !== 'full' && value !== 'reduced' && value !== 'off')
      throw new Error('无效的动效偏好')
    this.motionLevel = value
    for (const entry of this.entries.values())
      if (entry.tab.kind === 'application' && entry.view && !entry.view.webContents.isDestroyed())
        entry.view.webContents.send('desktop-shell:motion-changed', value)
  }

  private sendTheme(contents: WebContents): void {
    contents.send('desktop-shell:theme-changed', this.theme)
  }

  installShortcuts(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return
      const key = input.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        try {
          this.createNew()
        } catch (error) {
          logger.warn('DesktopTabs', String(error))
        }
      } else if (key === 'w') {
        event.preventDefault()
        void this.close(this.activeTabId).catch((error) =>
          logger.warn('DesktopTabs', `关闭标签失败：${String(error)}`),
        )
      } else if (key === 'tab') {
        event.preventDefault()
        const ids = [...this.entries.keys()]
        const offset = input.shift ? -1 : 1
        this.activate(ids[(ids.indexOf(this.activeTabId) + offset + ids.length) % ids.length]!)
      } else if (key === 'l') {
        event.preventDefault()
        this.host?.webContents.focus()
        this.host?.webContents.send('desktop-tabs:focus-address')
      }
    })
  }
}

export const desktopTabs = new DesktopTabManager()
