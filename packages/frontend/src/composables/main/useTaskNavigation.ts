import { shallowRef } from 'vue'

/** 任务页异步挂载后仍能接续桌宠发来的详情跳转。 */
const pending = shallowRef<{ taskId: string; revision: number } | null>(null)
export function useTaskNavigation() {
  return pending
}
