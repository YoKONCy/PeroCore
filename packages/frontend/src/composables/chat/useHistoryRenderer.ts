/**
 * useHistoryRenderer — 分批渲染历史消息
 *
 * 策略 (borrowed from VCPChat)：
 * 1. 先渲染最新 N 条 → 用户立刻看到最近内容
 * 2. requestIdleCallback 分批插入旧消息
 * 3. 每批间隔 80ms 避免卡顿
 *
 * @see 12_FRONTEND_PERFORMANCE.md §3.4
 */

import { ref, nextTick } from 'vue'

export interface HistoryRendererOptions {
  /** 首批渲染数量 (最新 N 条) */
  initialBatch?: number
  /** 后续每批数量 */
  batchSize?: number
  /** 批次间隔 (ms) */
  batchDelay?: number
}

const DEFAULT_OPTIONS: Required<HistoryRendererOptions> = {
  initialBatch: 5,
  batchSize: 10,
  batchDelay: 80,
}

/**
 * 分批渲染聊天历史
 */
export function useHistoryRenderer<T>() {
  /** 当前已渲染的消息列表 */
  const rendered = ref<T[]>([]) as { value: T[] }
  /** 是否正在加载中 */
  const isLoadingHistory = ref(false)
  /** 加载进度 (0~1) */
  const progress = ref(0)

  /**
   * 分批渲染消息列表
   *
   * @param messages - 完整消息列表 (时间正序)
   * @param options - 配置
   */
  async function renderHistory(
    messages: T[],
    options?: HistoryRendererOptions,
  ) {
    const { initialBatch, batchSize, batchDelay } = {
      ...DEFAULT_OPTIONS,
      ...options,
    }

    isLoadingHistory.value = true
    progress.value = 0

    // 少量消息直接渲染
    if (messages.length <= initialBatch) {
      rendered.value = [...messages]
      progress.value = 1
      isLoadingHistory.value = false
      return
    }

    // 阶段 1：立即渲染最新 N 条
    const latest = messages.slice(-initialBatch)
    rendered.value = [...latest]
    await nextTick()

    // 阶段 2：分批渲染历史
    const older = messages.slice(0, -initialBatch)
    const totalBatches = Math.ceil(older.length / batchSize)
    let batchIdx = 0

    for (let i = older.length; i > 0; i -= batchSize) {
      const batch = older.slice(Math.max(0, i - batchSize), i)
      await idleInsertBatch(batch, batchDelay)
      batchIdx++
      progress.value = batchIdx / totalBatches
    }

    progress.value = 1
    isLoadingHistory.value = false
  }

  /**
   * 使用 requestIdleCallback 插入一批消息到头部
   */
  function idleInsertBatch(batch: T[], delay: number): Promise<void> {
    return new Promise((resolve) => {
      const insert = () => {
        // 插入到头部 (旧消息在前)
        rendered.value = [...batch, ...rendered.value]
        setTimeout(resolve, delay)
      }

      if ('requestIdleCallback' in window) {
        requestIdleCallback(insert, { timeout: 1000 })
      } else {
        requestAnimationFrame(insert)
      }
    })
  }

  /** 清空渲染列表 */
  function clear() {
    rendered.value = []
    progress.value = 0
    isLoadingHistory.value = false
  }

  return {
    rendered,
    isLoadingHistory,
    progress,
    renderHistory,
    clear,
  }
}
