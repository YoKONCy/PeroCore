// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'

describe('ConfirmDialog应用内危险确认（S06 L5阻断层）', () => {
  it('打开时渲染alertdialog并支持明确点击确认与取消', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: '删除语义块', message: '不可恢复说明', danger: true },
      attachTo: document.body,
    })
    const dialog = wrapper.get('[role="alertdialog"]')
    expect(dialog.attributes('aria-labelledby')).toBe('confirm-title')
    expect(dialog.attributes('aria-describedby')).toBe('confirm-message')
    expect(wrapper.get('.confirm-message').text()).toBe('不可恢复说明')
    expect(wrapper.get('.confirm-accept').classes()).toContain('danger')

    await wrapper.get('.confirm-accept').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)

    await wrapper.get('.soft-button').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('关闭时不渲染遮罩', () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: false, title: 't', message: 'm' },
    })
    expect(wrapper.find('.confirm-scrim').exists()).toBe(false)
  })

  it('危险操作禁止Enter快捷确认，Escape触发取消', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: true, title: 't', message: 'm', danger: true },
      attachTo: document.body,
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await nextTick()
    expect(wrapper.emitted('confirm')).toBeUndefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('打开时默认聚焦取消，Tab循环限制在两个按钮内', async () => {
    const wrapper = mount(ConfirmDialog, {
      props: { open: false, title: 't', message: 'm', danger: true },
      attachTo: document.body,
    })
    await wrapper.setProps({ open: true })
    await nextTick()
    const cancel = wrapper.get<HTMLButtonElement>('.soft-button').element
    const confirm = wrapper.get<HTMLButtonElement>('.confirm-accept').element
    expect(document.activeElement).toBe(cancel)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(confirm)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    expect(document.activeElement).toBe(cancel)
    wrapper.unmount()
  })
})
