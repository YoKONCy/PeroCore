// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { SurfaceNode, SurfaceNodeId } from '@infos/shared'
import type { CompositorSurface } from '../../../src/stores/useCompositorStore'
import ConversationSurface from '../../../src/components/compositor/ConversationSurface.vue'

vi.mock('../../../src/stores', () => ({ useCompositorStore: () => ({ surfaces: new Map() }) }))
vi.mock('../../../src/composables/gateway/useGateway', () => ({
  useGateway: () => ({ withInputSeatFor: vi.fn() }),
}))
vi.mock('../../../src/api/modules/surfacesApi', () => ({ surfacesApi: {} }))

function reasoning(turn: number, phase: 'preview' | 'committed'): SurfaceNode {
  return {
    nodeId: `reasoning-${turn}` as SurfaceNodeId,
    revision: 1,
    kind: 'native-reasoning',
    lifecycle: 'stable',
    props: { source: `独立思考${turn}`, turn, phase, mode: 'stream' },
  }
}
function surface(nodes: SurfaceNode[]): CompositorSurface {
  return {
    surfaceId: 'reasoning-surface' as CompositorSurface['surfaceId'],
    generation: 'g1',
    threadId: 't1',
    principalId: 'pero',
    revision: 1,
    sequence: 1,
    state: 'open',
    nodes,
    operationIds: new Set(),
  }
}

describe('ReAct 思考块独立交互', () => {
  it('思考结束后立即收起，后面的编辑参数仍在流式生成时也不重新展开', async () => {
    const editing: SurfaceNode = {
      nodeId: 'edit-draft' as SurfaceNodeId,
      revision: 1,
      kind: 'tool-call',
      lifecycle: 'interactive',
      props: { name: 'edit_file', callId: 'edit-1', args: '', state: 'assembling' },
    }
    const wrapper = mount(ConversationSurface, {
      props: { surface: surface([reasoning(1, 'preview')]) },
      global: {
        stubs: {
          StreamMarkdown: { props: ['source'], template: '<pre>{{ source }}</pre>' },
          PixelIcon: true,
          ToolCallCard: true,
        },
      },
    })
    try {
      const panel = () => wrapper.get('details.surface-native-reasoning')
      expect((panel().element as HTMLDetailsElement).open).toBe(true)
      await wrapper.setProps({ surface: surface([reasoning(1, 'committed'), editing]) })
      expect((panel().element as HTMLDetailsElement).open).toBe(false)
      ;(panel().element as HTMLDetailsElement).open = true
      await panel().trigger('toggle')
      await wrapper.setProps({
        surface: surface([
          reasoning(1, 'committed'),
          { ...editing, revision: 2, props: { ...editing.props, args: '{"new_text":"正在生成' } },
        ]),
      })
      expect((panel().element as HTMLDetailsElement).open).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('历史块和当前块独立展开，切换一个不会联动另一个', async () => {
    const wrapper = mount(ConversationSurface, {
      props: { surface: surface([reasoning(1, 'committed'), reasoning(2, 'preview')]) },
      global: {
        stubs: {
          StreamMarkdown: { props: ['source'], template: '<pre>{{ source }}</pre>' },
          PixelIcon: true,
        },
      },
    })
    try {
      const blocks = wrapper.findAll('details.surface-native-reasoning')
      expect((blocks[0]!.element as HTMLDetailsElement).open).toBe(false)
      expect((blocks[1]!.element as HTMLDetailsElement).open).toBe(true)
      ;(blocks[0]!.element as HTMLDetailsElement).open = true
      await blocks[0]!.trigger('toggle')
      ;(blocks[1]!.element as HTMLDetailsElement).open = false
      await blocks[1]!.trigger('toggle')
      expect((blocks[0]!.element as HTMLDetailsElement).open).toBe(true)
      expect(blocks[0]!.text()).toContain('独立思考1')
      expect(blocks[0]!.text()).not.toContain('独立思考2')
      await wrapper.setProps({
        surface: surface([
          reasoning(1, 'committed'),
          reasoning(2, 'preview'),
          reasoning(3, 'preview'),
        ]),
      })
      expect((wrapper.findAll('details')[2]!.element as HTMLDetailsElement).open).toBe(true)
      expect((wrapper.findAll('details')[1]!.element as HTMLDetailsElement).open).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
})
