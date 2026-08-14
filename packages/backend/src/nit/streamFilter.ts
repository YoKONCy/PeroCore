/**
 * NIT Stream Filter — 流式过滤器
 *
 * 从 SSE 流中实时拦截 <nit> 脚本块：
 * 1. 在流式推送时隐藏 <nit>...</nit> 内容（用户不可见）
 * 2. 收集完整 NIT 脚本块供后续执行
 * 3. 正常文本透传
 *
 * 统一 NIT 流式过滤与 Thinking 块过滤。
 *
 * @module packages/backend/src/nit/streamFilter
 */

/** NIT 流式过滤器 */
export class NitStreamFilter {
  /** 内部缓冲区 */
  private buffer = ''
  /** 是否在 <nit> 块内 */
  private inNitBlock = false
  /** 收集到的 NIT 脚本块 */
  private collectedScripts: string[] = []
  /** 当前块的内容 */
  private currentScript = ''

  /** 开始标签 */
  private readonly START_TAG = '<nit>'
  /** 结束标签 */
  private readonly END_TAG = '</nit>'

  /**
   * 处理流式文本块
   *
   * @returns 应该发送给用户的安全文本 (NIT 块被过滤)
   */
  filter(chunk: string): string {
    this.buffer += chunk
    let output = ''

    while (this.buffer.length > 0) {
      if (!this.inNitBlock) {
        // 查找 <nit> 开始
        const startIdx = this.buffer.indexOf(this.START_TAG)

        if (startIdx === -1) {
          // 没有开始标签 → 输出安全部分 (保留末尾以防截断)
          const safeLen = this.buffer.length - this.START_TAG.length
          if (safeLen > 0) {
            output += this.buffer.slice(0, safeLen)
            this.buffer = this.buffer.slice(safeLen)
          }
          return output
        }

        // 输出 <nit> 之前的文本
        output += this.buffer.slice(0, startIdx)
        // 跳过 <nit> 标签
        this.buffer = this.buffer.slice(startIdx + this.START_TAG.length)
        this.inNitBlock = true
        this.currentScript = ''
      } else {
        // 在 NIT 块内，查找 </nit>
        const endIdx = this.buffer.indexOf(this.END_TAG)

        if (endIdx === -1) {
          const keepLen = this.END_TAG.length - 1
          if (this.buffer.length > keepLen) {
            this.currentScript += this.buffer.slice(0, this.buffer.length - keepLen)
            this.buffer = this.buffer.slice(this.buffer.length - keepLen)
          }
          return output
        }

        // 收集完整脚本
        this.currentScript += this.buffer.slice(0, endIdx)
        this.collectedScripts.push(this.currentScript.trim())
        this.currentScript = ''

        // 跳过 </nit>
        this.buffer = this.buffer.slice(endIdx + this.END_TAG.length)
        this.inNitBlock = false
      }
    }

    return output
  }

  /** 刷新缓冲区 (流结束时调用) */
  flush(): string {
    let result = ''
    if (!this.inNitBlock) {
      result = this.buffer
    } else {
      // 未闭合的 NIT 块，丢弃
      this.currentScript += this.buffer
      if (this.currentScript.trim()) {
        this.collectedScripts.push(this.currentScript.trim())
      }
    }
    this.buffer = ''
    this.currentScript = ''
    return result
  }

  /** 获取收集到的所有 NIT 脚本 */
  getCollectedScripts(): string[] {
    return this.collectedScripts
  }

  /** 是否有收集到的脚本 */
  hasScripts(): boolean {
    return this.collectedScripts.length > 0
  }

  /** 重置 */
  reset(): void {
    this.buffer = ''
    this.inNitBlock = false
    this.collectedScripts = []
    this.currentScript = ''
  }
}

/**
 * Thinking 块流式过滤器
 *
 * 隐藏 LLM 输出中的 `<think>...</think>` 块。
 *
 * 流式处理要点：
 * - `<think>` 开始标签可能在 chunk 中间被截断，用"保留末尾"策略防止误判
 * - 进入块内后丢弃所有内容，直到找到 `</think>`
 * - 未闭合的块（流结束仍未遇到 `</think>`）整体丢弃（flush 处理）
 */
export class ThinkingStreamFilter {
  private buffer = ''
  private inBlock = false

  /** 开始标签（匹配 <think，兼容大小写与可能的属性/空格） */
  private readonly START_TAG = '<think'
  /** 结束标签（匹配 </think>，兼容大小写） */
  private readonly END_TAG = '</think>'

  filter(chunk: string): string {
    this.buffer += chunk
    let output = ''

    while (this.buffer.length > 0) {
      if (!this.inBlock) {
        // 查找开始标签（大小写不敏感）
        const startIdx = this.buffer.toLowerCase().indexOf(this.START_TAG)

        if (startIdx === -1) {
          // 没有开始标签 → 输出安全部分（保留末尾以防 <think 被截断）
          const safeLen = this.buffer.length - this.START_TAG.length
          if (safeLen > 0) {
            output += this.buffer.slice(0, safeLen)
            this.buffer = this.buffer.slice(safeLen)
          }
          return output
        }

        // 输出开始标签之前的文本
        output += this.buffer.slice(0, startIdx)
        // 跳过开始标签（含 <think 后的内容，直到 >；若 > 尚未到达则仍视作块内）
        this.buffer = this.buffer.slice(startIdx)
        this.inBlock = true
      } else {
        // 块内：查找 </think>（大小写不敏感）
        const endIdx = this.buffer.toLowerCase().indexOf(this.END_TAG)
        if (endIdx !== -1) {
          // 丢弃 </think> 及其之前的所有块内容，从 </think> 之后继续
          this.buffer = this.buffer.slice(endIdx + this.END_TAG.length)
          this.inBlock = false
        } else {
          // 块内还没遇到结束标签 → 不输出任何内容，等待更多 chunk
          return output
        }
      }
    }

    return output
  }

  flush(): string {
    // 块未闭合 → 丢弃块内残留；不在块内 → 输出剩余缓冲区
    const result = this.inBlock ? '' : this.buffer
    this.buffer = ''
    this.inBlock = false
    return result
  }
}
