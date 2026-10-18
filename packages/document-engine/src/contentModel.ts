import type {
  DocumentEngine,
  DocumentId,
  DocumentNode,
  DocumentProjection,
  DocumentSourcePosition,
  DocumentSourceRange,
  InlineNode,
  JsonValue,
  ProgrammableIslandDescriptor,
} from './types'
import { contentHash } from './canonical'
import { failDocument } from './errors'
import { runsOf } from './office'

export function sourcePosition(source: string, offset: number): DocumentSourcePosition {
  const safe = Math.max(0, Math.min(source.length, offset))
  const prefix = source.slice(0, safe)
  const lines = prefix.split('\n')
  return { offset: safe, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

export function sourceRange(source: string, start: number, end: number): DocumentSourceRange {
  return { start: sourcePosition(source, start), end: sourcePosition(source, end) }
}

/** 确定性Inline AST解析器；不执行HTML，不解析脚本。 */
export function parseInlineAst(source: string, baseOffset = 0, fullSource = source): InlineNode[] {
  const nodes: InlineNode[] = []
  const pattern =
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|~~[^~\n]+~~|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\[@[^\]\n]+\]| {2}\n)/g
  let cursor = 0
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor)
      nodes.push(
        textNode(source.slice(cursor, index), baseOffset + cursor, baseOffset + index, fullSource),
      )
    const raw = match[0]
    const start = baseOffset + index
    const end = start + raw.length
    const range = sourceRange(fullSource, start, end)
    if (raw.startsWith('`'))
      nodes.push({ type: 'code', value: raw.slice(1, -1), sourceRange: range })
    else if (raw.startsWith('**') || raw.startsWith('__')) {
      nodes.push({
        type: 'strong',
        children: parseInlineAst(raw.slice(2, -2), start + 2, fullSource),
        sourceRange: range,
      })
    } else if (raw.startsWith('~~')) {
      nodes.push({
        type: 'delete',
        children: parseInlineAst(raw.slice(2, -2), start + 2, fullSource),
        sourceRange: range,
      })
    } else if (raw.startsWith('*') || raw.startsWith('_')) {
      nodes.push({
        type: 'emphasis',
        children: parseInlineAst(raw.slice(1, -1), start + 1, fullSource),
        sourceRange: range,
      })
    } else if (raw.startsWith('[@')) {
      const body = raw.slice(2, -1)
      const [sourceId, locator] = body.split(',', 2).map((value) => value.trim())
      nodes.push({ type: 'citation', sourceId: sourceId!, locator, label: raw, sourceRange: range })
    } else if (raw.endsWith('\n')) nodes.push({ type: 'line-break', sourceRange: range })
    else {
      const link = raw.match(/^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/)!
      nodes.push({
        type: 'link',
        href: safeHref(link[2]!),
        ...(link[3] === undefined ? {} : { title: link[3] }),
        children: parseInlineAst(link[1]!, start + 1, fullSource),
        sourceRange: range,
      })
    }
    cursor = index + raw.length
  }
  if (cursor < source.length)
    nodes.push(
      textNode(source.slice(cursor), baseOffset + cursor, baseOffset + source.length, fullSource),
    )
  return nodes
}

export function inlineAstToJson(nodes: readonly InlineNode[]): JsonValue {
  return structuredClone(nodes) as unknown as JsonValue
}

export function createProgrammableIslandDescriptor(
  input: Omit<ProgrammableIslandDescriptor, 'network' | 'status'>,
): ProgrammableIslandDescriptor {
  if (!input.sourceBlobId.startsWith('sha256:') || !/^[a-f0-9]{64}$/i.test(input.sourceHash)) {
    failDocument('DOCUMENT_INVALID_ATTRIBUTE', '可编程岛必须引用内容寻址Blob和SHA-256摘要')
  }
  if (!input.entrypoint.trim()) failDocument('DOCUMENT_INVALID_ATTRIBUTE', '可编程岛入口不能为空')
  return Object.freeze({
    ...input,
    permissions: Object.freeze([...new Set(input.permissions)]),
    network: 'none',
    status: 'declared',
  })
}

