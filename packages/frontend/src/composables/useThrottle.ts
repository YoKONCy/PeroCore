/**
 * useThrottleFn / useDebounceFn — 节流与防抖
 *
 */

/**
 * 节流函数
 *
 * @param fn - 需要节流的函数
 * @param delay - 节流间隔 (ms)
 */
export function useThrottleFn<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number,
): (...args: TArgs) => void {
  let lastTime = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: TArgs) => {
    const now = Date.now()
    const remaining = delay - (now - lastTime)

    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      lastTime = now
      fn(...args)
    } else if (!timer) {
      // 尾部触发：确保最后一次调用不丢失
      timer = setTimeout(() => {
        lastTime = Date.now()
        timer = null
        fn(...args)
      }, remaining)
    }
  }
}

/**
 * 防抖函数
 *
 * @param fn - 需要防抖的函数
 * @param delay - 防抖延迟 (ms)
 */
export function useDebounceFn<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  delay: number,
): (...args: TArgs) => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  return (...args: TArgs) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delay)
  }
}
