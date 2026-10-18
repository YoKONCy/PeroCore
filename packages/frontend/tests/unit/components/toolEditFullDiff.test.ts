// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ToolCardEdit from '../../../src/components/tools/renderers/ToolCardEdit.vue'

describe('文件工具完整 Diff', () => {
  it.each(['write_file', 'edit_file'])('%s 流式单行超过旧边界也能显示完整末尾', (toolName) => {
    const text = '甲'.repeat(300_000) + '文件尾部标记'
    const args =
      toolName === 'write_file'
        ? { file_path: 'large.txt', content: text }
        : { file_path: 'large.txt', old_text: '旧文', new_text: text }
    const wrapper = mount(ToolCardEdit, {
      props: {
        toolName,
        args: JSON.stringify(args).slice(0, -2),
        assembling: true,
      },
    })
    try {
      expect(wrapper.find('.diff-row.is-add code').text()).toContain(text)
      expect(wrapper.text()).not.toContain('预览已限长')
    } finally {
      wrapper.unmount()
    }
  })

  it('完整行数据支持滚动到尾部，DOM 保持窗口化', async () => {
    const content = Array.from({ length: 200 }, (_, index) => `完整第${index}行`).join('\n')
    const wrapper = mount(ToolCardEdit, {
      props: {
        toolName: 'write_file',
        args: JSON.stringify({ file_path: 'large.txt', content }),
        assembling: true,
      },
    })
    try {
      const grid = wrapper.find('.diff-grid')
      expect(grid.attributes('aria-rowcount')).toBe('200')
      expect(wrapper.findAll('.diff-row').length).toBeLessThanOrEqual(30)
      ;(grid.element as HTMLElement).scrollTop = 195 * 22
      await grid.trigger('scroll')
      expect(wrapper.findAll('.diff-row').length).toBeLessThanOrEqual(30)
      expect(wrapper.text()).toContain('完整第199行')
    } finally {
      wrapper.unmount()
    }
  })
})
