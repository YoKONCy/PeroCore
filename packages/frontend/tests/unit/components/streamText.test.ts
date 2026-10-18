// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import StreamText from '../../../src/components/chat/StreamText.vue'

describe('流式纯文本 DOM', () => {
  it('追加内容保留原文本节点，超长内容分块且不解释 HTML', async () => {
    const source = '甲'.repeat(2047) + '🐈'
    const wrapper = mount(StreamText, { props: { source } })
    try {
      const first = wrapper.element.firstChild
      const selection = document.createRange()
      selection.setStart(first!, 1)
      selection.setEnd(first!, 3)
      await wrapper.setProps({
        source: source + '<img src=x onerror=alert(1)>' + '乙'.repeat(5000),
      })
      expect(wrapper.element.firstChild).toBe(first)
      expect(selection.toString()).toBe('甲甲')
      expect(wrapper.text()).toBe(source + '<img src=x onerror=alert(1)>' + '乙'.repeat(5000))
      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.element.childNodes.length).toBeGreaterThan(2)
    } finally {
      wrapper.unmount()
    }
  })

  it('文本替换和清空都不能保留旧流式片段', async () => {
    const wrapper = mount(StreamText, { props: { source: '旧内容' } })
    try {
      await wrapper.setProps({ source: '替换' })
      expect(wrapper.text()).toBe('替换')
      await wrapper.setProps({ source: '' })
      expect(wrapper.element.childNodes).toHaveLength(0)
    } finally {
      wrapper.unmount()
    }
  })
})
