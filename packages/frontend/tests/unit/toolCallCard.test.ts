// @vitest-environment happy-dom
import { enableAutoUnmount, mount } from '@vue/test-utils'
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
  it('执行中默认展开，展示目标和进度', async () => {
    const wrapper = mount(ToolCallCard, {
      props: { tool: { name: 'browser_click', args: '{"target":"登录"}' } },
      global: { stubs: { Teleport: true } },
    })
    expect(wrapper.classes()).toContain('is-open')
    expect(wrapper.text()).toContain('登录')
  })

  it('文件编辑执行中应明确显示编辑状态和路径', async () => {
    const wrapper = mount(ToolCallCard, {
      props: { tool: { name: 'edit_file', args: '{"path":"src/large.ts"}' } },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('src/large.ts')
  })

  it('结果到达后应自动收起', async () => {
    vi.useFakeTimers()
    const wrapper = mount(ToolCallCard, {
      props: { tool: { name: 'browser_click', args: '{"target":"登录"}' } },
      global: { stubs: { Teleport: true } },
    })
    await wrapper.setProps({
      tool: { name: 'browser_click', args: '{"target":"登录"}', result: '完成', durationMs: 80 },
    })

    expect(wrapper.classes()).toContain('is-open')
    await vi.runOnlyPendingTimersAsync()
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

    expect(wrapper.text()).toContain('terminal_execute')
    expect(wrapper.text()).toContain('pnpm test')
  })

  it('失败状态应提供可读提示', async () => {
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
  })
})

enableAutoUnmount(afterEach)
