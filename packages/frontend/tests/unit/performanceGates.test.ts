import { describe, expect, it } from 'vitest'
import {
  PerformanceBaselineRegistry,
  type SurfaceFrame,
  type SurfaceId,
  type SurfaceNodeId,
} from '@infos/shared'
import { createPinia, setActivePinia } from 'pinia'
import { useCompositorStore } from '../../src/stores/useCompositorStore'
import { segmentStreamMarkdown } from '../../src/compositor/markdownSegmentation'

describe('前端性能回归门禁', () => {
  it('1000个流式Surface帧合成不应出现数量级回退', () => {
    setActivePinia(createPinia())
    const store = useCompositorStore()
    const startedAt = performance.now()
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
    const duration = performance.now() - startedAt
    expect((store.get('perf-surface')?.nodes[0]?.props as { source: string }).source).toHaveLength(
      1000,
    )
    expect(duration).toBeLessThan(2_000)
  })

  it('长Markdown分段P95应满足宽松CPU预算', () => {
    const registry = new PerformanceBaselineRegistry()
    const source = Array.from(
      { length: 1000 },
      (_, index) => `段落${index}\n\n\`\`\`mermaid\ngraph TD\nA${index}-->B${index}\n\`\`\``,
    ).join('\n\n')
    for (let index = 0; index < 20; index++) {
      const startedAt = performance.now()
      const blocks = segmentStreamMarkdown(source, 'perf-markdown' as SurfaceNodeId, true)
      registry.observe('markdown_segmentation_ms', performance.now() - startedAt)
      expect(blocks.length).toBeGreaterThan(1000)
    }
    registry.assertGates([
      {
        metric: 'markdown_segmentation_ms',
        percentile: 'p95',
        maximum: 1_000,
        minimumSamples: 20,
      },
    ])
  })
})
