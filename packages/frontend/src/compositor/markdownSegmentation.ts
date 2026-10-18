import type { SurfaceNodeId } from '@infos/shared'

export interface MarkdownRenderBlock {
  id: string
  kind: 'markdown' | 'mermaid'
  source: string
  stable: boolean
}

/** 每个文本节点独立持有游标；只扫描新到达的完整行，稳定块保持对象身份。 */
export class StreamMarkdownSegmenter {
  private source = ''
  private lineStart = 0
  private searched = 0
  private cutoff = 0
  private boundary = 0
  private fence = ''
  private mathFence = ''
  private htmlDepth = 0
  private blocks: MarkdownRenderBlock[] = []
  private result: MarkdownRenderBlock[] = []
  private committed = false

  constructor(private readonly nodeId: SurfaceNodeId) {}

  update(source: string, committed = false): MarkdownRenderBlock[] {
    if (source === this.source && committed === this.committed) return this.result
    if (this.committed || !source.startsWith(this.source)) this.reset()
    this.source = source
    this.committed = committed
    if (committed) {
      this.result = segmentStreamMarkdown(source, this.nodeId, true)
      return this.result
    }
    let newline: number
    while ((newline = source.indexOf('\n', this.searched)) !== -1) {
      const end = newline + 1
      const line = source.slice(this.lineStart, end)
      const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
      let boundary = false
      if (this.mathFence) this.mathFence = updateMathFence(line, this.mathFence)
      else if (marker) {
        if (!this.fence) this.fence = marker[1]!
        else if (marker[1]![0] === this.fence[0] && marker[1]!.length >= this.fence.length) {
          this.fence = ''
          boundary = true
        }
      } else if (!this.fence) {
        this.htmlDepth = updateHtmlDepth(line, this.htmlDepth)
        this.mathFence = updateMathFence(line, '')
        boundary = !this.mathFence && this.htmlDepth === 0 && /^[ \t]*\r?\n$/.test(line)
      }
      if (boundary) {
        // 保留最近一个完整段落，列表、引用和未闭合结构继续留在尾部。
        if (this.boundary > this.cutoff) {
          let cursor = this.cutoff
          for (const range of splitStableRanges(source.slice(this.cutoff, this.boundary))) {
            const start = cursor
            cursor += range.length
            this.blocks.push(makeBlock(range, this.nodeId, start, cursor))
          }
          this.cutoff = this.boundary
        }
        this.boundary = end
      }
      this.lineStart = end
      this.searched = end
    }
    this.searched = source.length
    this.result = [...this.blocks]
    if (this.cutoff < source.length)
      this.result.push({
        id: `${this.nodeId}:tail`,
        kind: 'markdown',
        source: source.slice(this.cutoff),
        stable: false,
      })
    return this.result
  }

  private reset(): void {
    this.source = ''
    this.lineStart = this.searched = this.cutoff = this.boundary = this.htmlDepth = 0
    this.fence = ''
    this.mathFence = ''
    this.blocks = []
    this.result = []
    this.committed = false
  }
}

function makeBlock(
  source: string,
  nodeId: SurfaceNodeId,
  start: number,
  end: number,
): MarkdownRenderBlock {
  const mermaid = source.match(
    /^[ \t]*```(?:mermaid|flowchart|graph)[^\n]*\n([\s\S]*?)\n?```[ \t]*(?:\n|$)$/i,
  )
  return {
    id: `${nodeId}:${start}-${end}`,
    kind: mermaid ? 'mermaid' : 'markdown',
    source: mermaid?.[1]?.trim() ?? source,
    stable: true,
  }
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
    blocks.push(makeBlock(range, nodeId, start, cursor))
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

function updateHtmlDepth(line: string, depth: number): number {
  const blockTags = /<\/?(html|body|main|article|section|div|header|footer|nav|form|svg)\b[^>]*>/gi
  let next = depth
  let match: RegExpExecArray | null
  while ((match = blockTags.exec(line)) !== null) {
    if (/^<\//.test(match[0])) next = Math.max(0, next - 1)
    else if (!/\/>$/.test(match[0])) next += 1
  }
  return next
}

/** 块公式中的空行属于同一段，不能在公式尚未闭合时拆开解析。 */
function updateMathFence(line: string, fence: string): string {
  if (fence) return line.includes(fence) ? '' : fence
  const trimmed = line.trimStart()
  if (trimmed.startsWith('$$') && !trimmed.slice(2).includes('$$')) return '$$'
  if (trimmed.startsWith('\\[') && !trimmed.slice(2).includes('\\]')) return '\\]'
  return ''
}

function findStableCutoff(source: string): number {
  const boundaries: number[] = []
  let fence: { marker: string; start: number } | null = null
  let htmlDepth = 0
  let mathFence = ''
  let offset = 0
  for (const line of source.split(/(?<=\n)/)) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (mathFence) mathFence = updateMathFence(line, mathFence)
    else if (marker) {
      if (!fence) fence = { marker: marker[1]!, start: offset }
      else if (marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length) {
        fence = null
        boundaries.push(offset + line.length)
      }
    } else if (!fence) {
      htmlDepth = updateHtmlDepth(line, htmlDepth)
      mathFence = updateMathFence(line, '')
      if (!mathFence && htmlDepth === 0 && /^[ \t]*\r?\n$/.test(line)) {
        boundaries.push(offset + line.length)
      }
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
  let fenceMarker = ''
  let htmlDepth = 0
  let mathFence = ''
  const lines = source.split(/(?<=\n)/)
  let offset = 0
  for (const line of lines) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
    if (mathFence) mathFence = updateMathFence(line, mathFence)
    else if (marker && fenceStart === -1) {
      fenceStart = offset
      fenceMarker = marker[1]!
    } else if (
      marker &&
      fenceStart >= 0 &&
      marker[1]![0] === fenceMarker[0] &&
      marker[1]!.length >= fenceMarker.length
    ) {
      const end = offset + line.length
      if (fenceStart > cursor) ranges.push(source.slice(cursor, fenceStart))
      ranges.push(source.slice(fenceStart, end))
      cursor = end
      fenceStart = -1
    } else if (fenceStart === -1) {
      htmlDepth = updateHtmlDepth(line, htmlDepth)
      mathFence = updateMathFence(line, '')
      if (!mathFence && htmlDepth === 0 && /^[ \t]*\r?\n$/.test(line)) {
        ranges.push(source.slice(cursor, offset + line.length))
        cursor = offset + line.length
      }
    }
    offset += line.length
  }
  if (cursor < source.length) ranges.push(source.slice(cursor))
  return ranges.filter(Boolean)
}
