// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCallCard from '../../../src/components/tools/ToolCallCard.vue'

vi.mock('../../../src/composables/tools/useToolDisplay', () => ({
  resolveToolDisplay: vi.fn(async () => undefined),
  toolDisplayLabel: (name: string) => (name === 'write_file' ? '写入文件' : '编辑文件'),
  toolDisplayIcon: () => 'edit',
  toolDisplayColor: () => 'var(--ui-accent-primary)',
  toolDisplayColorSoft: () => 'var(--ui-accent-primary-soft)',
}))

describe('折叠的文件工具摘要', () => {
  it.each(['write_file', 'edit_file'])(
    '%s 折叠时持续更新增删计数，完成立即采用实际统计',
    async (name) => {
      vi.useFakeTimers()
      const tool = {
        name,
        assembling: true,
        fileBaseline: { path: 'a.txt', status: 'new' as const },
        args: JSON.stringify(
          name === 'write_file'
            ? { file_path: 'a.txt', content: '第一行' }
            : { path: 'a.txt', old_text: '旧文', new_text: '第一行' },
        ).slice(0, -2),
      }
      const wrapper = mount(ToolCallCard, {
        props: { tool, expanded: false },
        global: {
          stubs: { ToolArchetypeSignature: true, ToolCardEdit: true, ToolTechnicalDrawer: true },
        },
      })
      try {
        expect(wrapper.find('.ta-summary .is-add').text()).toBe('+1')
        expect(wrapper.find('tool-card-edit-stub').exists()).toBe(false)
        const args = JSON.stringify(
          name === 'write_file'
            ? { file_path: 'a.txt', content: '第一行\n第二行\n第三行' }
            : { path: 'a.txt', old_text: '旧文', new_text: '第一行\n第二行\n第三行' },
        )
        await wrapper.setProps({ tool: { ...tool, args: args.slice(0, -2) } })
        await vi.advanceTimersByTimeAsync(75)
        expect(wrapper.find('.ta-summary .is-add').text()).toBe('+3')
        expect(wrapper.find('.ta-summary .is-remove').text()).toBe(
          name === 'edit_file' ? '−1' : '−0',
        )
        await wrapper.setProps({
          tool: {
            ...tool,
            args,
            assembling: false,
            result: JSON.stringify({ success: true, insertions: 4, deletions: 2, diffPreview: [] }),
          },
        })
        expect(wrapper.find('.ta-summary .is-add').text()).toBe('+4')
        expect(wrapper.find('.ta-summary .is-remove').text()).toBe('−2')
        expect(wrapper.find('.ta-diff-stats').attributes('title')).toContain('已写入')
      } finally {
        wrapper.unmount()
        vi.useRealTimers()
      }
    },
  )
})
