import { nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'

/** 同一个选中底板在项目间滑行，避免每个按钮各自闪现一个高亮。 */
export function useSelectionIndicator(root: Ref<HTMLElement | null>, selected: Ref<string>) {
  const style = ref({ opacity: '0', transform: 'translate3d(0,0,0)', width: '0px', height: '0px' })
  const ready = ref(false)
  let frame = 0
  let disposed = false
  let resize: ResizeObserver | undefined
  let changes: MutationObserver | undefined
  const observedItems = new Set<HTMLElement>()
  function observeItems(container: HTMLElement): void {
    const items = new Set(container.querySelectorAll<HTMLElement>('[data-motion-item]'))
    for (const item of observedItems) {
      if (!items.has(item)) {
        resize?.unobserve(item)
        observedItems.delete(item)
      }
    }
    for (const item of items) {
      if (observedItems.has(item)) continue
      resize?.observe(item)
      observedItems.add(item)
    }
  }
  function measure(): void {
    frame = 0
    const container = root.value
    if (!container || disposed) return
    // 标签标题、前置项目宽度变化也会移动选中项，不能只观察容器大小。
    observeItems(container)
    const target = [...container.querySelectorAll<HTMLElement>('[data-motion-item]')].find(
      (element) => element.dataset.motionItem === selected.value,
    )
    if (!target || !target.getClientRects().length) {
      style.value.opacity = '0'
      return
    }
    const bounds = container.getBoundingClientRect()
    const item = target.getBoundingClientRect()
    style.value = {
      opacity: '1',
      width: `${item.width}px`,
      height: `${item.height}px`,
      transform: `translate3d(${item.left - bounds.left + container.scrollLeft - container.clientLeft}px,${item.top - bounds.top + container.scrollTop - container.clientTop}px,0)`,
    }
    if (!ready.value)
      frame = requestAnimationFrame(() => {
        frame = 0
        ready.value = true
        refresh()
      })
  }
  function refresh(): void {
    if (!disposed && !frame) frame = requestAnimationFrame(measure)
  }
  function observe(): void {
    resize?.disconnect()
    changes?.disconnect()
    observedItems.clear()
    const container = root.value
    if (!container) return
    resize?.observe(container)
    changes?.observe(container, { childList: true, characterData: true, subtree: true })
    refresh()
  }
  watch(selected, async () => {
    await nextTick()
    refresh()
  })
  watch(root, observe, { flush: 'post' })
  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') resize = new ResizeObserver(refresh)
    changes = new MutationObserver(refresh)
    observe()
    window.addEventListener('resize', refresh)
  })
  onUnmounted(() => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    resize?.disconnect()
    observedItems.clear()
    changes?.disconnect()
    window.removeEventListener('resize', refresh)
  })
  return { style, ready, refresh }
}