/** 安全HTML投影；所有正文默认转义，可编程岛只输出不可执行占位描述。 */
export function projectHtml(
  engine: DocumentEngine,
  documentId: DocumentId,
  options: { resolveAsset?: (node: DocumentNode) => string | undefined } = {},
): DocumentProjection<string> & { format: 'html' } {
  const snapshot = engine.inspect(documentId)
  const children = childrenOf(snapshot.nodes, snapshot.document.rootNodeId)
  const body = children.map((node) => renderHtmlNode(node, snapshot.nodes, options)).join('\n')
  const headings: DocumentNode[] = []
  const visit = (nodes: DocumentNode[]) => {
    for (const node of nodes) {
      if (node.type === 'heading') headings.push(node)
      visit(childrenOf(snapshot.nodes, node.nodeId))
    }
  }
  visit(children)
  const settings = snapshot.nodes.find((node) => node.type === 'document-root')?.attributes ?? {}
  const paper = settings.paperSize === 'Letter' ? 'Letter' : 'A4',
    margin = Math.max(5, Math.min(50, Number(settings.pageMargin) || 20))
  const header = escapeHtml(String(settings.header ?? '')),
    footer = escapeHtml(String(settings.footer ?? ''))
  const toc =
    settings.showToc === true
      ? `<nav aria-label="文稿目录"><h2>目录</h2><ol>${headings.map((node) => `<li><a href="#node-${escapeAttribute(node.nodeId)}">${escapeHtml(node.text ?? '未命名章节')}</a></li>`).join('')}</ol></nav>`
      : ''
  const orientation = settings.paperOrientation === 'landscape' ? 'landscape' : 'portrait'
  const cssString = (value: string) =>
    '"' +
    value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('<', '\\3c ')
      .replaceAll('>', '\\3e ')
      .replaceAll('&', '\\26 ')
      .replace(/\r?\n/g, '\\A ') +
    '"'
  const pageRules = `@page{size:${paper} ${orientation};margin:${margin}mm;@top-center{content:${cssString(String(settings.header ?? ''))}}@bottom-center{content:${cssString(String(settings.footer ?? ''))}}${settings.pageNumbers === true ? '@bottom-right{content:counter(page)}' : ''}}`
  const references = Array.isArray(settings.references)
    ? settings.references.filter(
        (value): value is { [key: string]: JsonValue } =>
          !!value && typeof value === 'object' && !Array.isArray(value),
      )
    : []
  const referenceHtml = references.length
    ? `<section aria-label="参考资料与脚注"><h2>参考资料与脚注</h2><ol>${references.map((reference) => `<li id="reference-${escapeAttribute(String(reference.id))}">${escapeHtml(String(reference.title ?? ''))}${reference.url ? ` <a href="${escapeAttribute(safeHref(String(reference.url)))}">查看来源</a>` : ''}${reference.note ? `<p>${escapeHtml(String(reference.note))}</p>` : ''}</li>`).join('')}</ol></section>`
    : ''
  const html = `<!doctype html>\n<html lang="${escapeAttribute(snapshot.document.language)}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.document.title)}</title><style>${pageRules}body{font:12pt/1.7 system-ui,sans-serif;overflow-wrap:anywhere;margin:0 auto;padding:20px;max-width:794px}p,li,td,blockquote{white-space:pre-wrap}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #bbb;padding:6px;vertical-align:top}img{max-width:100%;height:auto}figure{margin:12px 0}figcaption{font-size:.85em;text-align:center}header,footer{white-space:pre-wrap;color:#555}h1,h2,h3,h4,h5,h6{break-after:avoid}figure,tr{break-inside:avoid}@media print{body{padding:0;max-width:none}header,footer{display:none}}</style></head><body><header>${header}</header>\n${toc}\n${body}\n${referenceHtml}\n<footer>${footer}</footer></body></html>`
  return {
    projectionId: `${documentId}:${snapshot.revisionId}:html`,
    documentId,
    revisionId: snapshot.revisionId,
    format: 'html',
    content: html,
    contentHash: contentHash(html),
    diagnostics: [],
    createdAt: snapshot.createdAt,
  }
}

