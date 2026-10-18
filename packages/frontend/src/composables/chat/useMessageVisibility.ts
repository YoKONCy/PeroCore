/**
 * useMessageVisibility — IntersectionObserver 不可见消息暂停
 *
 * 替代虚拟滚动的轻量方案：
 * - 不可见消息的动画、视频、Canvas 全部暂停
 * - 通知文本组件暂停解析，不固化或伪造消息高度
 * - 恢复时自动 resume
 *
 */

import {
  inject,
  ref,
  shallowRef,
  watch,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
} from 'vue'
import type { Ref } from 'vue'

/**
 * 自动暂停不可见消息的动画和媒体资源
 *
 * @param chatContainer - 聊天容器 Ref (作为 IntersectionObserver 的 root)
 */
export function useMessageVisibility(
  chatContainer: Ref<HTMLElement | null>,
  onVisibilityChange?: (element: HTMLElement, visible: boolean) => void,
) {
  const observer = ref<IntersectionObserver | null>(null)
  const visibility = new WeakMap<HTMLElement, boolean>()
  const elements = new Set<HTMLElement>()
  const pausedAnimations = new WeakMap<HTMLElement, Animation[]>()
  const mainVisible = inject('infos:main-surface-visible', shallowRef(true))
  let activated = true
  let observerGeneration = 0

  function setVisible(el: HTMLElement, visible: boolean): void {
    if (visibility.get(el) === visible) return
    visibility.set(el, visible)
    if (visible) {
      resumeMessage(el)
    } else {
      pauseMessage(el)
    }
    onVisibilityChange?.(el, visible)
  }

  function createObserver() {
    if (
      observer.value ||
      !chatContainer.value ||
      !activated ||
      !mainVisible.value ||
      document.hidden
    )
      return

    const generation = ++observerGeneration
    observer.value = new IntersectionObserver(
      (entries) => {
        if (
          generation !== observerGeneration ||
          !activated ||
          !mainVisible.value ||
          document.hidden
        )
          return
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          if (elements.has(el)) setVisible(el, entry.isIntersecting)
        }
      },
      {
        root: chatContainer.value,
        // 提前 200px 开始预加载
        rootMargin: '200px 0px',
        threshold: 0,
      },
    )
    for (const element of elements) observer.value.observe(element)
  }

  function destroyObserver() {
    observerGeneration++
    observer.value?.disconnect()
    observer.value = null
    for (const element of elements) setVisible(element, false)
  }

  // ── 暂停策略 ──

  function pauseMessage(el: HTMLElement) {
    el.classList.add('msg-paused')

    // 暂停 Web Animations API 动画
    try {
      const animations = el
        .getAnimations({ subtree: true })
        .filter((a) => a.playState === 'running')
      for (const animation of animations) animation.pause()
      pausedAnimations.set(el, animations)
    } catch {
      // getAnimations 不支持时静默
    }

    // 暂停视频/音频
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
      if (!m.paused) {
        m.dataset.wasPlaying = 'true'
        m.pause()
      }
    })

    // 不再固化消息高度。聊天内容可能因流式 Markdown、公式字体和折叠面板持续变高，
    // contain-intrinsic-size 会让短消息在恢复可见后保留过大的历史占位。
  }

  function resumeMessage(el: HTMLElement) {
    el.classList.remove('msg-paused')
    // 消息内容可能在不可见期间因流式渲染、公式字体加载而改变高度；
    // 恢复时必须清除旧固化尺寸，避免浏览器继续保留异常的大块占位。
    el.style.removeProperty('contain-intrinsic-size')

    // 恢复 Web Animations
    try {
      for (const animation of pausedAnimations.get(el) ?? [])
        if (animation.playState === 'paused') animation.play()
      pausedAnimations.delete(el)
    } catch {
      // 静默
    }

    // 恢复视频/音频
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
      if (m.dataset.wasPlaying === 'true') {
        void m.play().catch(() => {})
        delete m.dataset.wasPlaying
      }
    })
  }

  // ── 公开 API ──

  /** 开始观察一个消息元素 */
  function observe(messageEl: Element | null | undefined) {
    if (!(messageEl instanceof HTMLElement)) return
    elements.add(messageEl)
    if (!observer.value) createObserver()
    observer.value?.observe(messageEl)
    if (!observer.value) setVisible(messageEl, false)
  }

  /** 停止观察 */
  function unobserve(messageEl: Element | null | undefined) {
    if (!(messageEl instanceof HTMLElement)) return
    observer.value?.unobserve(messageEl)
    elements.delete(messageEl)
    visibility.delete(messageEl)
  }

  // ── 生命周期 ──
  onMounted(createObserver)
  const syncVisibility = () => {
    if (activated && mainVisible.value && !document.hidden) createObserver()
    else destroyObserver()
  }
  watch(mainVisible, syncVisibility)
  onActivated(() => {
    activated = true
    syncVisibility()
  })
  onDeactivated(() => {
    activated = false
    destroyObserver()
  })
  onMounted(() => document.addEventListener('visibilitychange', syncVisibility))
  onUnmounted(() => {
    document.removeEventListener('visibilitychange', syncVisibility)
    observer.value?.disconnect()
    elements.clear()
  })

  return { observe, unobserve }
}
