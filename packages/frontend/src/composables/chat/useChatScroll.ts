/**
 * useChatScroll — 聊天滚动管理
 *
 * 功能：
 * 1. 自动判断是否在底部 (isAtBottom)
 * 2. scrollToBottom 平滑滚动
 * 3. 流式生成时自动吸底
 * 4. 滚动事件 100ms 节流
 *
 * @see 12_FRONTEND_PERFORMANCE.md §2.6
 */

import { ref, watch, nextTick } from 'vue'
import type { Ref } from 'vue'
import { useEventListener } from '../useEventListener'
import { useThrottleFn } from '../useThrottle'

/** 底部判定阈值 (px) */
const BOTTOM_THRESHOLD = 50

/**
 * @param containerRef - 可滚动容器
 * @param messageCount - 消息数量 (Ref), 用于监听变化自动滚动
 */
export function useChatScroll(
  containerRef: Ref<HTMLElement | null>,
  messageCount?: Ref<number>,
) {
  /** 是否在底部 */
  const isAtBottom = ref(true)
  /** 是否显示"回到底部"按钮 */
  const showScrollDown = ref(false)

  /** 检测是否在底部 */
  function checkBottom() {
    const el = containerRef.value
    if (!el) return

    const { scrollTop, scrollHeight, clientHeight } = el
    const bottom = scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD
    isAtBottom.value = bottom
    showScrollDown.value = !bottom
  }

  /** 滚动事件处理 (100ms 节流) */
  const onScroll = useThrottleFn(checkBottom, 100)

  /** 滚动到底部 */
  function scrollToBottom(smooth = true) {
    const el = containerRef.value
    if (!el) return

    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    })
    isAtBottom.value = true
    showScrollDown.value = false
  }

  // 绑定滚动事件
  useEventListener(containerRef, 'scroll', onScroll, { passive: true })

  // 消息数变化 → 如果在底部则自动吸底
  if (messageCount) {
    watch(messageCount, async () => {
      if (isAtBottom.value) {
        await nextTick()
        scrollToBottom(false)
      }
    })
  }

  return {
    isAtBottom,
    showScrollDown,
    scrollToBottom,
    checkBottom,
  }
}
