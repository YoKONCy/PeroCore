/**
 * 宠物对话气泡 Composable (v1 完整还原)
 *
 * 管理对话气泡的显示、自动消失、展开/收缩和内容更新。
 * 还原 v1 全部气泡功能:
 * - bubbleKey 强制重渲染 (快速连续点击)
 * - 展开/收缩 + overflow 检测
 * - 随机位置偏移 (bubbleTop/bubbleLeft)
 * - 根据文字长度计算持续时间
 *
 * @module packages/frontend/src/composables/pet/usePetBubble
 */

import { ref, computed, nextTick, onUnmounted } from 'vue'

export function usePetBubble() {
  /** 当前气泡文本 */
  const bubbleText = ref('')
  /** 气泡是否可见 */
  const isBubbleVisible = ref(false)
  /** 气泡 key (强制重渲染用) */
  const bubbleKey = ref(0)
  /** 气泡是否展开 */
  const isBubbleExpanded = ref(false)
  /** 气泡内容是否溢出 (需要展开按钮) */
  const isBubbleOverflow = ref(false)
  /** 随机偏移 X (px) */
  const bubbleOffsetX = ref(0)
  /** 随机偏移 Y (px) */
  const bubbleOffsetY = ref(0)
  /** 气泡内容区 DOM 引用 (外部绑定 ref) */
  const bubbleContentRef = ref<HTMLElement | null>(null)

  /** 自动隐藏定时器 */
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 根据文字长度计算显示持续时间 (v1 还原)
   * 短文本 5s，长文本 最多 30s
   */
  function calcDuration(text: string): number {
    const len = text.length
    if (len < 20) return 5000
    if (len < 60) return 8000
    if (len < 150) return 15000
    if (len < 400) return 20000
    return 30000
  }

  /**
   * 生成随机偏移 (v1 还原: ±20px)
   */
  function randomOffset() {
    bubbleOffsetX.value = Math.floor(Math.random() * 40 - 20)
    bubbleOffsetY.value = Math.floor(Math.random() * 20 - 10)
  }

  /**
   * 检测内容是否溢出 (需要展开按钮)
   *
   * 由于 pet-bubble-content 平时 overflow-y: hidden，scrollHeight 会被裁剪到
   * 等于 clientHeight，导致永远检测不到溢出。所以测量时需要临时解除限制。
   */
  async function checkOverflow() {
    await nextTick()
    // 等一小段时间确保 DOM 尺寸计算完毕
    await new Promise((r) => setTimeout(r, 50))
    const el = bubbleContentRef.value
    if (el) {
      // 临时解除限制，测量内容真实高度
      const prevOverflow = el.style.overflowY
      const prevMaxHeight = el.style.maxHeight
      el.style.overflowY = 'visible'
      el.style.maxHeight = 'none'
      const naturalHeight = el.scrollHeight
      el.style.overflowY = prevOverflow
      el.style.maxHeight = prevMaxHeight

      isBubbleOverflow.value = naturalHeight > 120
    } else {
      isBubbleOverflow.value = false
    }
  }

  /**
   * 显示气泡
   *
   * @param text - 要显示的文本
   * @param duration - 持续时间（毫秒），0=永不自动隐藏，undefined=自动计算
   */
  function showBubble(text: string, duration?: number): void {
    const isUpdatingVisibleBubble =
      isBubbleVisible.value && bubbleText.value.length > 0 && text.startsWith(bubbleText.value)

    // 清除上一个定时器
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }

    if (!isUpdatingVisibleBubble) {
      bubbleKey.value++
      isBubbleExpanded.value = false
      randomOffset()
    }

    bubbleText.value = text
    isBubbleVisible.value = true

    // 检测溢出
    checkOverflow()

    // 计算持续时间
    const finalDuration = duration ?? calcDuration(text)
    if (finalDuration > 0) {
      hideTimer = setTimeout(() => {
        isBubbleVisible.value = false
        hideTimer = null
      }, finalDuration)
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

  /** 切换展开/收缩 */
  function toggleExpand(): void {
    isBubbleExpanded.value = !isBubbleExpanded.value
    // 展开后重新检测溢出
    if (!isBubbleExpanded.value) {
      checkOverflow()
    }
  }

  /** 气泡容器样式 (含随机偏移) */
  const bubbleStyle = computed(() => ({
    left: `calc(50% + ${bubbleOffsetX.value}px)`,
    top: `calc(15% + ${bubbleOffsetY.value}px)`,
  }))

  onUnmounted(() => {
    if (hideTimer) clearTimeout(hideTimer)
  })

  return {
    bubbleText,
    isBubbleVisible,
    bubbleKey,
    isBubbleExpanded,
    isBubbleOverflow,
    bubbleOffsetX,
    bubbleOffsetY,
    bubbleContentRef,
    bubbleStyle,
    showBubble,
    hideBubble,
    toggleExpand,
  }
}
