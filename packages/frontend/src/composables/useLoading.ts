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
export function useLoading<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
) {
  const isLoading = ref(false)
  const error = ref<Error | null>(null)

  const execute = async (...args: TArgs): Promise<TResult | undefined> => {
    isLoading.value = true
    error.value = null
    try {
      return await fn(...args)
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      return undefined
    } finally {
      isLoading.value = false
    }
  }

  return { execute, isLoading, error }
}
