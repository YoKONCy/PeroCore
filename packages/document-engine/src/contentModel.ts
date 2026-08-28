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
): DocumentProjection<string> & { format: 'html' } {
  const snapshot = engine.inspect(documentId)
  const children = childrenOf(snapshot.nodes, snapshot.document.rootNodeId)
  const body = children.map((node) => renderHtmlNode(node, snapshot.nodes)).join('\n')
  const html = `<!doctype html>\n<html lang="${escapeAttribute(snapshot.document.language)}"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.document.title)}</title></head><body>\n${body}\n</body></html>`
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

function renderHtmlNode(node: DocumentNode, nodes: DocumentNode[]): string {
  switch (node.type) {
    case 'heading': {
      const level = Math.max(1, Math.min(6, Number(node.attributes.level ?? 1)))
      return `<h${level}>${renderInline(node)}</h${level}>`
    }
    case 'paragraph':
      return `<p>${renderInline(node)}</p>`
    case 'quote':
      return `<blockquote>${renderInline(node)}</blockquote>`
    case 'code-block':
      return `<pre><code data-language="${escapeAttribute(String(node.attributes.language ?? ''))}">${escapeHtml(node.text ?? '')}</code></pre>`
    case 'list': {
      const tag = node.attributes.ordered === true ? 'ol' : 'ul'
      return `<${tag}>${childrenOf(nodes, node.nodeId)
        .map((item) => `<li>${escapeHtml(String(item.attributes.text ?? item.text ?? ''))}</li>`)
        .join('')}</${tag}>`
    }
    case 'table':
      return `<table><tbody>${childrenOf(nodes, node.nodeId)
        .map((row) => renderHtmlNode(row, nodes))
        .join('')}</tbody></table>`
    case 'table-row':
      return `<tr>${childrenOf(nodes, node.nodeId)
        .map((cell) => renderHtmlNode(cell, nodes))
        .join('')}</tr>`
    case 'table-cell':
      return `<td>${renderInline(node)}</td>`
    case 'citation':
      return `<cite data-source-id="${escapeAttribute(String(node.attributes.sourceId ?? ''))}">${renderInline(node)}</cite>`
    case 'programmable-island':
      return `<div data-programmable-island="blocked" data-source-hash="${escapeAttribute(String(node.attributes.sourceHash ?? ''))}"></div>`
    default:
      return node.text ? `<div>${renderInline(node)}</div>` : ''
  }
}

function renderInline(node: DocumentNode): string {
  const raw = node.attributes.inlineAst
  if (!Array.isArray(raw)) return escapeHtml(node.text ?? '')
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
