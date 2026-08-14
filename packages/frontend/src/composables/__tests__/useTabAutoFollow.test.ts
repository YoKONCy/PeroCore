/* @vitest-environment jsdom */

/**
 * useTabAutoFollow 单元测试
 *
 * jsdom 不提供真实布局，scrollHeight / clientHeight 恒为 0，
 * 这里通过 Object.defineProperty 注入假布局值以驱动跟随状态判定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useTabAutoFollow } from '@infos/frontend/composables/useTabAutoFollow'
import type { UseTabAutoFollowReturn } from '@infos/frontend/composables/useTabAutoFollow'

/** 测试用布局尺寸：可视高度 500，内容高度 1000 */
const CLIENT_HEIGHT = 500
const SCROLL_HEIGHT = 1000

/** 创建带假布局的容器元素 */
function createContainer() {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: CLIENT_HEIGHT, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: SCROLL_HEIGHT, configurable: true })
  el.scrollTop = 0
  Object.defineProperty(el, 'scrollTo', { value: vi.fn(), writable: true, configurable: true })
  return el
}

/**
 * 用一个宿主组件挂载 hook，保证 onMounted / onUnmounted 正常触发，
 * 卸载宿主动作即等价于 hook 的卸载流程。
 */
function mountHook(containerRef: Ref<HTMLElement | null>) {
  let api!: UseTabAutoFollowReturn
  const Host = defineComponent({
    setup() {
      api = useTabAutoFollow({ containerRef })
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  return { api, wrapper }
}

describe('useTabAutoFollow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('初始状态 isFollowing 为 true 且 hasNewContent 为 false', () => {
    const container = ref<HTMLElement | null>(null)
    const { api, wrapper } = mountHook(container)

    expect(api.isFollowing.value).toBe(true)
    expect(api.hasNewContent.value).toBe(false)

    wrapper.unmount()
  })

  it('用户向上滚动到阈值外后 isFollowing 变为 false', async () => {
    const el = createContainer()
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)

    // 距底部 300px（默认阈值 80px）
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 300
    el.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(60)

    expect(api.isFollowing.value).toBe(false)

    wrapper.unmount()
  })

  it('滚回阈值内后恢复跟随并清零未读标记', async () => {
    const el = createContainer()
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)

    // 先滚出阈值
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 300
    el.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(60)
    expect(api.isFollowing.value).toBe(false)

    // 未跟随期间收到新内容
    api.notifyNewContent()
    expect(api.hasNewContent.value).toBe(true)

    // 滚回阈值内（距底部 40px）
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT - 40
    el.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(60)

    expect(api.isFollowing.value).toBe(true)
    expect(api.hasNewContent.value).toBe(false)

    wrapper.unmount()
  })

  it('未跟随时 notifyNewContent 标记 hasNewContent', () => {
    const el = createContainer()
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)
    // 忽略挂载时 initialScrollToBottom 产生的初始吸底调用
    vi.mocked(el.scrollTo).mockClear()

    // 通过 pauseFollowing 进入非跟随状态
    api.pauseFollowing()
    api.notifyNewContent()

    expect(api.hasNewContent.value).toBe(true)
    expect(el.scrollTo).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('跟随状态下 notifyNewContent 会触发 scrollTo 平滑吸底', async () => {
    const el = createContainer()
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT // 已贴底
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)

    expect(api.isFollowing.value).toBe(true)

    api.notifyNewContent()
    await nextTick()

    expect(el.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
    expect(api.hasNewContent.value).toBe(false)

    wrapper.unmount()
  })

  it('scrollToBottom 复位 hasNewContent 并恢复跟随', () => {
    const el = createContainer()
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)

    // 构造未读状态
    api.pauseFollowing()
    api.notifyNewContent()
    expect(api.hasNewContent.value).toBe(true)

    api.scrollToBottom()

    expect(el.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
    expect(api.hasNewContent.value).toBe(false)
    expect(api.isFollowing.value).toBe(true)

    wrapper.unmount()
  })

  it('暂停期间忽略用户滚动，恢复后按当前位置重算', async () => {
    const el = createContainer()
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)

    api.pauseFollowing()
    expect(api.isFollowing.value).toBe(false)

    // 暂停期间滚回底部，状态不应被 scroll 事件改变
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT
    el.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(60)
    expect(api.isFollowing.value).toBe(false)

    // 恢复后立即按当前位置重算（已贴底 → 恢复跟随）
    api.resumeFollowing()
    expect(api.isFollowing.value).toBe(true)

    wrapper.unmount()
  })

  it('resize 时跟随状态下保持贴底', () => {
    installResizeObserverMock()
    const el = createContainer()
    el.scrollTop = SCROLL_HEIGHT - CLIENT_HEIGHT
    const container = ref<HTMLElement | null>(el)
    const { api, wrapper } = mountHook(container)
    void api

    triggerResize()
    expect(el.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'instant' })

    wrapper.unmount()
  })

  it('卸载时移除 scroll 监听并清理防抖 timer', async () => {
    const el = createContainer()
    const removeSpy = vi.spyOn(el, 'removeEventListener')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const container = ref<HTMLElement | null>(el)
    const { wrapper } = mountHook(container)

    // 触发一次滚动以创建 pending 的防抖 timer
    el.dispatchEvent(new Event('scroll'))
    wrapper.unmount()

    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    expect(clearSpy).toHaveBeenCalled()
  })
})

// ── ResizeObserver mock ──
// jsdom 无 ResizeObserver：这里用可控的桩实现，记录回调供测试手动触发

let latestResizeCallback: (() => void) | null = null

/** 安装 ResizeObserver 桩 */
function installResizeObserverMock() {
  latestResizeCallback = null
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        latestResizeCallback = () => cb([] as ResizeObserverEntry[], this as ResizeObserver)
      }
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    },
  )
}

/** 手动触发一次容器尺寸变化 */
function triggerResize() {
  latestResizeCallback?.()
}
