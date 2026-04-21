/**
 * useEventListener — 自动管理事件监听生命周期
 *
 * 兼容 keep-alive：
 * - onMounted / onActivated → addEventListener
 * - onUnmounted / onDeactivated → removeEventListener
 *
 */

import { onMounted, onUnmounted, onActivated, onDeactivated, unref, watch } from 'vue'
import type { Ref } from 'vue'

type MaybeRef<T> = T | Ref<T>

/**
 * 自动绑定/解绑事件监听器
 *
 * @param target - 事件目标 (支持 Ref)
 * @param event - 事件名
 * @param handler - 回调函数
 * @param options - addEventListener 选项
 */
export function useEventListener(
  target: MaybeRef<EventTarget | null | undefined>,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
): void {
  const add = () => {
    const el = unref(target)
    el?.addEventListener(event, handler, options)
  }
  const remove = () => {
    const el = unref(target)
    el?.removeEventListener(event, handler, options)
  }

  // 普通生命周期
  onMounted(add)
  onUnmounted(remove)

  // keep-alive 生命周期
  onActivated(add)
  onDeactivated(remove)

  // 如果 target 是 Ref，监听变化自动重绑
  if (typeof target === 'object' && target !== null && 'value' in target) {
    watch(target as Ref<EventTarget | null | undefined>, (_newVal, oldVal) => {
      if (oldVal) {
        ;(oldVal as EventTarget).removeEventListener(event, handler, options)
      }
      add()
    })
  }
}
