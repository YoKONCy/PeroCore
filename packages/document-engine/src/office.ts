import type {
  DocumentNode,
  DocumentNodeId,
  DocumentNodeType,
  DocumentOperation,
  DocumentSnapshot,
  DocumentTransactionRequest,
  InlineNode,
  JsonValue,
  OperationId,
} from './types'

export interface OfficeMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  code?: boolean
  fontFamily?: string
  fontSize?: number
  color?: string
  highlight?: string
  link?: string
  citation?: string
}
export interface OfficeRun {
  text: string
  marks?: OfficeMarks
}
export type OfficeNode = Pick<
  DocumentNode,
  'nodeId' | 'type' | 'parentId' | 'orderKey' | 'text' | 'attributes'
>
export interface OfficeContent {
  title: string
  nodes: OfficeNode[]
}
export interface OfficeEditRequest {
  documentId: DocumentSnapshot['documentId']
  baseRevisionId: DocumentSnapshot['revisionId']
  transactionId: string
  timestamp: string
  intent: string
  content: OfficeContent
}
export interface OfficeEditResult {
  receipt: import('./types').DocumentCommitReceipt | null
  snapshot: DocumentSnapshot
}
export interface OfficeSelection {
  revisionId: string
  anchor: { nodeId: string; offset: number }
  focus: { nodeId: string; offset: number }
}
export const OFFICE_TEXT_TYPES = new Set<DocumentNodeType>([
  'heading',
  'paragraph',
  'quote',
  'code-block',
  'list-item',
  'table-cell',
  'citation',
])
const NODE_TYPES = new Set<DocumentNodeType>([
  'document-root',
  'section',
  ...OFFICE_TEXT_TYPES,
  'list',
  'asset',
  'table',
  'table-row',
  'programmable-island',
])
export const OFFICE_SCHEMA_VERSION = 1

