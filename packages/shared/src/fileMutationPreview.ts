export interface FileWritePreviewBaseline {
  path: string
  status: 'ready' | 'new' | 'unavailable'
  content?: string
  hash?: string
  /** 经会话归属和版本校验的引用片段，供流式编辑预览使用。 */
  selections?: Record<string, string>
}

/** 读取尚未闭合的顶层 JSON 字符串；不把字符串里的引号或嵌套字段误认为参数。 */
export function parseStreamingToolArguments(
  raw: string,
  nestingLevel = 0,
): {
  values: Record<string, unknown>
  completeFields: Set<string>
  stepCompleteFields?: Array<Set<string>>
} {
  const values: Record<string, unknown> = Object.create(null)
  const completeFields = new Set<string>()
  const stepCompleteFields: Array<Set<string>> = []
  if (nestingLevel > 4) return { values, completeFields }
  let cursor = 0
  const whitespace = () => {
    while (cursor < raw.length && /\s/.test(raw[cursor]!)) cursor++
  }
  const string = (): { value: string; complete: boolean } => {
    cursor++
    let value = ''
    while (cursor < raw.length) {
      const char = raw[cursor++]!
      if (char === '"') return { value, complete: true }
      if (char !== '\\') {
        value += char
        continue
      }
      if (cursor >= raw.length) break
      const escaped = raw[cursor++]!
      if (escaped === 'u') {
        const hex = raw.slice(cursor, cursor + 4)
        if (!/^[a-f\d]{4}$/i.test(hex)) break
        value += String.fromCharCode(parseInt(hex, 16))
        cursor += 4
      } else {
        const escapes: Record<string, string> = {
          '"': '"',
          '\\': '\\',
          '/': '/',
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
        }
        if (!(escaped in escapes)) break
        value += escapes[escaped]
      }
    }
    // 代理对跨增量到达时，等低位到达后再展示完整字符。
    if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1)
    return { value, complete: false }
  }
  whitespace()
  if (raw[cursor++] !== '{') return { values, completeFields }
  while (cursor < raw.length) {
    whitespace()
    if (raw[cursor] !== '"') break
    const key = string()
    if (!key.complete) break
    whitespace()
    if (raw[cursor++] !== ':') break
    whitespace()
    if (raw[cursor] === '"') {
      const field = string()
      values[key.value] = field.value
      if (!field.complete) break
      completeFields.add(key.value)
    } else if (key.value === 'steps' && raw[cursor] === '[') {
      // 批量编辑的最后一个步骤也可能仍在生成，逐对象解析并保留字段闭合状态。
      const steps: Record<string, unknown>[] = []
      cursor++
      while (cursor < raw.length) {
        whitespace()
        if (raw[cursor] === ']') {
          cursor++
          completeFields.add(key.value)
          break
        }
        if (raw[cursor] !== '{') break
        const start = cursor
        let nesting = 0
        let quoted = false
        let escaped = false
        while (cursor < raw.length) {
          const char = raw[cursor++]!
          if (quoted) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') quoted = false
          } else if (char === '"') quoted = true
          else if (char === '{' || char === '[') nesting++
          else if (char === '}' || char === ']') {
            if (--nesting === 0) break
          }
        }
        const step = parseStreamingToolArguments(raw.slice(start, cursor), nestingLevel + 1)
        steps.push(step.values)
        stepCompleteFields.push(step.completeFields)
        if (nesting > 0 || quoted) break
        whitespace()
        if (raw[cursor] === ',') cursor++
        else if (raw[cursor] !== ']') break
      }
      values[key.value] = steps
      if (!completeFields.has(key.value)) break
    } else {
      const start = cursor
      let depth = 0
      while (cursor < raw.length) {
        const char = raw[cursor]
        if (char === '"') {
          if (!string().complete) break
          continue
        }
        if (char === '{' || char === '[') depth++
        if ((char === ',' || char === '}') && depth === 0) break
        if (char === '}' || char === ']') depth--
        cursor++
      }
      if (cursor >= raw.length) break
      try {
        values[key.value] = JSON.parse(raw.slice(start, cursor))
      } catch {
        break
      }
      completeFields.add(key.value)
    }
    whitespace()
    if (raw[cursor++] !== ',') break
  }
  return { values, completeFields, ...(stepCompleteFields.length ? { stepCompleteFields } : {}) }
}
