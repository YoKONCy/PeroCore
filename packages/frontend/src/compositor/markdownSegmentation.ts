import type { SurfaceNodeId } from '@infos/shared'

export interface MarkdownRenderBlock {
  id: string
  kind: 'markdown' | 'mermaid'
  source: string
  stable: boolean
}

/**
 * 将流式 Markdown 切为不可回退的稳定块与唯一活跃尾部。
 * 保留最后一个完整段落作为安全尾部，避免后续列表/引用继续改变其语义。
 */
export function segmentStreamMarkdown(
  source: string,
  nodeId: SurfaceNodeId,
  committed = false,
): MarkdownRenderBlock[] {
  if (!source) return []
  const cutoff = committed ? source.length : findStableCutoff(source)
  const blocks: MarkdownRenderBlock[] = []
  let cursor = 0
  for (const range of splitStableRanges(source.slice(0, cutoff))) {
    const start = cursor
    cursor += range.length
    const mermaid = range.match(
      /^[ \t]*```(?:mermaid|flowchart|graph)[^\n]*\n([\s\S]*?)\n?```[ \t]*(?:\n|$)$/i,
    )
    blocks.push({
      id: `${nodeId}:${start}-${cursor}`,
      kind: mermaid ? 'mermaid' : 'markdown',
      source: mermaid?.[1]?.trim() ?? range,
      stable: true,
    })
  }
  if (cutoff < source.length) {
    blocks.push({
      id: `${nodeId}:tail`,
      kind: 'markdown',
      source: source.slice(cutoff),
      stable: false,
    })
  }
  return blocks
}

function findStableCutoff(source: string): number {
  const boundaries: number[] = []
  let fence: { marker: string; start: number } | null = null
  let offset = 0
  for (const line of source.split(/(?<=\n)/)) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = { marker: marker[1]!, start: offset }
      else if (marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length) {
        fence = null
        boundaries.push(offset + line.length)
      }
    } else if (
      !fence &&
      /\n\s*$/.test(line) &&
      source.slice(0, offset + line.length).endsWith('\n\n')
    ) {
      boundaries.push(offset + line.length)
    }
    offset += line.length
  }
  if (boundaries.length <= 1) return 0
  return boundaries[boundaries.length - 2]!
}

function splitStableRanges(source: string): string[] {
  if (!source) return []
  const ranges: string[] = []
  let cursor = 0
  let fenceStart = -1
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  for (const line of lines) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (marker && fenceStart === -1) fenceStart = offset
    else if (marker && fenceStart >= 0) {
      const end = offset + line.length
      if (fenceStart > cursor) ranges.push(source.slice(cursor, fenceStart))
      ranges.push(source.slice(fenceStart, end))
      cursor = end
      fenceStart = -1
    } else if (fenceStart === -1 && source.slice(cursor, offset + line.length).endsWith('\n\n')) {
      ranges.push(source.slice(cursor, offset + line.length))
      cursor = offset + line.length
    }
    offset += line.length
  }
  if (cursor < source.length) ranges.push(source.slice(cursor))
  return ranges.filter(Boolean)
}
