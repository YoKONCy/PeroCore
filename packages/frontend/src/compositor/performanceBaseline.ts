/**
 * performanceBaseline — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { PerformanceBaselineRegistry } from '@infos/shared'

export const frontendPerformance = new PerformanceBaselineRegistry(2048)

export function startFrontendPerformanceObserver(): () => void {
  let observer: PerformanceObserver | undefined
  const timer = setInterval(() => {
    if (!document.hidden) sampleFrontendMemory()
  }, 30_000)
  try {
    if (typeof PerformanceObserver !== 'undefined')
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          frontendPerformance.observe('main_thread_long_task_ms', entry.duration)
      })
    observer?.observe({ entryTypes: ['longtask'] })
  } catch {
    observer = undefined
  }
  const diagnostics = window as Window & {
    __INFOS_PERFORMANCE__?: () => ReturnType<PerformanceBaselineRegistry['snapshot']>
  }
  if (import.meta.env.DEV) diagnostics.__INFOS_PERFORMANCE__ = () => frontendPerformance.snapshot()
  return () => {
    clearInterval(timer)
    observer?.disconnect()
    if (import.meta.env.DEV) delete diagnostics.__INFOS_PERFORMANCE__
  }
}

export function sampleFrontendMemory(): void {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number }
    }
  ).memory
  if (memory) frontendPerformance.observe('js_heap_used_bytes', memory.usedJSHeapSize)
}
