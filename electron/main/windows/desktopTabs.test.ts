import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class View {
    visible = false
    address = ''
    webContents = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      setBackgroundThrottling: vi.fn(),
      send: vi.fn(),
      focus: vi.fn(),
      getURL: () => this.address,
      loadURL: vi.fn(async (url: string) => {
        this.address = url
      }),
    })
    setVisible(value: boolean) {
      this.visible = value
    }
    getVisible() {
      return this.visible
    }
    setBounds = vi.fn()
    setBackgroundColor = vi.fn()
  }
  return {
    WebContentsView: View,
    BrowserWindow: class {},
    dialog: {},
    nativeTheme: { shouldUseDarkColors: true },
  }
})
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('./desktopToasts', () => ({
  desktopToasts: { attach: vi.fn(), setNativeVisible: vi.fn() },
}))

let tabs: (typeof import('./desktopTabs'))['desktopTabs']
let host: EventEmitter & { webContents: EventEmitter }
let view: {
  webContents: EventEmitter & { loadURL: ReturnType<typeof vi.fn> }
  getVisible(): boolean
}
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  tabs = (await import('./desktopTabs')).desktopTabs
  host = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
    webContents: Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getZoomFactor: () => 1,
      send: vi.fn(),
      focus: vi.fn(),
    }),
    contentView: {
      addChildView: (value: typeof view) => {
        view = value
      },
      removeChildView: vi.fn(),
    },
  })
  tabs.attach(host as never)
  tabs.registerApplication({
    id: 'infos.pictoria',
    title: 'Pictoria',
    icon: 'image',
    description: '',
    preload: true,
    waitForSurfaceReady: true,
    url: 'http://127.0.0.1:7363',
    acceptsUrl: () => true,
  })
  tabs.openApplication('infos.pictoria')
})
afterEach(() => {
  vi.useRealTimers()
})
const application = () => tabs.snapshot().tabs.find((tab) => tab.appId === 'infos.pictoria')!

describe('子应用界面启动交接', () => {
  it.each(['pictoria', 'arca', 'napcat'])('%s 不会因外壳子框架加载而永久隐藏', (app) => {
    if (app !== 'pictoria') {
      tabs.registerApplication({
        id: `infos.${app}`,
        title: app,
        icon: 'image',
        description: '',
        url: 'http://127.0.0.1:7363',
        acceptsUrl: () => true,
      })
      tabs.openApplication(`infos.${app}`)
    }
    view.webContents.emit('did-finish-load')
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    expect(view.getVisible()).toBe(true)
    host.webContents.emit('did-start-loading')
    host.webContents.emit('did-start-navigation', {}, 'about:srcdoc', false, false)
    expect(view.getVisible()).toBe(true)
    // 前端会去重相同的弹窗状态，不应依赖它再发一次 false 才能恢复。
    tabs.setBounds({ x: 0, y: 44, width: 1280, height: 732 })
    expect(view.getVisible()).toBe(true)
  })

  it('主框架重载和弹窗遮挡分别维护，加载结束后仍尊重弹窗状态', () => {
    view.webContents.emit('did-finish-load')
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    host.webContents.emit('did-start-navigation', {}, 'http://localhost/#/app', false, true)
    expect(view.getVisible()).toBe(false)
    tabs.setObscured(false)
    expect(view.getVisible()).toBe(false)
    host.webContents.emit('did-finish-load')
    expect(view.getVisible()).toBe(true)
    tabs.setObscured(true)
    host.webContents.emit('did-start-navigation', {}, 'http://localhost/#/app', false, true)
    host.webContents.emit('did-finish-load')
    expect(view.getVisible()).toBe(false)
    tabs.setObscured(false)
    expect(view.getVisible()).toBe(true)
  })

  it('外壳同文档导航不会触发重载遮挡', () => {
    view.webContents.emit('did-finish-load')
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    host.webContents.emit('did-start-navigation', {}, 'http://localhost/#/app', true, true)
    expect(view.getVisible()).toBe(true)
  })

  it('HTML 加载完成后仍等待 Vue 就绪，随后显示原生视图', () => {
    view.webContents.emit('did-finish-load')
    expect(application().loading).toBe(true)
    expect(view.getVisible()).toBe(false)
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    expect(application().loading).toBe(false)
    expect(view.getVisible()).toBe(true)
  })

  it('Vue 先就绪时也必须等待 HTML 加载结束', () => {
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    expect(view.getVisible()).toBe(false)
    view.webContents.emit('did-finish-load')
    expect(view.getVisible()).toBe(true)
  })

  it('挂载失败不会被随后到达的加载完成事件覆盖，重新打开会重载', () => {
    tabs.setSurfaceState(view.webContents as never, { error: '模块加载失败' })
    view.webContents.emit('did-finish-load')
    expect(application().error).toContain('模块加载失败')
    expect(view.getVisible()).toBe(false)
    tabs.openApplication('infos.pictoria')
    expect(view.webContents.loadURL).toHaveBeenCalledTimes(2)
  })

  it('无法就绪的界面有超时反馈，其他页面不能伪造就绪消息', () => {
    tabs.setSurfaceState(new EventEmitter() as never, { ready: true })
    vi.advanceTimersByTime(20_000)
    expect(application().error).toContain('启动超时')
    expect(application().loading).toBe(false)
    tabs.setSurfaceState(view.webContents as never, { ready: true })
    expect(view.getVisible()).toBe(false)
  })
})
