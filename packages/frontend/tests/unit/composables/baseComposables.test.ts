import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const lifecycle = vi.hoisted(() => ({
  mounted: [] as Array<() => void>,
  unmounted: [] as Array<() => void>,
  activated: [] as Array<() => void>,
  deactivated: [] as Array<() => void>,
  watchers: [] as Array<(newValue: unknown, oldValue: unknown) => void>,
}))

vi.mock('vue', () => ({
  ref: <T>(value: T) => ({ value }),
  unref: <T>(value: T | { value: T }) =>
    typeof value === 'object' && value !== null && 'value' in value ? value.value : value,
  nextTick: () => Promise.resolve(),
  onMounted: (fn: () => void) => lifecycle.mounted.push(fn),
  onUnmounted: (fn: () => void) => lifecycle.unmounted.push(fn),
  onActivated: (fn: () => void) => lifecycle.activated.push(fn),
  onDeactivated: (fn: () => void) => lifecycle.deactivated.push(fn),
  watch: (_source: unknown, fn: (newValue: unknown, oldValue: unknown) => void) => {
    lifecycle.watchers.push(fn)
  },
}))

import { ref } from 'vue'
import { useDebounceFn, useThrottleFn } from '@infos/frontend/composables/useThrottle'
import { useLoading } from '@infos/frontend/composables/useLoading'
import { useInterval } from '@infos/frontend/composables/useInterval'
import { useEventListener } from '@infos/frontend/composables/useEventListener'
import { useChatInput } from '@infos/frontend/composables/chat/useChatInput'

function resetLifecycle() {
  lifecycle.mounted.length = 0
  lifecycle.unmounted.length = 0
  lifecycle.activated.length = 0
  lifecycle.deactivated.length = 0
  lifecycle.watchers.length = 0
}

