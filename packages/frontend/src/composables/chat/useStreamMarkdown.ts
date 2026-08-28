/**
 * useStreamMarkdown — SSE 流式 Markdown 增量渲染
 *
 * 核心策略：稳定区/尾部区分段
 * - stableHtml：已闭合的结构（代码块等），渲染一次后不再变化
 * - tailHtml：正在追加的尾部，每帧更新
 *
 * 配合 30fps 帧率限制，避免每个 SSE delta 都触发完整重渲。
 *
 */

import { ref } from 'vue'
import { useThrottleFn } from '../useThrottle'

/** 帧率限制：~30fps */
const FRAME_INTERVAL = 33

/**
 * 流式 Markdown 增量渲染 composable
 *
 * @param renderFn - Markdown → HTML 渲染函数 (由调用方注入，避免硬依赖 marked)
 */
export function useStreamMarkdown(renderFn: (md: string) => string) {
  /** 已闭合结构的 HTML (不再变化) */
  const stableHtml = ref('')
  /** 正在追加的尾部 HTML (每帧更新) */
  const tailHtml = ref('')
  /** 完整原始文本缓冲 */
  let fullText = ''
  /** 稳定前缀的字符偏移 */
  let stableCutoff = 0

  /**
   * 接收新的 SSE chunk (内部实现，throttle 包装前)
   */
  function processChunk(text: string) {
    fullText = text

    // 1. 查找已闭合的结构边界
    const newCutoff = findStablePrefix(fullText, stableCutoff)

    // 2. 稳定区仅在边界推进时更新
    if (newCutoff > stableCutoff) {
      stableHtml.value = renderFn(fullText.slice(0, newCutoff))
      stableCutoff = newCutoff
    }

    // 3. 尾部每帧轻量渲染
    const tail = fullText.slice(stableCutoff)
    tailHtml.value = tail ? renderFn(applyStreamFastPipeline(tail)) : ''
  }

  /** 节流版：30fps 限流 */
  const onChunk = useThrottleFn(processChunk, FRAME_INTERVAL)

  /**
   * 追加模式：累加 delta 到 fullText
   */
  function appendDelta(delta: string) {
    fullText += delta
    onChunk(fullText)
  }

  /**
   * 完成流式渲染：最终全量渲染
   */
  function finish() {
    if (fullText) {
      stableHtml.value = renderFn(fullText)
      tailHtml.value = ''
      stableCutoff = fullText.length
    }
  }

  /**
   * 重置状态（新消息开始时调用）
   */
  function reset() {
    stableHtml.value = ''
    tailHtml.value = ''
    fullText = ''
    stableCutoff = 0
  }

  /** 获取当前完整原始文本 */
  function getRawText(): string {
    return fullText
  }

  return {
    stableHtml,
    tailHtml,
    appendDelta,
    onChunk,
    finish,
    reset,
    getRawText,
  }
}

// ─────────────────────────────────────────────
// 内部工具函数
// ─────────────────────────────────────────────

/**
 * 扫描已闭合的 Markdown 结构，返回稳定前缀的字符偏移
 *
 * 识别的结构：
 * - 代码块 (``` → ```)
 * - 工具调用块 (<<<[TOOL_REQUEST]>>> → <<<[/TOOL_REQUEST]>>>)
 * - 完整的段落（以双换行结尾）
 *
 */
function findStablePrefix(text: string, startOffset: number): number {
  let stableCutoff = startOffset
  let i = startOffset

  while (i < text.length) {
    // ── 已闭合的代码块 ──
    if (text.startsWith('```', i)) {
      const fenceEnd = findMatchingFenceEnd(text, i)
      if (fenceEnd === -1) break // 未闭合 → 停止推进
      stableCutoff = fenceEnd
      i = fenceEnd
      continue
    }

    // ── 已闭合的工具调用块 ──
    if (text.startsWith('<<<[TOOL_REQUEST]>>>', i)) {
      const endTag = '<<<[/TOOL_REQUEST]>>>'
      const closeIdx = text.indexOf(endTag, i + 20)
      if (closeIdx === -1) break // 未闭合
      const end = closeIdx + endTag.length
      stableCutoff = end
      i = end
      continue
    }

    // ── 已闭合的数学公式块 ($$..$$) ──
    if (text.startsWith('$$', i) && (i === 0 || text[i - 1] === '\n')) {
      const closeIdx = text.indexOf('$$', i + 2)
      if (closeIdx === -1) break
      const end = closeIdx + 2
      stableCutoff = end
      i = end
      continue
    }

    // ── 完整段落 (双换行) ──
    if (text.startsWith('\n\n', i)) {
      stableCutoff = i + 2
      i += 2
      continue
    }

    i++
  }

  return stableCutoff
}

/**
 * 查找匹配的代码块结束围栏
 *
 * @returns 结束围栏 ``` 之后的偏移，-1 表示未闭合
 */
function findMatchingFenceEnd(text: string, startIdx: number): number {
  // 跳过开头的 ``` 和语言标记行
  let i = startIdx + 3
  // 跳过语言标识符行
  while (i < text.length && text[i] !== '\n') i++
  i++ // 跳过换行

  // 查找闭合 ```
  while (i < text.length) {
    if (text[i] === '`' && text.startsWith('```', i)) {
      // 确认是行首的 ``` (前面是换行或字符串开头)
      if (i === 0 || text[i - 1] === '\n') {
        const end = i + 3
        // 跳到行尾
        let lineEnd = end
        while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd++
        return lineEnd < text.length ? lineEnd + 1 : lineEnd
      }
    }
    i++
  }

  return -1 // 未闭合
}

/**
 * STREAM_FAST 流水线 — 轻量幂等修正
 *
 * 仅对尾部执行最小处理，相比 FULL_RENDER 省去：
 * - 保护/恢复已闭合结构
 * - 完整的 HTML 净化
 * - 语法高亮
 *
 */
function applyStreamFastPipeline(text: string): string {
  let result = text

  // 1. 修复未闭合的行内代码 (奇数个反引号 → 追加一个)
  const backtickCount = (result.match(/`/g) || []).length
  if (backtickCount % 2 !== 0) {
    result += '`'
  }

  // 2. 修复未闭合的粗体/斜体
  const boldCount = (result.match(/\*\*/g) || []).length
  if (boldCount % 2 !== 0) {
    result += '**'
  }

  const italicSingle = result.match(/(?<!\*)\*(?!\*)/g)
  if (italicSingle && italicSingle.length % 2 !== 0) {
    result += '*'
  }

  return result
}
