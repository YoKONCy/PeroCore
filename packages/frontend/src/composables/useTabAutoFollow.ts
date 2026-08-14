/**
 * useTabAutoFollow — Tab 内容流「智能跟随滚动 + 新动态提醒」
 *
 * 统一任务中心 (B5 决策) 的基础工具，目标是可无痛替换 ChatContainer 中
 * useChatScroll 的跟随逻辑，并供未来 TaskTimeline 复用。
 *
 * 核心行为：
 * 1. 监听容器 scroll：上滚超过阈值 → 取消跟随；回到阈值内 → 恢复跟随并清零未读。
 * 2. notifyNewContent()：跟随中 → 平滑吸底；未跟随 → 标记 hasNewContent。
 * 3. pauseFollowing / resumeFollowing：Tab 切换离开/回来时显式控制。
 * 4. ResizeObserver：容器尺寸变化（如图片异步加载撑开）时，跟随状态下保持贴底。
 * 5. 卸载时清理 scroll 监听器、防抖 timer 与 ResizeObserver。
 */

import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { Ref } from 'vue'

export interface UseTabAutoFollowOptions {
  /** 容器元素的 ref，必须是可滚动元素 */
  containerRef: Ref<HTMLElement | null>
  /** 距离底部多少像素内视为"已跟随"，默认 80 */
  followThreshold?: number
  /** 内容变化防抖毫秒数，默认 50 */
  debounceMs?: number
  /** 初始化时是否自动滚到底部，默认 true */
  initialScrollToBottom?: boolean
}

export interface UseTabAutoFollowReturn {
  /** 当前是否处于"已跟随"状态（用于决定新内容到达时是否自动滚动） */
  isFollowing: Ref<boolean>
  /** 是否有未读新动态（用于展示"新动态 ↓"浮动按钮） */
  hasNewContent: Ref<boolean>
  /** 手动滚动到底部，并复位 hasNewContent */
  scrollToBottom: (smooth?: boolean) => void
  /** 通知 hook "有新内容到达"，触发自动滚动或标记未读 */
  notifyNewContent: () => void
  /** 暂停自动跟随（用户上翻触发 / Tab 切换离开时调用） */
  pauseFollowing: () => void
  /** 恢复自动跟随 */
  resumeFollowing: () => void
}

export function useTabAutoFollow(options: UseTabAutoFollowOptions): UseTabAutoFollowReturn {
  const {
    containerRef,
    followThreshold = 80,
    debounceMs = 50,
    initialScrollToBottom = true,
  } = options

  /** 是否处于跟随状态 */
  const isFollowing = ref(true)
  /** 是否有未读新动态 */
  const hasNewContent = ref(false)
  /** 是否被显式暂停（Tab 切走、用户上翻锁定等），暂停期间 scroll 事件不改变跟随状态 */
  const paused = ref(false)

  /** 当前已绑定的容器元素 */
  let boundEl: HTMLElement | null = null
  /** 滚动检查防抖 timer */
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** 尺寸观察器，用于图片异步加载等撑开场景下保持贴底 */
  let resizeObserver: ResizeObserver | null = null

  /** 计算容器当前距底部的像素距离 */
  function distanceToBottom(el: HTMLElement): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight
  }

  /** 滚动到底部 */
  function scrollToBottom(smooth = true) {
    const el = containerRef.value
    if (!el) return
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    })
    isFollowing.value = true
    hasNewContent.value = false
  }

  /** 通知有新内容到达：跟随中则吸底，未跟随则标记未读 */
  function notifyNewContent() {
    if (isFollowing.value && !paused.value) {
      // 等待 DOM 更新完成后再滚动，确保 scrollHeight 已包含新内容
      void nextTick(() => scrollToBottom(true))
    } else {
      hasNewContent.value = true
    }
  }

  /** 根据当前滚动位置重算跟随状态 */
  function checkFollowState() {
    const el = containerRef.value
    if (!el) return
    const following = distanceToBottom(el) <= followThreshold
    isFollowing.value = following
    if (following) {
      // 回到阈值内：视为已读，清除未读标记
      hasNewContent.value = false
    }
  }

  /** scroll 事件入口：防抖后重算状态；暂停期间忽略用户滚动反馈 */
  function onScroll() {
    if (paused.value) return
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      checkFollowState()
    }, debounceMs)
  }

  /** 容器尺寸变化时，跟随状态下保持贴底（用 instant 避免抖动） */
  function onContainerResize() {
    if (isFollowing.value && !paused.value) {
      scrollToBottom(false)
    }
  }

  /** 暂停自动跟随 */
  function pauseFollowing() {
    paused.value = true
    isFollowing.value = false
  }

  /** 恢复自动跟随：立即按当前位置重算状态 */
  function resumeFollowing() {
    paused.value = false
    checkFollowState()
  }

  /** 绑定容器：scroll 监听 + ResizeObserver */
  function bind(el: HTMLElement) {
    el.addEventListener('scroll', onScroll, { passive: true })
    boundEl = el
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(onContainerResize)
      resizeObserver.observe(el)
    }
  }

  /** 解绑容器并清理所有资源 */
  function unbind() {
    if (boundEl) {
      boundEl.removeEventListener('scroll', onScroll)
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  // containerRef 可能延迟挂载或整体替换，watch 保证重新绑定
  watch(
    () => containerRef.value,
    (el, oldEl) => {
      if (oldEl) {
        oldEl.removeEventListener('scroll', onScroll)
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
      if (el) {
        bind(el)
      }
    },
  )

  onMounted(() => {
    const el = containerRef.value
    if (el && el !== boundEl) {
      bind(el)
    }
    if (initialScrollToBottom) {
      scrollToBottom(false)
    }
  })

  onUnmounted(() => {
    unbind()
  })

  return {
    isFollowing,
    hasNewContent,
    scrollToBottom,
    notifyNewContent,
    pauseFollowing,
    resumeFollowing,
  }
}
