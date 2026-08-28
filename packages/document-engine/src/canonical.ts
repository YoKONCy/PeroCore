import { createHash } from 'node:crypto'
import type { DocumentNode, JsonValue, SemanticDocument } from './types'
import { failDocument } from './errors'

export function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

export function assertJsonValue(value: unknown, path = 'value'): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`))
    return
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) {
        failDocument('DOCUMENT_INVALID_ATTRIBUTE', `JSON 属性不能为 undefined: ${path}.${key}`)
      }
      assertJsonValue(item, `${path}.${key}`)
    }
    return
  }
  failDocument('DOCUMENT_INVALID_ATTRIBUTE', `值不是合法 JSON: ${path}`)
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failDocument('DOCUMENT_INVALID_ATTRIBUTE', '数字必须为有限值')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`
  }
  failDocument('DOCUMENT_INVALID_ATTRIBUTE', '值不能进入规范化 JSON')
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value)
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function documentRootHash(
  document: SemanticDocument,
  nodes: Iterable<DocumentNode>,
): string {
  const semanticDocument = {
    documentId: document.documentId,
    generation: document.generation,
    authorityNodeId: document.authorityNodeId,
    authorityEpoch: document.authorityEpoch,
    ownerPrincipalId: document.ownerPrincipalId,
    title: document.title,
    language: document.language,
    kind: document.kind,
    rootNodeId: document.rootNodeId,
    status: document.status,
    metadata: document.metadata,
  }
  const semanticNodes = [...nodes]
    .sort((left, right) => String(left.nodeId).localeCompare(String(right.nodeId)))
    .map((node) => ({
      nodeId: node.nodeId,
      documentId: node.documentId,
      type: node.type,
      parentId: node.parentId,
      orderKey: node.orderKey,
      generation: node.generation,
      ...(node.text === undefined ? {} : { text: node.text }),
      attributes: node.attributes,
    }))
  return contentHash({ protocolVersion: 1, document: semanticDocument, nodes: semanticNodes })
}
