import { nextTick, onBeforeUnmount, onMounted, watch, type Ref, type WatchSource } from 'vue'

/** 遵循应用动效偏好，并允许用户显式覆盖系统设置。 */
export function allowsMotion(): boolean {
  const preference = document.documentElement.dataset.motion
  return (
    preference !== 'reduced' &&
    (preference === 'full' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}

type ReadingPosition = { top: number; nodeId?: string; offset?: number }

/** 记录可见段落相对视口的位置，排版改变后仍回到同一段。 */
export function captureReadingPosition(scroll?: HTMLElement | null): ReadingPosition {
  const position: ReadingPosition = { top: scroll?.scrollTop ?? 0 }
  const viewport = scroll?.getBoundingClientRect()
  if (!scroll || !viewport?.height) return position
  for (const element of scroll.querySelectorAll<HTMLElement>('.office-editable, figure')) {
    const bounds = element.getBoundingClientRect()
    if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
    const node = element.closest<HTMLElement>('[data-node-id]')
    if (!node?.dataset.nodeId) continue
    position.nodeId = node.dataset.nodeId
    position.offset = node.getBoundingClientRect().top - viewport.top
    break
  }
  return position
}

export function restoreReadingPosition(
  scroll: HTMLElement | null | undefined,
  position: ReadingPosition,
) {
  if (!scroll) return
  scroll.scrollTop = position.top
  if (!position.nodeId || position.offset === undefined) return
  const node = scroll.querySelector<HTMLElement>(
    '[data-node-id="' + CSS.escape(position.nodeId) + '"]',
  )
  const viewport = scroll.getBoundingClientRect()
  if (node && viewport.height)
    scroll.scrollTop += node.getBoundingClientRect().top - viewport.top - position.offset
}

/** 指示线独立移动，不重建按钮，保留键盘焦点。 */
export function useSelectionIndicator(
  root: Ref<HTMLElement | undefined>,
  selected: WatchSource<unknown>,
) {
  let observer: ResizeObserver | undefined
  let disposed = false
  function measure() {
    const element = root.value
    if (!element) return
    const active = element.querySelector<HTMLElement>(':scope > button.active')
    element.style.setProperty('--indicator-left', (active?.offsetLeft ?? 0) + 'px')
    element.style.setProperty('--indicator-width', (active?.offsetWidth ?? 0) + 'px')
    element.style.setProperty(
      '--indicator-top',
      (active ? active.offsetTop + active.offsetHeight - 2 : 0) + 'px',
    )
  }
  watch(
    selected,
    async () => {
      await nextTick()
      if (!disposed) measure()
    },
    { flush: 'post' },
  )
  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (root.value) observer.observe(root.value)
    measure()
  })
  onBeforeUnmount(() => {
    disposed = true
    observer?.disconnect()
  })
}

/** 布局只计算一次，随后仅平移纸页，避免在动效中反复重排正文。 */
export function usePaperMotion(
  root: Ref<HTMLElement | undefined>,
  layout: WatchSource<unknown>,
  beforeMove?: () => void,
) {
  let animation: Animation | undefined
  let sequence = 0
  let disposed = false
  const paper = () => root.value?.querySelector<HTMLElement>('.office-page-frame')
  watch(
    layout,
    async () => {
      const current = ++sequence
      const element = paper()
      const before = element?.getBoundingClientRect()
      const scroll = root.value?.querySelector<HTMLElement>('.office-scroll')
      const readingPosition = captureReadingPosition(scroll)
      beforeMove?.()
      animation?.cancel()
      animation = undefined
      await nextTick()
      if (
        disposed ||
        current !== sequence ||
        !element ||
        element !== paper() ||
        !before?.width ||
        !element.getClientRects().length
      )
        return
      restoreReadingPosition(scroll, readingPosition)
      if (!allowsMotion()) return
      const after = element.getBoundingClientRect()
      const zoom = Number.parseFloat(getComputedStyle(element).getPropertyValue('zoom')) || 1
      const distance = (before.left - after.left) / zoom
      if (Math.abs(distance) < 1) return
      animation = element.animate(
        [{ transform: 'translateX(' + distance + 'px)' }, { transform: 'translateX(0)' }],
        { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1)' },
      )
    },
    { flush: 'pre' },
  )
  onBeforeUnmount(() => {
    disposed = true
    sequence++
    animation?.cancel()
  })
}

/** 仅在提交成功后，让当前可见的已接受段落短暂收束。 */
export function useReviewMotion(root: Ref<HTMLElement | undefined>) {
  const animations = new Set<Animation>()
  const clear = () => {
    for (const animation of animations) animation.cancel()
    animations.clear()
  }
  onBeforeUnmount(clear)
  return (nodeIds: readonly string[]) => {
    clear()
    if (!allowsMotion()) return
    const scroll = root.value?.querySelector('.office-scroll')
    const viewport = scroll?.getBoundingClientRect()
    if (!scroll || !viewport?.height) return
    for (const id of new Set(nodeIds)) {
      const node = scroll.querySelector<HTMLElement>('[data-node-id="' + CSS.escape(id) + '"]')
      if (!node) continue
      const bounds = node.getBoundingClientRect()
      if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue
      const animation = node.animate(
        [
          { backgroundColor: 'var(--arca-success-soft)' },
          { backgroundColor: getComputedStyle(node).backgroundColor },
        ],
        { duration: 650, easing: 'cubic-bezier(.2,.75,.25,1)' },
      )
      animations.add(animation)
      animation.onfinish = animation.oncancel = () => {
        animations.delete(animation)
      }
      if (animations.size >= 20) break
    }
  }
}

/** 退出中的浮层立即退出交互，重新进入时恢复。 */
export function activateSurface(element: Element) {
  if (element instanceof HTMLElement) element.inert = false
}
export function retireSurface(element: Element) {
  if (element instanceof HTMLElement) element.inert = true
}