function renderHtmlNode(
  node: DocumentNode,
  nodes: DocumentNode[],
  options: { resolveAsset?: (node: DocumentNode) => string | undefined },
): string {
  const attrs = node.attributes,
    styles: string[] = []
  if (['left', 'right', 'center', 'justify'].includes(String(attrs.align)))
    styles.push(`text-align:${attrs.align}`)
  if (typeof attrs.lineHeight === 'number')
    styles.push(`line-height:${Math.max(1, Math.min(3, attrs.lineHeight))}`)
  if (typeof attrs.indent === 'number')
    styles.push(`margin-left:${Math.max(0, Math.min(12, attrs.indent)) * 1.5}em`)
  if (attrs.pageBreakBefore === true) styles.push('break-before:page')
  if (typeof attrs.borderColor === 'string' && /^#[a-f0-9]{6}$/i.test(attrs.borderColor))
    styles.push(`border-color:${attrs.borderColor}`)
  if (attrs.borderStyle === 'none') styles.push('border-style:none')
  const style = styles.length ? ` style="${styles.join(';')}"` : ''
  switch (node.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attributes.level ?? 1)))
      return `<h${level} id="node-${escapeAttribute(node.nodeId)}"${style}>${renderInline(node)}</h${level}>`
    }
    case 'paragraph':
      return `<p${style}>${renderInline(node)}</p>`
    case 'quote':
      return `<blockquote${style}>${renderInline(node)}</blockquote>`
    case 'code-block':
      return `<pre><code data-language="${escapeAttribute(String(node.attributes.language ?? ''))}">${escapeHtml(node.text ?? '')}</code></pre>`
    case 'list': {
      const tag = node.attributes.ordered === true ? 'ol' : 'ul'
      return `<${tag}>${childrenOf(nodes, node.nodeId)
        .map(
          (item) =>
            `<li>${renderInline(item)}${childrenOf(nodes, item.nodeId)
              .map((child) => renderHtmlNode(child, nodes, options))
              .join('')}</li>`,
        )
        .join('')}</${tag}>`
    }
    case 'table': {
      const widths = Array.isArray(attrs.columnWidths)
        ? attrs.columnWidths.map((width) => Math.max(24, Math.min(1600, Number(width) || 120)))
        : []
      const total = widths.reduce((sum, width) => sum + width, 0)
      return `<table>${widths.length ? `<colgroup>${widths.map((width) => `<col style="width:${(width / total) * 100}%">`).join('')}</colgroup>` : ''}<tbody>${childrenOf(
        nodes,
        node.nodeId,
      )
        .map((row) => renderHtmlNode(row, nodes, options))
        .join('')}</tbody></table>`
    }
    case 'table-row':
      return `<tr>${childrenOf(nodes, node.nodeId)
        .map((cell) => renderHtmlNode(cell, nodes, options))
        .join('')}</tr>`
    case 'table-cell': {
      const tag = attrs.headerCell === true ? 'th' : 'td'
      return `<${tag}${style} colspan="${Math.max(1, Math.min(30, Number(attrs.colspan) || 1))}" rowspan="${Math.max(1, Math.min(100, Number(attrs.rowspan) || 1))}">${renderInline(node)}</${tag}>`
    }
    case 'section':
      return `<section${style}>${childrenOf(nodes, node.nodeId)
        .map((child) => renderHtmlNode(child, nodes, options))
        .join('')}</section>`
    case 'asset': {
      const src = options.resolveAsset?.(node)
      return `<figure${style}>${src && /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(src) ? `<img src="${src}" alt="${escapeAttribute(String(attrs.alt ?? ''))}" width="${Math.max(24, Math.min(1600, Number(attrs.width) || 480))}">` : `<p>图片资源未随本次投影提供：${escapeHtml(String(attrs.alt ?? ''))}</p>`}<figcaption>${escapeHtml(String(attrs.caption ?? ''))}</figcaption></figure>`
    }
    case 'citation':
      return `<cite data-source-id="${escapeAttribute(String(node.attributes.sourceId ?? ''))}">${renderInline(node)}</cite>`
    case 'programmable-island':
      return `<div data-programmable-island="blocked" data-source-hash="${escapeAttribute(String(node.attributes.sourceHash ?? ''))}"></div>`
    default:
      return node.text ? `<div>${renderInline(node)}</div>` : ''
  }
}

