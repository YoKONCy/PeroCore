/** 提取正文任意位置的独立口语块，保留 Markdown 代码示例；支持任意流式分片。 */
export class SpokenReplyFilter {
  private buffer = ''
  private inSpeech = false
  private collected = ''
  private overflow = false
  private inlineTicks = 0
  private fence: { char: string; size: number } | null = null
  private linePrefix: string | null = ''
  private indentedCode = false
  private leading = ''
  private hasBody = false
  value = ''

  filter(chunk: string): string {
    this.buffer += chunk
    return this.process(false)
  }

  flush(): string {
    const output = this.process(true)
    // 未闭合的口语块不当作正文，也不朗读不完整片段。
    this.buffer = ''
    this.inSpeech = false
    this.collected = ''
    return output
  }

  private process(final: boolean): string {
    let cursor = 0
    let output = ''
    const emit = (text: string) => {
      if (!this.hasBody && /^\s+$/.test(text)) this.leading += text
      else {
        output += this.leading + text
        this.leading = ''
        this.hasBody = true
      }
      for (const character of text) {
        if (character === '\n') {
          this.linePrefix = ''
          this.indentedCode = false
        } else if (this.linePrefix !== null) {
          if (
            character !== ' ' &&
            character !== '\t' &&
            (this.linePrefix.length >= 4 || this.linePrefix.includes('\t'))
          )
            this.indentedCode = true
          this.linePrefix =
            character === ' ' || character === '\t'
              ? (this.linePrefix + character).slice(0, 4)
              : null
        }
      }
    }
    while (cursor < this.buffer.length) {
      const rest = this.buffer.slice(cursor)
      if (this.inSpeech) {
        const closing = /^<\/spoken_reply\s*>/i.exec(rest)
        if (closing) {
          if (!this.value && !this.overflow) this.value = validSpokenReply(this.collected)
          this.inSpeech = false
          this.collected = ''
          cursor += closing[0].length
          continue
        }
        if (!final && this.buffer[cursor] === '<' && this.pendingTag(rest, true)) break
        this.collect(this.buffer[cursor]!)
        cursor++
        continue
      }

      const character = this.buffer[cursor]!
      const indentedCode =
        this.indentedCode ||
        (this.linePrefix !== null &&
          (this.linePrefix.length >= 4 || this.linePrefix.includes('\t')))
      // 反斜线转义后的标签是用户可见文字，不属于控制协议。
      if (!this.fence && !this.inlineTicks && character === '\\') {
        if (cursor + 1 === this.buffer.length && !final) break
        const escaped = this.buffer.slice(cursor, cursor + 2)
        emit(escaped)
        cursor += escaped.length
        continue
      }
      if (!indentedCode && (character === '`' || character === '~')) {
        let end = cursor + 1
        while (this.buffer[end] === character) end++
        if (end === this.buffer.length && !final) break
        const size = end - cursor
        const fencePosition = this.linePrefix !== null && /^ {0,3}$/.test(this.linePrefix)
        if (this.fence) {
          if (
            fencePosition &&
            character === this.fence.char &&
            size >= this.fence.size &&
            (end === this.buffer.length || /\s/.test(this.buffer[end]!))
          )
            this.fence = null
        } else if (this.inlineTicks) {
          if (character === '`' && size === this.inlineTicks) this.inlineTicks = 0
        } else if (fencePosition && size >= 3) {
          this.fence = { char: character, size }
        } else if (character === '`') this.inlineTicks = size
        emit(this.buffer.slice(cursor, end))
        cursor = end
        continue
      }
      if (!this.fence && !this.inlineTicks && !indentedCode && character === '<') {
        const opening = /^<spoken_reply\s*>/i.exec(rest)
        const closing = /^<\/spoken_reply\s*>/i.exec(rest)
        if (opening) {
          this.inSpeech = true
          this.collected = ''
          this.overflow = false
          if (!this.hasBody) {
            this.leading = ''
            this.linePrefix = ''
            this.indentedCode = false
          }
          cursor += opening[0].length
          continue
        }
        if (closing) {
          cursor += closing[0].length
          continue
        }
        if (!final && this.pendingTag(rest)) break
        if (final && /^<\/?spoken_reply\s*$/i.test(rest)) {
          cursor = this.buffer.length
          continue
        }
      }
      emit(character)
      cursor++
    }
    this.buffer = this.buffer.slice(cursor)
    if (final && !this.inSpeech) {
      output += this.leading
      this.leading = ''
    }
    return output
  }

  private pendingTag(text: string, closingOnly = false): boolean {
    const lower = text.length <= '</spoken_reply>'.length ? text.toLowerCase() : null
    return (
      (lower !== null && '</spoken_reply>'.startsWith(lower)) ||
      /^<\/spoken_reply\s*$/i.test(text) ||
      (!closingOnly &&
        ((lower !== null && '<spoken_reply>'.startsWith(lower)) ||
          /^<spoken_reply\s*$/i.test(text)))
    )
  }

  private collect(text: string): void {
    if (this.collected.length + text.length > 240) this.overflow = true
    if (!this.overflow) this.collected += text
  }
}

export function validSpokenReply(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  return text.length > 0 && text.length <= 240 ? text : ''
}

/** 流式、工具交付和历史读模型共用解析语义，不修改原始审计转写。 */
export function splitSpokenReply(source: string): { content: string; spokenReply: string } {
  const filter = new SpokenReplyFilter()
  const content = filter.filter(source) + filter.flush()
  return { content, spokenReply: filter.value }
}
