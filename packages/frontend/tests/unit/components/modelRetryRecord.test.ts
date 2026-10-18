// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ModelRetrySurfaceProps } from '@infos/shared'
import ModelRetryRecord from '../../../src/components/chat/ModelRetryRecord.vue'

describe('模型重试原始记录', () => {
  it('回连只停止动画，提示原文、原因、次数与等待时长保持不变', async () => {
    const record: ModelRetrySurfaceProps = {
      retryId: 'retry-1',
      state: 'waiting',
      attempt: 1,
      maxRetries: 5,
      reason: '连接被上游重置',
      delayMs: 1200,
      startedAt: 100,
      updatedAt: 100,
      partialResponse: true,
      turn: 2,
    }
    const wrapper = mount(ModelRetryRecord, { props: { record, active: true } })
    try {
      const original = wrapper.text()
      expect(original).toContain('1/5')
      expect(wrapper.classes()).toContain('model-retry--moving')
      await wrapper.setProps({ record: { ...record, state: 'recovered', updatedAt: 500 } })
      expect(wrapper.classes()).not.toContain('model-retry--moving')
      expect(wrapper.text()).toBe(original)
      expect(wrapper.text()).not.toContain('已恢复')
      await wrapper.setProps({ active: false })
      expect(wrapper.text()).toBe(original)
    } finally {
      wrapper.unmount()
    }
  })
})
