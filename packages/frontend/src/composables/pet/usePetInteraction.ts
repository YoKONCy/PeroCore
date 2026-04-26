/**
 * 桌宠交互处理 Composable
 *
 * 管理交互相关功能:
 * - 点击角色响应 (onPet)
 * - 鼠标悬停管理
 * - 面板模式动作按钮 (摸头/投喂/跳舞/思考)
 *
 * @module packages/frontend/src/composables/pet/usePetInteraction
 */

import type { Ref } from 'vue'
import type BedrockAvatar from '../../components/avatar/BedrockAvatar.vue'
import type { PetEvent } from '../avatar'
import type { PetAction } from './usePetState'

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
  /** usePetState 的 pat/feed/setAction */
  pat: () => void
  feed: () => void
  setAction: (action: PetAction) => void
  /** 穿透管理 */
  onInteractableEnter: () => void
  onInteractableLeave: () => void
}

export function usePetInteraction(opts: UsePetInteractionOptions) {
  const {
    avatarRef,
    showBubble,
    getClickText,
    startIdleTimer,
    pat,
    feed,
    setAction,
    onInteractableEnter,
    onInteractableLeave,
  } = opts

  /** 点击角色响应 */
  function onPet(event: PetEvent) {
    pat()
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

  // ═══ 面板模式动作按钮 ═══
  function handlePat() {
    pat()
    showBubble('嘿嘿，摸摸好舒服喵~ ☺️', 4000)
  }

  function handleFeed() {
    feed()
    showBubble('谢谢主人！能量充满了！✨', 4000)
  }

  function handleDance() {
    setAction('dance')
    avatarRef.value?.playAnimation('dance')
    showBubble('来跳个舞吧！💃', 3000)
    setTimeout(() => {
      setAction('idle')
      avatarRef.value?.resetAnimation()
    }, 3000)
  }

  function handleThink() {
    setAction('think')
    showBubble('让我想想... 🤔', 3000)
    setTimeout(() => setAction('idle'), 3000)
  }

  return {
    onPet,
    onHoverStart,
    onHoverEnd,
    handlePat,
    handleFeed,
    handleDance,
    handleThink,
  }
}
