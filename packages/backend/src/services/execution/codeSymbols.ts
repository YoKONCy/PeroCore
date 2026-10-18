import path from 'node:path'
import type * as TypeScript from 'typescript'

export interface CodeSymbol {
  name: string
  kind: string
  lineStart: number
  lineEnd: number
  start: number
  end: number
  /** 只定位声明位置，不代表完整符号的可替换范围。 */
  locationOnly?: boolean
}

/** 屏蔽字符串与注释，保留 UTF-16 偏移和换行；不加载或执行任何外部运行时。 */
function maskPythonLiterals(text: string, signal?: AbortSignal): string {
  const masked = text.split('')
  let quote = '',
    triple = false
  for (let index = 0; index < text.length; index++) {
    if (index % 1024 === 0) signal?.throwIfAborted()
    const char = text[index]!
    if (quote) {
      if (char === '\\') {
        masked[index] = ' '
        const next = text[index + 1]
        if (next !== undefined) {
          index++
          if (next !== '\r' && next !== '\n') masked[index] = ' '
          else if (next === '\r' && text[index + 1] === '\n') index++
        }
      } else if (text.startsWith(quote.repeat(triple ? 3 : 1), index)) {
        const length = triple ? 3 : 1
        masked.fill(' ', index, index + length)
        index += length - 1
        quote = ''
      } else if (char === '\r' || char === '\n') {
        if (!triple) throw new Error('Python 字符串不完整，已回退源码读取')
      } else masked[index] = ' '
    } else if (char === '#') {
      while (index < text.length && text[index] !== '\r' && text[index] !== '\n')
        masked[index++] = ' '
      index--
    } else if (char === '"' || char === "'") {
      // 格式字符串允许嵌套表达式和重用引号，轻量扫描不猜测其语法边界。
      const prefix = /(?:^|[^\p{ID_Continue}])([rubft]{1,3})$/iu.exec(
        text.slice(Math.max(0, index - 5), index),
      )?.[1]
      if (prefix && /[ft]/i.test(prefix))
        throw new Error('Python 格式字符串采用保守处理，已回退源码读取')
      quote = char
      triple = text.startsWith(char.repeat(3), index)
      const length = triple ? 3 : 1
      masked.fill(' ', index, index + length)
      index += length - 1
    }
  }
  if (quote) throw new Error('Python 字符串不完整，已回退源码读取')
  return masked.join('')
}

/** 只提供 Python 声明位置；完整正文通过普通版本化读取取得，不推断可替换的函数体。 */
function pythonSymbols(text: string, signal?: AbortSignal): CodeSymbol[] {
  const masked = maskPythonLiterals(text, signal)
  const items: CodeSymbol[] = []
  const scopes: Array<{ indent: number; name: string }> = []
  const brackets: string[] = []
  const opening = '([{',
    closing = ')]}'
  let offset = 0,
    continued = false,
    lineNumber = 0
  for (const line of masked.split('\n')) {
    signal?.throwIfAborted()
    lineNumber++
    const code = line.trim()
    if (code && !brackets.length && !continued) {
      const prefix = /^[ \t]*/.exec(line)![0]
      if (prefix.includes(' ') && prefix.includes('\t'))
        throw new Error('Python 混合缩进采用保守处理，已回退源码读取')
      let indent = 0
      for (const char of prefix) indent = char === '\t' ? indent + 8 - (indent % 8) : indent + 1
      while (scopes.length && indent <= scopes[scopes.length - 1]!.indent) scopes.pop()
      const declaration =
        /^(?:async[ \t]+)?(def|class)[ \t]+([\p{ID_Start}_][\p{ID_Continue}]*)(?=[ \t]*[(:[])/u.exec(
          code,
        )
      if (declaration) {
        const parent = scopes[scopes.length - 1]?.name
        const name = parent ? `${parent}.${declaration[2]}` : declaration[2]!
        items.push({
          name,
          kind: declaration[1] === 'class' ? 'class' : 'function',
          lineStart: lineNumber,
          lineEnd: lineNumber,
          start: offset + prefix.length,
          end: offset + line.replace(/\r$/, '').length,
          locationOnly: true,
        })
        scopes.push({ indent, name })
        if (items.length > 2048) throw new Error('符号数量超过轻量定位预算，已回退源码读取')
      }
    }
    for (const char of line) {
      if (opening.includes(char)) brackets.push(char)
      else if (closing.includes(char) && brackets.pop() !== opening[closing.indexOf(char)])
        throw new Error('Python 括号不完整，已回退源码读取')
    }
    continued = code.endsWith('\\')
    offset += line.length + 1
  }
  if (brackets.length || continued) throw new Error('Python 声明不完整，已回退源码读取')
  return items
}

/** 按需解析，无全工程扫描或常驻索引进程；解析结果只作为版本化读取定位。 */
export async function codeSymbols(
  filePath: string,
  text: string,
  signal?: AbortSignal,
): Promise<CodeSymbol[]> {
  signal?.throwIfAborted()
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.py') return pythonSymbols(text, signal)
  if (!['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'].includes(extension))
    throw new Error('该语言暂不支持符号定位，请使用 read_ref 或版本化行范围编辑')
  const imported = await import('typescript')
  signal?.throwIfAborted()
  const ts = imported.default ?? imported
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
  const diagnostics = (
    source as TypeScript.SourceFile & { parseDiagnostics: readonly TypeScript.Diagnostic[] }
  ).parseDiagnostics
  if (diagnostics.length)
    throw new Error('文件存在语法错误，符号范围不可靠，请使用读取引用或行范围编辑')
  const items: CodeSymbol[] = []
  const visit = (node: TypeScript.Node, parent = ''): void => {
    let qualified = parent
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      (ts.isVariableDeclaration(node) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
    ) {
      const named = node as TypeScript.NamedDeclaration
      const name = named.name?.getText(source)
      if (name) {
        qualified = parent ? `${parent}.${name}` : name
        const target =
          ts.isVariableDeclaration(node) &&
          ts.isVariableDeclarationList(node.parent) &&
          node.parent.declarations.length === 1
            ? node.parent.parent
            : node
        items.push({
          name: qualified,
          kind: ts.SyntaxKind[node.kind],
          start: target.getStart(source),
          end: target.end,
          lineStart: source.getLineAndCharacterOfPosition(target.getStart(source)).line + 1,
          lineEnd: source.getLineAndCharacterOfPosition(target.end).line + 1,
        })
      }
    }
    ts.forEachChild(node, (child) => visit(child, qualified))
  }
  visit(source)
  return items
}
