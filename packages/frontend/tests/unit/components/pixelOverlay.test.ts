/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PDialog from '@infos/frontend/components/pixel/PDialog.vue'
import PSelect from '@infos/frontend/components/pixel/PSelect.vue'
import PTooltip from '@infos/frontend/components/pixel/PTooltip.vue'

type SelectOption = {
  label: string
  value: string
  icon?: string
  disabled?: boolean
}

describe('基础像素浮层组件', () => {
  describe('PSelect', () => {
    const options: SelectOption[] = [
      { label: '猫猫', value: 'cat', icon: 'cat' },
      { label: '机器人', value: 'robot', disabled: true },
      { label: '用户', value: 'user' },
    ]

    it('应当显示已选项并在点击触发器后打开选项列表', async () => {
      const wrapper = mount(PSelect, {
        props: {
          modelValue: 'cat',
          options,
          label: '角色',
          icon: 'user',
        },
      })

      await wrapper.get('button').trigger('click')

      expect(wrapper.text()).toContain('角色')
      expect(wrapper.text()).toContain('猫猫')
      expect(wrapper.find('.p-select-dropdown').exists()).toBe(true)
      expect(wrapper.findAll('.p-select-option')).toHaveLength(3)
    })

    it('应当选择可用选项后发出事件并关闭下拉框', async () => {
      const wrapper = mount(PSelect, {
        props: {
          modelValue: 'cat',
          options,
        },
      })

      await wrapper.get('button').trigger('click')
      await wrapper.findAll('.p-select-option')[2]!.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([['user']])
      expect(wrapper.emitted('change')).toEqual([['user']])
      expect(wrapper.find('.p-select-dropdown').exists()).toBe(false)
    })

    it('应当忽略禁用选项和禁用触发器点击', async () => {
      const disabledWrapper = mount(PSelect, {
        props: {
          modelValue: 'cat',
          options,
          disabled: true,
        },
      })

      await disabledWrapper.get('button').trigger('click')

      expect(disabledWrapper.find('.p-select-dropdown').exists()).toBe(false)

      const wrapper = mount(PSelect, {
        props: {
          modelValue: 'cat',
          options,
        },
      })

      await wrapper.get('button').trigger('click')
      await wrapper.findAll('.p-select-option')[1]?.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(wrapper.find('.p-select-dropdown').exists()).toBe(true)
    })
  })

  describe('PDialog', () => {
    it('应当在确认模式下渲染内容并发出确认和关闭事件', async () => {
      const wrapper = mount(PDialog, {
        props: {
          modelValue: true,
          title: '删除确认',
          message: '确定删除吗？',
          confirmText: '删除',
          cancelText: '返回',
        },
        attachTo: document.body,
      })
      const buttons = document.body.querySelectorAll('.p-dialog-footer button')

      expect(document.body.textContent).toContain('删除确认')
      expect(document.body.textContent).toContain('确定删除吗？')

      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('confirm')).toEqual([[]])
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])

      wrapper.unmount()
    })

    it('应当在提示模式下重置输入值并把输入内容交给 confirm 事件', async () => {
      const wrapper = mount(PDialog, {
        props: {
          modelValue: true,
          mode: 'prompt',
          defaultValue: '默认值',
          placeholder: '请输入',
        },
        attachTo: document.body,
      })
      const input = document.body.querySelector('.p-dialog-input') as HTMLInputElement

      expect(input.value).toBe('默认值')

      input.value = '新值'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('confirm')).toEqual([['新值']])
      expect(wrapper.emitted('update:modelValue')).toEqual([[false]])

      wrapper.unmount()
    })

    it('应当点击遮罩或关闭按钮时取消或关闭对话框', async () => {
      const wrapper = mount(PDialog, {
        props: {
          modelValue: true,
        },
        attachTo: document.body,
      })
      const overlay = document.body.querySelector('.p-dialog-overlay') as HTMLElement
      const closeButton = document.body.querySelector('.p-dialog-close') as HTMLButtonElement

      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('cancel')).toEqual([[]])
      expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]])

      wrapper.unmount()
    })
  })

  describe('PTooltip', () => {
    it('应当在悬浮时显示提示内容并在离开时隐藏', async () => {
      const wrapper = mount(PTooltip, {
        props: {
          content: '提示内容',
          placement: 'bottom',
        },
        slots: {
          default: '<button>目标</button>',
        },
        attachTo: document.body,
      })

      await wrapper.trigger('mouseenter')
      await wrapper.vm.$nextTick()

      expect(document.body.textContent).toContain('提示内容')

      await wrapper.trigger('mouseleave')
      await wrapper.vm.$nextTick()

      expect(document.body.textContent).not.toContain('提示内容')

      wrapper.unmount()
    })

    it('应当在内容为空时忽略悬浮显示', async () => {
      const wrapper = mount(PTooltip, {
        props: {
          content: '',
        },
        slots: {
          default: '<span>目标</span>',
        },
        attachTo: document.body,
      })

      await wrapper.trigger('mouseenter')
      await wrapper.vm.$nextTick()

      expect(document.body.querySelector('.p-tooltip')).toBeNull()

      wrapper.unmount()
    })
  })
})