export function officeContent(snapshot: DocumentSnapshot): OfficeContent {
  return {
    title: snapshot.document.title,
    nodes: snapshot.nodes.map(({ nodeId, type, parentId, orderKey, text, attributes }) => ({
      nodeId,
      type,
      parentId,
      orderKey,
      ...(text === undefined ? {} : { text }),
      attributes: JSON.parse(JSON.stringify(attributes)) as Record<string, JsonValue>,
    })),
  }
}
export function normalizeRuns(value: unknown): OfficeRun[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('文稿行内内容无效')
  const result: OfficeRun[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || typeof item.text !== 'string')
      throw new Error('文稿行内文本无效')
    const marks: OfficeMarks = {},
      raw = item.marks ?? {}
    for (const key of ['bold', 'italic', 'underline', 'strike', 'code'] as const)
      if (raw[key] === true) marks[key] = true
    if (typeof raw.fontFamily === 'string' && /^[\p{L}\p{N} ,.'"_-]{1,100}$/u.test(raw.fontFamily))
      marks.fontFamily = raw.fontFamily
    if (Number.isFinite(raw.fontSize) && raw.fontSize >= 8 && raw.fontSize <= 96)
      marks.fontSize = raw.fontSize
    for (const key of ['color', 'highlight'] as const)
      if (typeof raw[key] === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(raw[key]))
        marks[key] = raw[key]
    if (typeof raw.link === 'string' && /^(https?:|mailto:|#)/i.test(raw.link))
      marks.link = raw.link
    if (typeof raw.citation === 'string' && /^[a-z0-9:_-]{1,150}$/i.test(raw.citation))
      marks.citation = raw.citation
    if (!item.text) continue
    const previous = result.at(-1)
    if (previous && JSON.stringify(previous.marks ?? {}) === JSON.stringify(marks))
      previous.text += item.text
    else result.push({ text: item.text, ...(Object.keys(marks).length ? { marks } : {}) })
  }
  return result
}
export function runsOf(node: Pick<OfficeNode, 'text' | 'attributes'>): OfficeRun[] {
  const text = node.text ?? String(node.attributes.text ?? '')
  if (Array.isArray(node.attributes.runs)) {
    const runs = normalizeRuns(node.attributes.runs)
    if (runs.map((run) => run.text).join('') === text) return runs
  }
  if (Array.isArray(node.attributes.inlineAst)) {
    const walk = (nodes: InlineNode[], marks: OfficeMarks = {}): OfficeRun[] =>
      nodes.flatMap((item) => {
        if (item.type === 'text' || item.type === 'code')
          return [
            {
              text: item.value,
              marks: { ...marks, ...(item.type === 'code' ? { code: true } : {}) },
            },
          ]
        if (item.type === 'line-break') return [{ text: '\n', marks }]
        if (item.type === 'citation') return [{ text: item.label, marks }]
        if ('children' in item)
          return walk(item.children, {
            ...marks,
            ...(item.type === 'strong'
              ? { bold: true }
              : item.type === 'emphasis'
                ? { italic: true }
                : item.type === 'delete'
                  ? { strike: true }
                  : item.type === 'link'
                    ? { link: item.href }
                    : {}),
          })
        return []
      })
    const converted = normalizeRuns(walk(node.attributes.inlineAst as unknown as InlineNode[]))
    if (converted.map((run) => run.text).join('') === text) return converted
  }
  return text ? [{ text }] : []
}
export function runsToInline(runs: OfficeRun[]): InlineNode[] {
  return runs.map((run) => {
    let node: InlineNode = { type: 'text', value: run.text }
    for (const [key, type] of [
      ['bold', 'strong'],
      ['italic', 'emphasis'],
      ['strike', 'delete'],
    ] as const)
      if (run.marks?.[key]) node = { type, children: [node] }
    if (run.marks?.link) node = { type: 'link', href: run.marks.link, children: [node] }
    if (run.marks?.citation)
      node = { type: 'citation', sourceId: run.marks.citation, label: run.text }
    return node
  })
}
export function setNodeRuns(node: OfficeNode, runs: OfficeRun[]): void {
  const normalized = normalizeRuns(runs)
  node.text = normalized.map((run) => run.text).join('')
  delete node.attributes.text
  delete node.attributes.sourceRange
  node.attributes.runs = normalized as unknown as JsonValue
  node.attributes.inlineAst = runsToInline(normalized) as unknown as JsonValue
}
export function sliceRuns(runs: OfficeRun[], start: number, end: number): OfficeRun[] {
  let cursor = 0
  return normalizeRuns(
    runs.flatMap((run) => {
      const from = Math.max(0, start - cursor),
        to = Math.min(run.text.length, end - cursor)
      cursor += run.text.length
      return to > from ? [{ ...run, text: run.text.slice(from, to) }] : []
    }),
  )
}
export function formatRuns(
  runs: OfficeRun[],
  start: number,
  end: number,
  patch: Partial<OfficeMarks>,
): OfficeRun[] {
  return normalizeRuns([
    ...sliceRuns(runs, 0, start),
    ...sliceRuns(runs, start, end).map((run) => ({
      text: run.text,
      marks: { ...run.marks, ...patch },
    })),
    ...sliceRuns(runs, end, Infinity),
  ])
}
export function officeChildren(content: OfficeContent, parentId: string): OfficeNode[] {
  return content.nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.orderKey.localeCompare(b.orderKey))
}
export function reorderChildren(content: OfficeContent, parentId: string, ids: string[]): void {
  ids.forEach((id, index) => {
    const node = content.nodes.find((item) => item.nodeId === id && item.parentId === parentId)
    if (node) node.orderKey = String(index + 1).padStart(10, '0')
  })
}
export function validateOfficeContent(content: OfficeContent, rootId: string): void {
  if (
    !content ||
    typeof content.title !== 'string' ||
    !content.title.trim() ||
    content.title.length > 500 ||
    !Array.isArray(content.nodes) ||
    content.nodes.length > 20000
  )
    throw new Error('文稿内容或标题无效')
  const nodes = new Map<string, OfficeNode>()
  for (const node of content.nodes) {
    if (
      !node ||
      typeof node.nodeId !== 'string' ||
      !node.nodeId ||
      nodes.has(node.nodeId) ||
      !NODE_TYPES.has(node.type) ||
      typeof node.orderKey !== 'string' ||
      !node.orderKey ||
      !node.attributes ||
      typeof node.attributes !== 'object' ||
      Array.isArray(node.attributes)
    )
      throw new Error('文稿节点无效或重复')
    if (node.text !== undefined && typeof node.text !== 'string') throw new Error('文稿文本无效')
    if (
      Array.isArray(node.attributes.runs) &&
      normalizeRuns(node.attributes.runs)
        .map((run) => run.text)
        .join('') !== (node.text ?? '')
    )
      throw new Error('行内内容与正文不一致')
    nodes.set(node.nodeId, node)
  }
  const root = nodes.get(rootId)
  if (!root || root.type !== 'document-root' || root.parentId !== null)
    throw new Error('文稿根节点不能被替换')
  if (
    root.attributes.officeSchemaVersion !== undefined &&
    root.attributes.officeSchemaVersion !== OFFICE_SCHEMA_VERSION
  )
    throw new Error('文稿格式版本高于当前编辑器，请保留原文并升级 Arca')
  if (
    root.attributes.references !== undefined &&
    (!Array.isArray(root.attributes.references) ||
      root.attributes.references.length > 1000 ||
      root.attributes.references.some(
        (reference) =>
          !reference ||
          typeof reference !== 'object' ||
          Array.isArray(reference) ||
          typeof reference.id !== 'string' ||
          typeof reference.title !== 'string' ||
          (reference.url !== undefined && typeof reference.url !== 'string') ||
          (reference.note !== undefined && typeof reference.note !== 'string'),
      ))
  )
    throw new Error('参考资料与脚注格式无效')
  for (const node of nodes.values()) {
    const visited = new Set<string>([node.nodeId])
    let parent = node.parentId
    while (parent !== null) {
      if (visited.has(parent) || !nodes.has(parent)) throw new Error('文稿结构存在环或失效的父节点')
      visited.add(parent)
      parent = nodes.get(parent)!.parentId
      if (visited.size > 64) throw new Error('文稿嵌套层级不能超过 64 层')
    }
    if (!visited.has(rootId)) throw new Error('文稿含有其他根节点')
  }
  if (JSON.stringify(content).length > 15000000) throw new Error('文稿事务超过大小限制')
}

/** 由基础快照编译最小领域事务；同一请求重试得到同一组操作标识与内容。 */
export function compileOfficeEdit(
  snapshot: DocumentSnapshot,
  request: OfficeEditRequest,
  actorPrincipalId: string,
): DocumentTransactionRequest {
  validateOfficeContent(request.content, snapshot.document.rootNodeId)
  request = {
    ...request,
    content: {
      ...request.content,
      nodes: request.content.nodes.map((node) =>
        node.nodeId === snapshot.document.rootNodeId
          ? {
              ...node,
              attributes: { ...node.attributes, officeSchemaVersion: OFFICE_SCHEMA_VERSION },
            }
          : node,
      ),
    },
  }
  if (request.documentId !== snapshot.documentId || request.baseRevisionId !== snapshot.revisionId)
    throw new Error('编辑请求与基础快照不一致')
  if (!request.transactionId || !Number.isFinite(Date.parse(request.timestamp)))
    throw new Error('文稿事务标识或时间无效')
  const map = new Map(
    snapshot.nodes.map((node) => [node.nodeId, JSON.parse(JSON.stringify(node)) as DocumentNode]),
  )
  const target = new Map(request.content.nodes.map((node) => [node.nodeId, node]))
  const operations: DocumentOperation[] = []
  type Payload = DocumentOperation extends infer O
    ? O extends DocumentOperation
      ? Omit<O, keyof import('./types').DocumentOperationBase>
      : never
    : never
  const add = (payload: Payload) => {
    const operation = {
      ...payload,
      operationId: `${request.transactionId}:${operations.length}` as OperationId,
      documentId: request.documentId,
      actorPrincipalId,
      baseRevisionId: request.baseRevisionId,
      timestamp: request.timestamp,
    } as DocumentOperation
    operations.push(operation)
    return operation
  }
  const remove = (id: DocumentNodeId) => {
    const node = map.get(id)!
    for (const child of [...map.values()].filter((item) => item.parentId === id))
      remove(child.nodeId)
    map.delete(id)
    if (node.parentId) map.get(node.parentId)!.generation++
  }
  const pending = request.content.nodes.filter((node) => !map.has(node.nodeId))
  // 类型转换与移动同属原子事务；先转换，再按目标结构移动，最终统一校验树。
  for (const node of request.content.nodes) {
    const actual = map.get(node.nodeId)
    if (actual && actual.type !== node.type) {
      add({
        type: 'node.retype',
        nodeId: node.nodeId,
        expectedGeneration: actual.generation,
        nodeType: node.type,
      })
      actual.type = node.type
      actual.generation++
    }
  }
  while (pending.length) {
    const index = pending.findIndex((node) => node.parentId !== null && map.has(node.parentId))
    if (index < 0) throw new Error('无法插入文稿结构')
    const node = pending.splice(index, 1)[0]!,
      parent = map.get(node.parentId!)!
    const orderKey = `~office:${request.transactionId}:${operations.length}`
    add({
      type: 'node.insert',
      node: {
        ...node,
        type: node.type as Exclude<DocumentNodeType, 'document-root'>,
        parentId: parent.nodeId,
        orderKey,
      },
      parentGeneration: parent.generation,
    })
    parent.generation++
    map.set(node.nodeId, {
      ...node,
      documentId: snapshot.documentId,
      orderKey,
      generation: 1,
      createdAt: request.timestamp,
      updatedAt: request.timestamp,
    })
  }
  const moved: OfficeNode[] = []
  const depth = (node: OfficeNode): number =>
    node.parentId ? 1 + depth(target.get(node.parentId)!) : 0
  for (const node of [...request.content.nodes].sort((a, b) => depth(a) - depth(b))) {
    const actual = map.get(node.nodeId)!
    if (!node.parentId || (actual.parentId === node.parentId && actual.orderKey === node.orderKey))
      continue
    const parent = map.get(node.parentId)!,
      previous = actual.parentId && map.get(actual.parentId)
    const orderKey = `~move:${request.transactionId}:${operations.length}`
    add({
      type: 'node.move',
      nodeId: node.nodeId,
      expectedGeneration: actual.generation,
      newParentId: parent.nodeId,
      newParentGeneration: parent.generation,
      newOrderKey: orderKey,
    })
    if (previous && previous !== parent) previous.generation++
    actual.parentId = parent.nodeId
    actual.orderKey = orderKey
    actual.generation++
    parent.generation++
    moved.push(node)
  }
  for (const node of snapshot.nodes)
    if (!target.has(node.nodeId) && map.has(node.nodeId)) {
      add({
        type: 'node.delete',
        nodeId: node.nodeId,
        expectedGeneration: map.get(node.nodeId)!.generation,
        recursive: true,
      })
      remove(node.nodeId)
    }
  for (const node of moved) {
    const actual = map.get(node.nodeId)!,
      parent = map.get(node.parentId!)!
    add({
      type: 'node.move',
      nodeId: actual.nodeId,
      expectedGeneration: actual.generation,
      newParentId: parent.nodeId,
      newParentGeneration: parent.generation,
      newOrderKey: node.orderKey,
    })
    actual.generation++
    parent.generation++
    actual.orderKey = node.orderKey
  }
  for (const node of request.content.nodes) {
    const actual = map.get(node.nodeId)!
    if (actual.type !== node.type) {
      add({
        type: 'node.retype',
        nodeId: node.nodeId,
        expectedGeneration: actual.generation,
        nodeType: node.type,
      })
      actual.type = node.type
      actual.generation++
    }
    if (actual.text !== node.text && OFFICE_TEXT_TYPES.has(node.type)) {
      add({
        type: 'text.replace',
        nodeId: node.nodeId,
        expectedGeneration: actual.generation,
        value: node.text ?? '',
        resetFormatting: true,
      })
      actual.generation++
      delete actual.attributes.inlineAst
      delete actual.attributes.sourceRange
      delete actual.attributes.runs
    }
    for (const key of new Set([...Object.keys(actual.attributes), ...Object.keys(node.attributes)]))
      if (JSON.stringify(actual.attributes[key]) !== JSON.stringify(node.attributes[key])) {
        add({
          type: 'attribute.set',
          nodeId: node.nodeId,
          expectedGeneration: actual.generation,
          key,
          ...(node.attributes[key] === undefined ? {} : { value: node.attributes[key] }),
        })
        actual.generation++
      }
  }
  if (snapshot.document.title !== request.content.title)
    add({ type: 'document.rename', value: request.content.title })
  return {
    transactionId: request.transactionId,
    documentId: request.documentId,
    actorPrincipalId,
    baseRevisionId: request.baseRevisionId,
    operations,
    intent: request.intent,
    idempotencyKey: request.transactionId,
  }
}
