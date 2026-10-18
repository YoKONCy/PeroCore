import { shallowRef } from 'vue'
import type { PetConversationTarget } from '@infos/shared'

/** 主窗口收到导航时保存请求，异步加载或缓存中的对话页均可接续。 */
const pending = shallowRef<{
  target: PetConversationTarget
  revision: number
  draft?: string
} | null>(null)
export function useConversationNavigation() {
  return pending
}