function renderInline(node: DocumentNode): string {
  if (Array.isArray(node.attributes.runs))
    return runsOf(node)
      .map((run) => {
        const marks = run.marks ?? {},
          styles: string[] = []
        if (marks.bold) styles.push('font-weight:700')
        if (marks.italic) styles.push('font-style:italic')
        if (marks.underline || marks.strike)
          styles.push(
            `text-decoration:${[marks.underline ? 'underline' : '', marks.strike ? 'line-through' : ''].filter(Boolean).join(' ')}`,
          )
        if (marks.fontFamily) styles.push(`font-family:${marks.fontFamily}`)
        if (marks.fontSize) styles.push(`font-size:${marks.fontSize}pt`)
        if (marks.color) styles.push(`color:${marks.color}`)
        if (marks.highlight) styles.push(`background-color:${marks.highlight}`)
        if (marks.code) styles.push('font-family:monospace')
        const span = `<span style="${escapeAttribute(styles.join(';'))}">${escapeHtml(run.text)}</span>`
        if (marks.citation)
          return `<a href="#reference-${escapeAttribute(marks.citation)}"><sup>${span}</sup></a>`
        return marks.link ? `<a href="${escapeAttribute(safeHref(marks.link))}">${span}</a>` : span
      })
      .join('')
  const raw = node.attributes.inlineAst
  if (!Array.isArray(raw)) return escapeHtml(node.text ?? String(node.attributes.text ?? ''))
  return renderInlineNodes(raw as unknown as InlineNode[])
}

function renderInlineNodes(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return escapeHtml(node.value)
      if (node.type === 'code') return `<code>${escapeHtml(node.value)}</code>`
      if (node.type === 'line-break') return '<br>'
      if (node.type === 'emphasis') return `<em>${renderInlineNodes(node.children)}</em>`
      if (node.type === 'strong') return `<strong>${renderInlineNodes(node.children)}</strong>`
      if (node.type === 'delete') return `<del>${renderInlineNodes(node.children)}</del>`
      if (node.type === 'citation')
        return `<cite data-source-id="${escapeAttribute(node.sourceId)}">${escapeHtml(node.label)}</cite>`
      if (node.type !== 'link') return ''
      return `<a href="${escapeAttribute(safeHref(node.href))}"${node.title ? ` title="${escapeAttribute(node.title)}"` : ''}>${renderInlineNodes(node.children)}</a>`
    })
    .join('')
}

function textNode(value: string, start: number, end: number, source: string): InlineNode {
  return { type: 'text', value, sourceRange: sourceRange(source, start, end) }
}

function safeHref(value: string): string {
  const trimmed = value.trim()
  if (/^(https?:|mailto:|#|\/)/i.test(trimmed)) return trimmed
  return '#blocked'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;')
}

function childrenOf(
  nodes: readonly DocumentNode[],
  parentId: DocumentNode['nodeId'],
): DocumentNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort(
      (left, right) =>
        left.orderKey.localeCompare(right.orderKey) ||
        String(left.nodeId).localeCompare(String(right.nodeId)),
    )
}
