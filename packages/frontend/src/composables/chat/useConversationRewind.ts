import { ref } from 'vue'
import { chatApi, type RewindPreview, type RewindResult } from '../../api/modules/chatApi'

export interface RewindRequest {
  threadId: string
  messageId?: number
  wholeThread?: boolean
  title?: string
  onSuccess?: (result: RewindResult) => void | Promise<void>
}

/**
 * 全局一致的对话 rewind 控制器。
 * 各页面只提供目标与成功回调，统一执行预检、确认和回滚。
 */
export function useConversationRewind() {
  const visible = ref(false)
  const loading = ref(false)
  const preview = ref<RewindPreview | null>(null)
  const request = ref<RewindRequest | null>(null)

  async function open(next: RewindRequest): Promise<void> {
    loading.value = true
    request.value = next
    try {
      const response = await chatApi.previewRewind(next.threadId, {
        messageId: next.messageId,
        wholeThread: next.wholeThread,
      })
      if (!response.data) throw new Error('回滚预检未返回数据')
      preview.value = response.data
      visible.value = true
    } finally {
      loading.value = false
    }
  }

  async function confirm(): Promise<RewindResult | null> {
    const current = request.value
    if (!current || loading.value) return null
    loading.value = true
    try {
      const response = await chatApi.rewind(current.threadId, {
        messageId: current.messageId,
        wholeThread: current.wholeThread,
      })
      if (!response.data) throw new Error('回滚未返回结果')
      await current.onSuccess?.(response.data)
      visible.value = false
      preview.value = null
      request.value = null
      return response.data
    } finally {
      loading.value = false
    }
  }

  return { visible, loading, preview, request, open, confirm }
}
