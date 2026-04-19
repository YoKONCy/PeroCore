/**
 * useLoading — 异步操作加载状态管理
 *
 * 包装 async 函数，自动管理 isLoading / error 状态。
 */

import { ref } from 'vue'

/**
 * @param fn - 异步函数
 * @returns { execute, isLoading, error }
 */
export function useLoading<T extends (...args: never[]) => Promise<unknown>>(fn: T) {
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  const execute = async (...args: Parameters<T>): Promise<ReturnType<T> | undefined> => {
    isLoading.value = true
    error.value = null
    try {
      const result = await fn(...args)
      return result as ReturnType<T>
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      return undefined
    } finally {
      isLoading.value = false
    }
  }

  return { execute, isLoading, error }
}
