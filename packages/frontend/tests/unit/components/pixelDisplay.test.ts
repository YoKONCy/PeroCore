/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PButton from '@infos/frontend/components/pixel/PButton.vue'

describe('PButton 操作可用性', () => {
  it.each([
    { disabled: true, loading: false },
    { disabled: false, loading: true },
  ])('禁用或加载时阻止操作，恢复后可点击', async (props) => {
    const onClick = vi.fn()
    const wrapper = mount(PButton, { props, attrs: { onClick } })
    try {
      expect(wrapper.get<HTMLButtonElement>('button').element.disabled).toBe(true)
      await wrapper.trigger('click')
      expect(onClick).not.toHaveBeenCalled()

      await wrapper.setProps({ disabled: false, loading: false })
      expect(wrapper.get<HTMLButtonElement>('button').element.disabled).toBe(false)
      await wrapper.trigger('click')
      expect(onClick).toHaveBeenCalledOnce()
    } finally {
      wrapper.unmount()
    }
  })
})
