/**
 * NIT Stream Filter — 流式过滤器
 *
 * 从 SSE 流中实时拦截 <nit> 脚本块：
 * 1. 在流式推送时隐藏 <nit>...</nit> 内容（用户不可见）
 * 2. 收集完整 NIT 脚本块供后续执行
 * 3. 正常文本透传
 *
 * 替代 v1 的 NITStreamFilter + ThinkingBlockStreamFilter。
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
          // 还没看到结尾 → 收集到 currentScript，清空 buffer
          this.currentScript += this.buffer
          this.buffer = ''
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
 * 隐藏 LLM 输出中的 【Thinking/Monologue】块。
 */
export class ThinkingStreamFilter {
  private buffer = ''
  private inBlock = false
  private currentCloser = ''

  /** 开始模式: 【Thinking or [Thinking or (Thinking */
  private readonly startPatterns = [
    '【Thinking',
    '[Thinking',
    '(Thinking',
    '【Monologue',
    '[Monologue',
    '(Monologue',
  ]
  private readonly closerMap: Record<string, string> = { '【': '】', '[': ']', '(': ')' }

  filter(chunk: string): string {
    this.buffer += chunk
    let output = ''

    while (this.buffer.length > 0) {
      if (!this.inBlock) {
        // 查找任何开始标记
        let foundIdx = -1
        let opener = ''
        for (const pattern of this.startPatterns) {
          const idx = this.buffer.indexOf(pattern)
          if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
            foundIdx = idx
            opener = pattern[0]!
          }
        }

        if (foundIdx === -1) {
          // 保留末尾以防截断
          const safeLen = this.buffer.length - 15
          if (safeLen > 0) {
            output += this.buffer.slice(0, safeLen)
            this.buffer = this.buffer.slice(safeLen)
          }
          return output
        }

        output += this.buffer.slice(0, foundIdx)
        this.buffer = this.buffer.slice(foundIdx)
        this.inBlock = true
        this.currentCloser = this.closerMap[opener] ?? '】'
      } else {
        const closerIdx = this.buffer.indexOf(this.currentCloser)
        if (closerIdx !== -1) {
          this.buffer = this.buffer.slice(closerIdx + this.currentCloser.length)
          this.inBlock = false
          this.currentCloser = ''
        } else {
          return output
        }
      }
    }

    return output
  }

  flush(): string {
    const result = this.inBlock ? '' : this.buffer
    this.buffer = ''
    return result
  }
}
