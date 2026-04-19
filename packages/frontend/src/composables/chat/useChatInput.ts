/**
 * useChatInput — 聊天输入框逻辑
 *
 * 功能：
 * 1. Enter 发送 / Shift+Enter 换行
 * 2. 输入框自动高度 (autoResize)
 * 3. 输入防抖
 * 4. 发送后清空
 */

import { ref, nextTick } from 'vue'
import type { Ref } from 'vue'

export interface UseChatInputOptions {
  /** 发送回调 */
  onSend: (text: string) => void | Promise<void>
  /** 最大高度 (px) */
  maxHeight?: number
  /** 最小行数 */
  minRows?: number
}

export function useChatInput(
  textareaRef: Ref<HTMLTextAreaElement | null>,
  options: UseChatInputOptions,
) {
  const { onSend, maxHeight = 200, minRows = 1 } = options
  const inputText = ref('')
  const isSending = ref(false)

  /** 键盘事件处理 */
  function onKeydown(e: KeyboardEvent) {
    // Enter → 发送; Shift+Enter → 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  /** 发送消息 */
  async function send() {
    const text = inputText.value.trim()
    if (!text || isSending.value) return

    isSending.value = true
    try {
      await onSend(text)
      inputText.value = ''
      // 重置高度
      await nextTick()
      autoResize()
    } finally {
      isSending.value = false
    }
  }

  /** 自适应高度 */
  function autoResize() {
    const el = textareaRef.value
    if (!el) return

    // 重置高度以获取 scrollHeight
    el.style.height = 'auto'
    const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20
    const minHeight = lineHeight * minRows
    const newHeight = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)
    el.style.height = `${newHeight}px`
  }

  /** 聚焦输入框 */
  function focus() {
    textareaRef.value?.focus()
  }

  return {
    inputText,
    isSending,
    onKeydown,
    send,
    autoResize,
    focus,
  }
}
