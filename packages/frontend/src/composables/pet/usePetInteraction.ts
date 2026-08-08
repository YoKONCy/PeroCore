/**
 * 桌宠交互处理 Composable
 *
 * 管理交互相关功能:
 * - 点击角色响应 (onPet)
 * - 鼠标悬停管理
 *
 * @module packages/frontend/src/composables/pet/usePetInteraction
 */

import type { Ref } from 'vue'
import type BedrockAvatar from '../../components/avatar/BedrockAvatar.vue'
import type { PetEvent } from '../avatar'

/** 交互系统初始化参数 */
interface UsePetInteractionOptions {
  /** BedrockAvatar 组件引用 */
  avatarRef: Ref<InstanceType<typeof BedrockAvatar> | null>
  /** showBubble 函数 */
  showBubble: (text: string, duration?: number) => void
  /** 获取点击台词 */
  getClickText: (partType: string) => string
  /** 重置空闲计时器 */
  startIdleTimer: () => void
  /** 穿透管理 */
  onInteractableEnter: () => void
  onInteractableLeave: () => void
}

export function usePetInteraction(opts: UsePetInteractionOptions) {
  const { showBubble, getClickText, startIdleTimer, onInteractableEnter, onInteractableLeave } =
    opts

  /** 点击角色响应 */
  function onPet(event: PetEvent) {
    startIdleTimer()
    const text = getClickText(event.type)
    showBubble(text, 4000)
  }

  /** 鼠标进入角色 → 关闭穿透 */
  function onHoverStart() {
    onInteractableEnter()
  }

  /** 鼠标离开角色 → 恢复穿透 */
  function onHoverEnd() {
    onInteractableLeave()
  }

  return {
    onPet,
    onHoverStart,
    onHoverEnd,
  }
}
