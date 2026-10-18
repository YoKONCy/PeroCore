export type StNode =
  | { kind: 'text'; text: string }
  | { kind: 'macro'; body: string; scoped?: string; otherwise?: string; preserve: boolean }
type Token =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'macro'; body: string; start: number; end: number }

export function splitStArguments(body: string): {
  name: string
  args: string[]
  preserve: boolean
} {
  const preserve = /^\s*#/.test(body)
  body = body.replace(/^\s*#\s*/, '')
  body = body.replace(/^\s*\/\s+(?=[a-zA-Z])/, '/')
  if (body.trimStart().startsWith('//'))
    return { name: body.trim() === '///' ? '///' : '//', args: [], preserve }
  let depth = 0,
    start = 0
  const parts: string[] = []
  for (let index = 0; index < body.length - 1; index++) {
    if (body.startsWith('{{', index)) {
      depth++
      index++
    } else if (body.startsWith('}}', index)) {
      depth--
      index++
    } else if (!depth && body.startsWith('::', index)) {
      parts.push(body.slice(start, index))
      start = index + 2
      index++
    }
  }
  if (parts.length) {
    parts.push(body.slice(start))
    return { name: parts[0]!.trim().toLowerCase(), args: parts.slice(1), preserve }
  }
  const match = /^\s*([^\s:]+)(?:\s+|:)?([\s\S]*)$/.exec(body)
  return { name: (match?.[1] ?? '').toLowerCase(), args: match?.[2] ? [match[2]] : [], preserve }
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0
  while (cursor < source.length) {
    const start = source.indexOf('{{', cursor)
    if (start < 0) {
      tokens.push({ kind: 'text', text: source.slice(cursor), start: cursor, end: source.length })
      break
    }
    if (start > cursor)
      tokens.push({ kind: 'text', text: source.slice(cursor, start), start: cursor, end: start })
    let depth = 1,
      end = start + 2
    while (end < source.length && depth) {
      if (source.startsWith('{{', end)) {
        depth++
        end += 2
      } else if (source.startsWith('}}', end)) {
        depth--
        end += 2
      } else end++
      if (depth > 32) throw new Error('酒馆宏嵌套超过 32 层')
    }
    if (depth) throw new Error('酒馆宏缺少结束符 }}')
    tokens.push({ kind: 'macro', body: source.slice(start + 2, end - 2), start, end })
    cursor = end
  }
  return tokens
}

const arity: Record<string, number> = {
  setvar: 2,
  setglobalvar: 2,
  addvar: 2,
  addglobalvar: 2,
  getvar: 1,
  getglobalvar: 1,
  reverse: 1,
  upper: 1,
  lower: 1,
  capitalize: 1,
  if: 1,
}
function needsScope(body: string) {
  const header = splitStArguments(body)
  return (
    header.name === 'if' ||
    header.preserve ||
    (header.name === '//' && body.trim() === '//') ||
    (Object.hasOwn(arity, header.name) && header.args.length < arity[header.name]!)
  )
}
function scopedText(text: string, preserve: boolean) {
  if (preserve) return text
  const lines = text
    .replace(/^\s*\r?\n/, '')
    .replace(/\s+$/, '')
    .split('\n')
  const indent = /^[\t ]*/.exec(lines.find((line) => line.trim()) ?? '')![0]
  return lines
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join('\n')
    .trim()
}

/** 块结构只解析模板原文；被替换的数据永远不作为新的源码扫描。 */
export function parseStTemplate(source: string): StNode[] {
  const tokens = tokenize(source),
    result: StNode[] = []
  const closingNames = new Set(
    tokens.flatMap((token) =>
      token.kind === 'macro' && token.body.trim().startsWith('/')
        ? [splitStArguments(token.body).name]
        : [],
    ),
  )
  let scans = 0
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (token.kind === 'text') {
      result.push({
        kind: 'text',
        text: token.text.replace(/\\\{\\\{/g, '{{').replace(/\\\}\\\}/g, '}}'),
      })
      continue
    }
    const header = splitStArguments(token.body)
    if (header.name === 'else' || (header.name.startsWith('/') && header.name !== '//'))
      throw new Error(`酒馆宏存在未配对的 ${header.name}`)
    // 已给足参数的同名宏视为内联调用，避免把块内 setvar 等调用误当成新的块。
    let nesting = 1,
      close = -1,
      otherwise = -1
    for (let next = index + 1; next < tokens.length; next++) {
      if (!closingNames.has(header.name === '//' ? '///' : `/${header.name}`)) break
      if (++scans > 1_000_000) throw new Error('酒馆块结构过于复杂，请拆分条目')
      const candidate = tokens[next]!
      if (candidate.kind !== 'macro') continue
      const nested = splitStArguments(candidate.body)
      if (nested.name === '//' && candidate.body.trim() === '//') {
        let commentDepth = 1,
          commentEnd = next + 1
        for (; commentEnd < tokens.length; commentEnd++) {
          const part = tokens[commentEnd]!
          if (part.kind !== 'macro') continue
          const comment = splitStArguments(part.body)
          if (comment.name === '//' && part.body.trim() === '//') commentDepth++
          else if (comment.name === '///' && --commentDepth === 0) break
        }
        if (commentDepth) throw new Error('酒馆注释缺少 /// 结束块')
        next = commentEnd
        continue
      }
      if (nested.name === header.name && needsScope(candidate.body)) nesting++
      else if (nested.name === (header.name === '//' ? '///' : `/${header.name}`)) {
        if (--nesting === 0) {
          close = next
          break
        }
      } else if (header.name === 'if' && nested.name === 'else' && nesting === 1) {
        if (otherwise >= 0) throw new Error('同一条件块只能包含一个 else')
        otherwise = next
      }
    }
    if (close >= 0) {
      const closing = tokens[close]!
      result.push({
        kind: 'macro',
        body: token.body,
        preserve: header.preserve,
        scoped: scopedText(
          source.slice(token.end, otherwise >= 0 ? tokens[otherwise]!.start : closing.start),
          header.preserve,
        ),
        otherwise:
          otherwise >= 0
            ? scopedText(source.slice(tokens[otherwise]!.end, closing.start), header.preserve)
            : undefined,
      })
      index = close
    } else {
      if (
        header.name === 'if' ||
        header.preserve ||
        (header.name === '//' && token.body.trim() === '//')
      )
        throw new Error(`酒馆宏缺少 ${header.name === '//' ? '///' : `/${header.name}`} 结束块`)
      result.push({ kind: 'macro', body: token.body, preserve: header.preserve })
    }
  }
  return result
}

export function stShorthand(body: string) {
  const match =
    /^\s*([.$])([a-zA-Z](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?)(?:\s*(\?\?=|\|\|=|\+\+|--|\+=|-=|==|!=|>=|<=|\?\?|\|\||=|>|<)\s*([\s\S]*))?\s*$/.exec(
      body,
    )
  if (!match) return undefined
  return {
    global: match[1] === '$',
    name: match[2]!,
    operator: match[3] ?? '',
    value: match[4] ?? '',
  }
}
