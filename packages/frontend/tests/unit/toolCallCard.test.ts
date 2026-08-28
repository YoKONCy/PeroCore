// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ToolCallCard from '../../src/components/tools/ToolCallCard.vue'

vi.mock('../../src/composables/tools/useToolDisplay', () => ({
  resolveToolDisplay: vi.fn(async () => ({
    label: '点击网页',
    icon: 'map-pin',
    color: 'sky',
    style: 'browser',
  })),
  toolDisplayColor: () => '#38bdf8',
  toolDisplayColorSoft: () => 'rgba(56,189,248,.12)',
  toolDisplayIcon: (display?: { icon?: string }) => display?.icon ?? 'tool',
  toolDisplayLabel: (name: string, display?: { label?: string }) => display?.label ?? name,
}))

afterEach(() => vi.useRealTimers())

describe('ToolCallCard Tool Atelier', () => {
  it('执行中默认展开并呈现对应行为原型', async () => {
    const wrapper = mount(ToolCallCard, {
      props: { tool: { name: 'browser_click', args: '{"target":"登录"}' } },
      global: { stubs: { Teleport: true } },
    })
    await vi.waitFor(() => expect(wrapper.classes()).toContain('ta-browser-space'))

    expect(wrapper.classes()).toContain('is-open')
    expect(wrapper.text()).toContain('登录')
    expect(wrapper.text()).toContain('进行中')
  })

  it('结果到达约600ms后应自动收起', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ToolCallCard, {
      props: { tool: { name: 'browser_click', args: '{"target":"登录"}' } },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.setProps({
      tool: { name: 'browser_click', args: '{"target":"登录"}', result: '完成', durationMs: 80 },
    })

    expect(wrapper.classes()).toContain('is-open')
    vi.advanceTimersByTime(601)
    await wrapper.vm.$nextTick()
    expect(wrapper.classes()).not.toContain('is-open')
  })

  it('详情按钮应可打开统一技术详情', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        tool: { name: 'terminal_execute', args: '{"command":"pnpm test"}', result: '通过' },
      },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.get('.ta-data-port').trigger('click')

    expect(wrapper.text()).toContain('工具调用详情')
    expect(wrapper.text()).toContain('terminal_execute')
    expect(wrapper.text()).toContain('pnpm test')
  })

  it('失败状态应同时提供文字和破损状态类', async () => {
    const wrapper = mount(ToolCallCard, {
      props: {
        tool: {
          name: 'edit_file',
          args: '{"file_path":"a.ts"}',
          result: '写入失败',
          isError: true,
        },
      },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.classes()).toContain('ta-state-error')
    expect(wrapper.text()).toContain('未完成')
  })
})
