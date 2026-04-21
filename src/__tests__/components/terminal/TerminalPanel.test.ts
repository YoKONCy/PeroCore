import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TerminalPanel from '@/components/terminal/TerminalPanel.vue'
import { listen, invoke } from '@/utils/ipcAdapter'
import { getRuntimeCapabilities } from '@/utils/runtimeCapabilities'
import { nextTick } from 'vue'

// 模拟 ipcAdapter
vi.mock('@/utils/ipcAdapter', () => ({
  listen: vi.fn(),
  invoke: vi.fn()
}))

vi.mock('@/utils/runtimeCapabilities', () => ({
  getRuntimeCapabilities: vi.fn()
}))

// 模拟 PixelIcon 组件
const PixelIcon = {
  template: '<span class="pixel-icon" :class="name"><slot /></span>',
  props: ['name', 'size']
}

describe('TerminalPanel.vue', () => {
  let wrapper: any
  let listeners: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    listeners = {}

    ;(getRuntimeCapabilities as any).mockReturnValue({
      host: 'electron-local',
      eventTransport: 'electron-ipc',
      backendLogHistory: true,
      backendLogStream: true,
      localServiceControl: true,
      nativeWindowControl: true
    })

    // 默认 mock 实现
    ;(invoke as any).mockResolvedValue([])
    ;(listen as any).mockImplementation((event: string, callback: (...args: any[]) => any) => {
      listeners[event] = callback
      return Promise.resolve(() => {}) // 返回 unlisten 函数
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (wrapper) wrapper.unmount()
  })

  const mountComponent = () => {
    return mount(TerminalPanel, {
      global: {
        components: {
          PixelIcon
        }
      }
    })
  }

  it('渲染正常', async () => {
    wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.exists()).toBe(true)
    // 检查是否包含标题文本
    expect(wrapper.text()).toContain('实时终端')
  })

  it('应该加载历史日志', async () => {
    // 模拟后端返回的历史日志格式，通常包含 [INFO] 等标签
    const historyLogs = ['[INFO] System started', '[WARN] Low memory']
    ;(invoke as any).mockResolvedValue(historyLogs)

    wrapper = mountComponent()
    // 等待 onMounted 中的异步操作
    await flushPromises()
    // 由于 addLog 有 100ms 延迟，需要推进时间
    vi.advanceTimersByTime(200)
    await nextTick()

    // 检查是否渲染了日志消息
    const text = wrapper.text()
    expect(text).toContain('System started')
    expect(text).toContain('Low memory')
  })

  it('监听 backend-log 并添加日志', async () => {
    wrapper = mountComponent()
    await flushPromises()

    // 确保监听器已注册
    expect(listeners['backend-log']).toBeDefined()

    // 模拟收到后端日志事件
    const callback = listeners['backend-log']
    callback({ payload: '[ERROR] Connection failed' })

    // 触发定时器更新 (addLog 内部有 100ms setTimeout)
    vi.advanceTimersByTime(200)
    await nextTick()

    expect(wrapper.text()).toContain('Connection failed')
    // 检查是否应用了错误样式类
    const errorLog = wrapper.find('.text-red-400')
    expect(errorLog.exists()).toBe(true)
  })

  it('点击清空按钮应该清空日志', async () => {
    // 预先加载一些日志
    ;(invoke as any).mockResolvedValue(['[INFO] Log 1', '[INFO] Log 2'])

    wrapper = mountComponent()
    await flushPromises()
    vi.advanceTimersByTime(200)
    await nextTick()

    // 验证初始日志存在（通过搜索 [backend] 标签或消息内容）
    expect(wrapper.text()).toContain('Log 1')

    // 找到清空按钮并点击
    const clearBtn = wrapper.find('button[title="清空"]')
    await clearBtn.trigger('click')

    // 验证日志已被清空
    expect(wrapper.text()).not.toContain('Log 1')
    expect(wrapper.text()).toContain('等待系统日志...')
  })

  it('应该能拦截控制台日志 (Hook Console)', async () => {
    wrapper = mountComponent()
    await flushPromises()

    // 触发 console.log
    console.log('Frontend log message')

    // 应该被拦截并添加到界面
    vi.advanceTimersByTime(200)
    await nextTick()

    const text = wrapper.text()
    expect(text).toContain('Frontend log message')
    expect(text).toContain('[frontend]') // 检查来源标记
  })

  it('Web 模式下应优雅降级到前端日志提示', async () => {
    ;(getRuntimeCapabilities as any).mockReturnValue({
      host: 'web',
      eventTransport: 'browser-local',
      backendLogHistory: false,
      backendLogStream: false,
      localServiceControl: false,
      nativeWindowControl: false
    })

    wrapper = mountComponent()
    await flushPromises()
    vi.advanceTimersByTime(200)
    await nextTick()

    expect(invoke).not.toHaveBeenCalledWith('get_backend_logs')
    expect(listeners['backend-log']).toBeUndefined()
    expect(wrapper.text()).toContain('Runtime Logs')
  })
})
