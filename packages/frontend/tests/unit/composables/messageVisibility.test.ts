// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, onMounted, provide, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useMessageVisibility } from '../../../src/composables/chat/useMessageVisibility'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('消息可见性恢复', () => {
  it('缓存页面重新激活后继续观察原消息，并忽略旧观察器迟到的回调', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    const observers: Array<{
      observe: ReturnType<typeof vi.fn>
      emit: (visible: boolean) => void
    }> = []
    let message!: HTMLElement
    class Observer {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      constructor(callback: IntersectionObserverCallback) {
        observers.push({
          observe: this.observe,
          emit: (visible) =>
            callback(
              [
                {
                  target: message,
                  isIntersecting: visible,
                  boundingClientRect: message.getBoundingClientRect(),
                  intersectionRect: message.getBoundingClientRect(),
                  rootBounds: null,
                  time: 0,
                  intersectionRatio: visible ? 1 : 0,
                },
              ],
              this as unknown as IntersectionObserver,
            ),
        })
      }
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    const shown = ref(true)
    const shellVisible = ref(true)
    const visibility = vi.fn()
    const Child = defineComponent({
      setup() {
        const container = ref<HTMLElement | null>(null)
        const { observe } = useMessageVisibility(container, visibility)
        onMounted(() => {
          message = container.value!.firstElementChild as HTMLElement
          observe(message)
        })
        return () => h('div', { ref: container }, [h('div', '正文')])
      },
    })
    const wrapper = mount({
      setup() {
        provide('infos:main-surface-visible', shellVisible)
        return () => h(KeepAlive, () => (shown.value ? h(Child) : null))
      },
    })
    try {
      observers[0]!.emit(true)
      shown.value = false
      await nextTick()
      expect(visibility).toHaveBeenLastCalledWith(message, false)
      observers[0]!.emit(true)
      expect(visibility).toHaveBeenLastCalledWith(message, false)
      shown.value = true
      await nextTick()
      expect(observers.at(-1)!.observe).toHaveBeenCalledWith(message)
      observers.at(-1)!.emit(true)
      expect(visibility).toHaveBeenLastCalledWith(message, true)
      shellVisible.value = false
      await nextTick()
      expect(visibility).toHaveBeenLastCalledWith(message, false)
      shellVisible.value = true
      await nextTick()
      expect(observers.at(-1)!.observe).toHaveBeenCalledWith(message)
    } finally {
      wrapper.unmount()
    }
  })
})
