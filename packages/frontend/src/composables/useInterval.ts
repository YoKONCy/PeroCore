/**
 * useInterval — 自动管理 setInterval 生命周期
 *
 * 兼容 keep-alive：
 * - onMounted / onActivated → start
 * - onUnmounted / onDeactivated → stop
 *
 * @see 12_FRONTEND_PERFORMANCE.md §3.7
 */

import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'

export interface UseIntervalOptions {
  /** 是否立即执行一次回调 */
  immediate?: boolean
}

/**
 * 自动管理 setInterval
 *
 * @param callback - 定时回调
 * @param interval - 间隔毫秒数
 * @param options - 配置
 * @returns start / stop 手动控制方法
 */
export function useInterval(callback: () => void, interval: number, options?: UseIntervalOptions) {
  let timer: ReturnType<typeof setInterval> | null = null

  const start = () => {
    stop()
    if (options?.immediate) callback()
    timer = setInterval(callback, interval)
  }

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  onMounted(start)
  onActivated(start)
  onUnmounted(stop)
  onDeactivated(stop)

  return { start, stop }
}
