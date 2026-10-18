import { describe, expect, it } from 'vitest'
import { type SurfaceFrame, type SurfaceId, type SurfaceNodeId } from '@infos/shared'
import { createPinia, setActivePinia } from 'pinia'
import { useCompositorStore } from '../../src/stores/useCompositorStore'
import { segmentStreamMarkdown } from '../../src/compositor/markdownSegmentation'

describe('批量流式内容正确性', () => {
  it('1000个流式Surface帧合成不应丢失或重复正文', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    const frames: SurfaceFrame[] = [
      {
        protocolVersion: 1,
        surfaceId: 'perf-surface' as SurfaceId,
        generation: 'g1',
        revision: 1,
        sequence: 1,
        operationId: 'open',
        operation: { type: 'surface.open', threadId: 'thread-1', principalId: 'pero' },
      },
    ]
    for (let sequence = 2; sequence <= 1001; sequence++) {
      frames.push({
        protocolVersion: 1,
        surfaceId: 'perf-surface' as SurfaceId,
        generation: 'g1',
        revision: sequence,
        sequence,
        operationId: `append-${sequence}`,
        operation: {
          type: 'surface.append-text',
          nodeId: 'markdown' as SurfaceNodeId,
          delta: '字',
        },
      })
    }
    frames.forEach(store.enqueue)
    store.flush()
    expect((store.get('perf-surface')?.nodes[0]?.props as { source: string }).source).toBe(
      '字'.repeat(1000),
    )
  })

  it('长Markdown分段应保留每个代码块且不丢失正文', () => {
    const source = Array.from(
      { length: 1000 },
      (_, index) => `段落${index}\n\n\`\`\`mermaid\ngraph TD\nA${index}-->B${index}\n\`\`\``,
    ).join('\n\n')
    const blocks = segmentStreamMarkdown(source, 'perf-markdown' as SurfaceNodeId, true)
    expect(blocks.filter((block) => block.kind === 'mermaid').map((block) => block.source)).toEqual(
      Array.from({ length: 1000 }, (_, index) => `graph TD\nA${index}-->B${index}`),
    )
    const paragraphs = blocks
      .filter((block) => block.kind === 'markdown')
      .map((block) => block.source)
      .join('')
    for (let index = 0; index < 1000; index++) expect(paragraphs).toContain(`段落${index}\n`)
  })
})
