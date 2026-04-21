/**
 * 宠物对话气泡 Composable
 *
 * 管理对话气泡的显示、自动消失和内容更新。
 * 支持气泡队列和优先级覆盖。
 *
 * @module packages/frontend/src/composables/pet/usePetBubble
 */

import { ref } from 'vue'

export function usePetBubble() {
  /** 当前气泡文本 */
  const bubbleText = ref('')
  /** 气泡是否可见 */
  const isBubbleVisible = ref(false)

  /** 自动隐藏定时器 */
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 显示气泡
   *
   * @param text - 要显示的文本
   * @param duration - 持续时间（毫秒），0 表示永不自动隐藏
   */
  function showBubble(text: string, duration: number = 4000): void {
    // 清除上一个定时器
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    bubbleText.value = text
    isBubbleVisible.value = true

    if (duration > 0) {
      hideTimer = setTimeout(() => {
        isBubbleVisible.value = false
        hideTimer = null
      }, duration)
    }
  }

  /** 立即隐藏气泡 */
  function hideBubble(): void {
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
    isBubbleVisible.value = false
  }

  return {
    bubbleText,
    isBubbleVisible,
    showBubble,
    hideBubble,
  }
}
