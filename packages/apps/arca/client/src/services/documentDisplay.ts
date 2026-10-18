import type { DocumentSnapshot } from '@infos/document-engine'
import { officeContent, runsOf, type OfficeNode } from '@infos/document-engine/office'

/** 按正文树顺序读取展示内容，不把存储顺序误当作段落顺序。 */
export function orderedDocumentNodes(snapshot: DocumentSnapshot): OfficeNode[] {
  const content = officeContent(snapshot)
  const nodes: OfficeNode[] = []
  const children = new Map<string, OfficeNode[]>()
  for (const node of content.nodes) {
    if (!node.parentId) continue
    const group = children.get(node.parentId) ?? []
    group.push(node)
    children.set(node.parentId, group)
  }
  for (const group of children.values())
    group.sort((left, right) => left.orderKey.localeCompare(right.orderKey))
  const visit = (id: string) => {
    for (const node of children.get(id) ?? []) {
      nodes.push(node)
      visit(node.nodeId)
    }
  }
  visit(snapshot.document.rootNodeId)
  return nodes
}

export function nodeText(node: OfficeNode): string {
  return runsOf(node)
    .map((run) => run.text)
    .join('')
}

export function displayTime(value: string, short = false): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '时间未知'
  return date.toLocaleString('zh-CN', {
    ...(short ? {} : { year: 'numeric' }),
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 比较共同前后缀后退回完整字符边界，避免拆开中文扩展字符或 emoji。 */
export function textDifference(before: string, after: string) {
  let start = 0,
    end = 0
  const high = (value: number) => value >= 0xd800 && value <= 0xdbff
  const low = (value: number) => value >= 0xdc00 && value <= 0xdfff
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  if (start > 0 && high(before.charCodeAt(start - 1)) && low(before.charCodeAt(start))) start--
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - end - 1] === after[after.length - end - 1]
  )
    end++
  if (
    end > 0 &&
    low(before.charCodeAt(before.length - end)) &&
    high(before.charCodeAt(before.length - end - 1))
  )
    end--
  return {
    prefix: before.slice(0, start),
    removed: before.slice(start, before.length - end),
    added: after.slice(start, after.length - end),
    suffix: end ? before.slice(before.length - end) : '',
  }
}
