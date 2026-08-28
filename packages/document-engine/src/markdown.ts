import { createHash } from 'node:crypto'
import type {
  CreateDocumentInput,
  DocumentEngine,
  DocumentId,
  DocumentNode,
  DocumentNodeId,
  DocumentOperation,
  DocumentProjection,
  JsonValue,
  OperationId,
  RevisionId,
} from './types'
import { contentHash } from './canonical'
import { inlineAstToJson, parseInlineAst, sourceRange } from './contentModel'
import { failDocument } from './errors'

export interface MarkdownImportInput extends CreateDocumentInput {
  markdown: string
  actorPrincipalId: string
  idempotencyKey: string
}

interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'quote' | 'code-block' | 'list'
  text?: string
  level?: number
  language?: string
  ordered?: boolean
  items?: Array<{ text: string; start: number; end: number }>
  start: number
  end: number
  contentStart?: number
}

export function importMarkdown(
  engine: DocumentEngine,
  input: MarkdownImportInput,
): ReturnType<DocumentEngine['inspect']> {
  const blocks = parseMarkdown(input.markdown)
  const checkpoint = engine.exportCheckpoint()
  try {
    const snapshot = engine.createDocument(input)
    if (!blocks.length) return snapshot
    const operations: DocumentOperation[] = []
    let rootGeneration = 1
    blocks.forEach((block, index) => {
      const nodeId = stableNodeId(snapshot.documentId, `block:${index}`, block.type)
      if (block.type === 'list') {
        operations.push(
          operation(
            snapshot.documentId,
            snapshot.revisionId,
            input.actorPrincipalId,
            `block:${index}`,
            {
              type: 'node.insert',
              node: {
                nodeId,
                type: 'list',
                parentId: snapshot.document.rootNodeId,
                orderKey: orderKey(index),
                attributes: {
                  ordered: block.ordered ?? false,
                  sourceRange: sourceRange(
                    input.markdown,
                    block.start,
                    block.end,
                  ) as unknown as JsonValue,
                },
              },
              parentGeneration: rootGeneration++,
            },
          ),
        )
        let listGeneration = 1
        block.items?.forEach((item, itemIndex) => {
          operations.push(
            operation(
              snapshot.documentId,
              snapshot.revisionId,
              input.actorPrincipalId,
              `block:${index}:item:${itemIndex}`,
              {
                type: 'node.insert',
                node: {
                  nodeId: stableNodeId(
                    snapshot.documentId,
                    `block:${index}:item:${itemIndex}`,
                    'list-item',
                  ),
                  type: 'list-item',
                  parentId: nodeId,
                  orderKey: orderKey(itemIndex),
                  attributes: {
                    text: item.text,
                    inlineAst: inlineAstToJson(
                      parseInlineAst(item.text, item.start, input.markdown),
                    ),
                    sourceRange: sourceRange(
                      input.markdown,
                      item.start,
                      item.end,
                    ) as unknown as JsonValue,
                  },
                },
                parentGeneration: listGeneration++,
              },
            ),
          )
        })
        return
      }
      const attributes: Record<string, JsonValue> = {
        sourceRange: sourceRange(input.markdown, block.start, block.end) as unknown as JsonValue,
      }
      if (block.level) attributes.level = block.level
      if (block.language) attributes.language = block.language
      if (block.type !== 'code-block') {
        attributes.inlineAst = inlineAstToJson(
          parseInlineAst(block.text ?? '', block.contentStart ?? block.start, input.markdown),
        )
      }
      operations.push(
        operation(
          snapshot.documentId,
          snapshot.revisionId,
          input.actorPrincipalId,
          `block:${index}`,
          {
            type: 'node.insert',
            node: {
              nodeId,
              type: block.type,
              parentId: snapshot.document.rootNodeId,
              orderKey: orderKey(index),
              text: block.text ?? '',
              attributes,
            },
            parentGeneration: rootGeneration++,
          },
        ),
      )
    })
    engine.transact({
      transactionId: `markdown-import:${snapshot.documentId}`,
      documentId: snapshot.documentId,
      actorPrincipalId: input.actorPrincipalId,
      baseRevisionId: snapshot.revisionId,
      operations,
      intent: '导入 Markdown 文档',
      idempotencyKey: input.idempotencyKey,
    })
    return engine.inspect(snapshot.documentId)
  } catch (error) {
    engine.restoreCheckpoint(checkpoint)
    throw error
  }
}

export function projectMarkdown(
  engine: DocumentEngine,
  documentId: DocumentId,
): DocumentProjection<string> & { format: 'markdown' } {
  const snapshot = engine.inspect(documentId)
  const children = childrenOf(snapshot.nodes, snapshot.document.rootNodeId)
  const rendered = children.map((node) => renderNode(node, snapshot.nodes)).join('\n\n')
  return {
    projectionId: `${documentId}:${snapshot.revisionId}:markdown`,
    documentId,
    revisionId: snapshot.revisionId,
    format: 'markdown',
    content: rendered,
    contentHash: contentHash(rendered),
    diagnostics: [],
    createdAt: snapshot.createdAt,
  }
}

