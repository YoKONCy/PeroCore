/**
 * useMessageVisibility — IntersectionObserver 不可见消息暂停
 *
 * 替代虚拟滚动的轻量方案：
 * - 不可见消息的动画、视频、Canvas 全部暂停
 * - 配合 CSS content-visibility: auto 优化布局开销
 * - 恢复时自动 resume
 *
 * @see 12_FRONTEND_PERFORMANCE.md §3.3
 */

import { ref, onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import type { Ref } from 'vue'

/**
 * 自动暂停不可见消息的动画和媒体资源
 *
 * @param chatContainer - 聊天容器 Ref (作为 IntersectionObserver 的 root)
 */
export function useMessageVisibility(chatContainer: Ref<HTMLElement | null>) {
  const observer = ref<IntersectionObserver | null>(null)
  const pausedMessages = new WeakSet<HTMLElement>()

  function createObserver() {
    if (!chatContainer.value) return

    observer.value = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          if (entry.isIntersecting) {
            resumeMessage(el)
            pausedMessages.delete(el)
          } else {
            pauseMessage(el)
            pausedMessages.add(el)
          }
        }
      },
      {
        root: chatContainer.value,
        // 提前 200px 开始预加载
        rootMargin: '200px 0px',
        threshold: 0,
      },
    )
  }

  function destroyObserver() {
    observer.value?.disconnect()
    observer.value = null
  }

  // ── 暂停策略 ──

  function pauseMessage(el: HTMLElement) {
    el.classList.add('msg-paused')

    // 暂停 Web Animations API 动画
    try {
      el.getAnimations({ subtree: true }).forEach((a) => {
        if (a.playState === 'running') a.pause()
      })
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

    // 固化高度供 content-visibility 使用
    el.style.containIntrinsicSize = `auto ${el.offsetHeight}px`
  }

  function resumeMessage(el: HTMLElement) {
    el.classList.remove('msg-paused')

    // 恢复 Web Animations
    try {
      el.getAnimations({ subtree: true }).forEach((a) => {
        if (a.playState === 'paused') a.play()
      })
    } catch {
      // 静默
    }

    // 恢复视频/音频
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => {
      if (m.dataset.wasPlaying === 'true') {
        void m.play()
        delete m.dataset.wasPlaying
      }
    })
  }

  // ── 公开 API ──

  /** 开始观察一个消息元素 */
  function observe(messageEl: HTMLElement) {
    observer.value?.observe(messageEl)
  }

  /** 停止观察 */
  function unobserve(messageEl: HTMLElement) {
    observer.value?.unobserve(messageEl)
    pausedMessages.delete(messageEl)
  }

  // ── 生命周期 ──
  onMounted(createObserver)
  onActivated(createObserver)
  onUnmounted(destroyObserver)
  onDeactivated(destroyObserver)

  return { observe, unobserve }
}