describe('useChatInput', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'getComputedStyle',
      vi.fn(() => ({
        lineHeight: '24px',
      })),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当在 Enter 且非 Shift 时阻止默认行为并发送消息', async () => {
    const onSend = vi.fn()
    const textareaRef = ref<HTMLTextAreaElement | null>(null)
    const input = useChatInput(textareaRef, { onSend })
    const event = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    input.inputText.value = '  你好主人  '
    input.onKeydown(event)
    await Promise.resolve()
    await Promise.resolve()

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('你好主人')
    expect(input.inputText.value).toBe('')
    expect(input.isSending.value).toBe(false)
  })

  it('应当忽略空白输入和发送中的重复请求', async () => {
    let release!: () => void
    const onSend = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const textareaRef = ref<HTMLTextAreaElement | null>(null)
    const input = useChatInput(textareaRef, { onSend })

    input.inputText.value = '   '
    await input.send()
    input.inputText.value = '第一条'
    const pending = input.send()
    await Promise.resolve()
    input.inputText.value = '第二条'
    await input.send()
    release()
    await pending

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith('第一条')
  })

  it('应当根据滚动高度、最小行数和最大高度调整 textarea 高度', () => {
    const textarea = {
      style: { height: '32px' },
      scrollHeight: 180,
      focus: vi.fn(),
    } as unknown as HTMLTextAreaElement
    const textareaRef = ref<HTMLTextAreaElement | null>(textarea)
    const input = useChatInput(textareaRef, { onSend: vi.fn(), maxHeight: 120, minRows: 3 })

    input.autoResize()
    input.focus()

    expect(textarea.style.height).toBe('120px')
    expect(textarea.focus).toHaveBeenCalledTimes(1)
  })

  it('应当允许 Shift+Enter 保留默认换行行为', () => {
    const onSend = vi.fn()
    const textareaRef = ref<HTMLTextAreaElement | null>(null)
    const input = useChatInput(textareaRef, { onSend })
    const event = {
      key: 'Enter',
      shiftKey: true,
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent

    input.inputText.value = '换行'
    input.onKeydown(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('useLoading', () => {
  it('应当在异步函数成功时管理加载状态并返回结果', async () => {
    const action = vi.fn(async (name: string) => `你好，${name}`)
    const { execute, isLoading, error } = useLoading(action as never)

    const pending = execute('主人' as never)

    expect(isLoading.value).toBe(true)
    await expect(pending).resolves.toBe('你好，主人')
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('应当在异步函数失败时记录 Error 并返回 undefined', async () => {
    const action = vi.fn(async () => {
      throw '坏掉了'
    })
    const { execute, isLoading, error } = useLoading(action as never)

    const result = await execute()

    expect(result).toBeUndefined()
    expect(isLoading.value).toBe(false)
    expect(error.value).toBeInstanceOf(Error)
    expect(error.value?.message).toBe('坏掉了')
  })
})

describe('useThrottleFn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当立即执行首次调用并在窗口期尾部保留第一次延迟调用', () => {
    const fn = vi.fn()
    const throttled = useThrottleFn(fn as never, 100)

    throttled('第一次' as never)
    throttled('第二次' as never)
    throttled('第三次' as never)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('第一次')

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('第二次')
  })

  it('应当在超过节流窗口后清理尾部定时器并立即执行', () => {
    const fn = vi.fn()
    const throttled = useThrottleFn(fn as never, 100)

    throttled('第一次' as never)
    throttled('第二次' as never)
    vi.setSystemTime(1200)
    throttled('第三次' as never)

    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('第三次')
  })
})

describe('useDebounceFn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当只在防抖延迟后执行最后一次调用', () => {
    const fn = vi.fn()
    const debounced = useDebounceFn(fn as never, 80)

    debounced('第一次' as never)
    vi.advanceTimersByTime(40)
    debounced('第二次' as never)
    vi.advanceTimersByTime(79)

    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('第二次')
  })
})

describe('useInterval', () => {
  beforeEach(() => {
    resetLifecycle()
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetLifecycle()
    vi.useRealTimers()
  })

  it('应当注册挂载、激活、卸载和停用生命周期', () => {
    const callback = vi.fn()

    useInterval(callback, 50, { immediate: true })

    expect(lifecycle.mounted).toHaveLength(1)
    expect(lifecycle.activated).toHaveLength(1)
    expect(lifecycle.unmounted).toHaveLength(1)
    expect(lifecycle.deactivated).toHaveLength(1)
  })

  it('应当支持手动 start/stop 和 immediate 执行', () => {
    const callback = vi.fn()
    const { start, stop } = useInterval(callback, 50, { immediate: true })

    start()
    expect(callback).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(50)
    expect(callback).toHaveBeenCalledTimes(2)

    stop()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(2)

    lifecycle.activated[0]?.()
    expect(callback).toHaveBeenCalledTimes(3)
    lifecycle.deactivated[0]?.()
    vi.advanceTimersByTime(100)
    expect(callback).toHaveBeenCalledTimes(3)
  })
})

describe('useEventListener', () => {
  beforeEach(() => {
    resetLifecycle()
  })

  afterEach(() => {
    resetLifecycle()
  })

  it('应当在生命周期中自动绑定和解绑事件', () => {
    const target = new EventTarget()
    const handler = vi.fn()

    useEventListener(target, 'ping', handler)
    lifecycle.mounted[0]?.()

    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)

    lifecycle.unmounted[0]?.()
    target.dispatchEvent(new Event('ping'))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('应当在 ref target 变化时重新绑定新目标', () => {
    const first = new EventTarget()
    const second = new EventTarget()
    const target = ref<EventTarget | null>(first)
    const handler = vi.fn()

    useEventListener(target, 'ping', handler)
    lifecycle.mounted[0]?.()
    first.dispatchEvent(new Event('ping'))

    target.value = second
    lifecycle.watchers[0]?.(second, first)
    first.dispatchEvent(new Event('ping'))
    second.dispatchEvent(new Event('ping'))

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('应当在 target 为空时安全跳过绑定', () => {
    const target = ref<EventTarget | null>(null)
    const handler = vi.fn()

    useEventListener(target, 'ping', handler)
    lifecycle.mounted[0]?.()
    lifecycle.watchers[0]?.(null, null)

    expect(handler).not.toHaveBeenCalled()
  })
})