function parseMarkdown(markdown: string): MarkdownBlock[] {
  if (markdown.length > 5_000_000)
    failDocument('DOCUMENT_IMPORT_LIMIT_EXCEEDED', 'Markdown 超过 5MB')
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  const blocks: MarkdownBlock[] = []
  let paragraph: Array<{ text: string; line: number }> = []
  const flushParagraph = () => {
    const text = paragraph
      .map((part) => part.text.trim())
      .join(' ')
      .trim()
    if (text) {
      const first = paragraph[0]!
      const last = paragraph.at(-1)!
      blocks.push({
        type: 'paragraph',
        text,
        start: offsets[first.line]!,
        end: offsets[last.line]! + lines[last.line]!.length,
      })
    }
    paragraph = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const lineStart = offsets[index]!
    const fence = line.match(/^```([^`]*)$/)
    if (fence) {
      flushParagraph()
      const blockStart = lineStart
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index >= lines.length) failDocument('DOCUMENT_MARKDOWN_INVALID', '代码围栏未闭合')
      blocks.push({
        type: 'code-block',
        text: body.join('\n'),
        language: fence[1]?.trim(),
        start: blockStart,
        end: offsets[index]! + lines[index]!.length,
      })
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        text: heading[2]!.trim(),
        start: lineStart,
        end: lineStart + line.length,
        contentStart: lineStart + heading[1]!.length + 1,
      })
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      blocks.push({
        type: 'quote',
        text: quote[1] ?? '',
        start: lineStart,
        end: lineStart + line.length,
        contentStart: lineStart + line.indexOf(quote[1] ?? ''),
      })
      continue
    }
    const list = line.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/)
    if (list) {
      flushParagraph()
      const ordered = Boolean(list[1])
      const items = [{ text: list[2]!.trim(), start: lineStart, end: lineStart + line.length }]
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1] ?? ''
        const next = nextLine.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/)
        if (!next || Boolean(next[1]) !== ordered) break
        index += 1
        items.push({
          text: next[2]!.trim(),
          start: offsets[index]!,
          end: offsets[index]! + nextLine.length,
        })
      }
      blocks.push({
        type: 'list',
        ordered,
        items,
        start: items[0]!.start,
        end: items.at(-1)!.end,
      })
      continue
    }
    if (!line.trim()) flushParagraph()
    else paragraph.push({ text: line, line: index })
    if (blocks.length > 100_000)
      failDocument('DOCUMENT_IMPORT_LIMIT_EXCEEDED', 'Markdown 块数量超限')
  }
  flushParagraph()
  return blocks
}

function renderNode(node: DocumentNode, nodes: DocumentNode[]): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(Number(node.attributes.level ?? 1))} ${node.text ?? ''}`
    case 'paragraph':
      return node.text ?? ''
    case 'quote':
      return (node.text ?? '')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'code-block':
      return `\`\`\`${String(node.attributes.language ?? '')}\n${node.text ?? ''}\n\`\`\``
    case 'list': {
      const ordered = node.attributes.ordered === true
      return childrenOf(nodes, node.nodeId)
        .map(
          (item, index) =>
            `${ordered ? `${index + 1}.` : '-'} ${String(item.attributes.text ?? '')}`,
        )
        .join('\n')
    }
    default:
      return node.text ?? ''
  }
}

function childrenOf(nodes: DocumentNode[], parentId: DocumentNodeId): DocumentNode[] {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort(
      (left, right) =>
        left.orderKey.localeCompare(right.orderKey) ||
        String(left.nodeId).localeCompare(String(right.nodeId)),
    )
}

type DraftDocumentOperation = DocumentOperation extends infer Operation
  ? Operation extends DocumentOperation
    ? Omit<
        Operation,
        'operationId' | 'documentId' | 'baseRevisionId' | 'actorPrincipalId' | 'timestamp'
      >
    : never
  : never

function operation(
  documentId: DocumentId,
  revisionId: RevisionId,
  actorPrincipalId: string,
  identity: string,
  value: DraftDocumentOperation,
): DocumentOperation {
  return {
    ...value,
    operationId: `markdown-op-${createHash('sha256')
      .update(`${documentId}:${identity}`)
      .digest('hex')
      .slice(0, 24)}` as OperationId,
    documentId,
    baseRevisionId: revisionId,
    actorPrincipalId,
    timestamp: new Date(0).toISOString(),
  } as DocumentOperation
}

function stableNodeId(documentId: DocumentId, identity: string, type: string): DocumentNodeId {
  return `markdown-node-${createHash('sha256')
    .update(`${documentId}:${identity}:${type}`)
    .digest('hex')
    .slice(0, 24)}` as DocumentNodeId
}

function orderKey(index: number): string {
  return index.toString().padStart(10, '0')
}
