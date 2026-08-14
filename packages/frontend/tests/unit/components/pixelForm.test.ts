/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PCheckbox from '@infos/frontend/components/pixel/PCheckbox.vue'
import PInput from '@infos/frontend/components/pixel/PInput.vue'
import PInputNumber from '@infos/frontend/components/pixel/PInputNumber.vue'
import PSlider from '@infos/frontend/components/pixel/PSlider.vue'
import PSwitch from '@infos/frontend/components/pixel/PSwitch.vue'
import PTextarea from '@infos/frontend/components/pixel/PTextarea.vue'

describe('基础像素表单组件', () => {
  describe('PInput', () => {
    it('应当按属性渲染输入框状态', () => {
      const wrapper = mount(PInput, {
        props: {
          modelValue: 'Pero',
          placeholder: '请输入名称',
          type: 'password',
          size: 'lg',
          disabled: true,
        },
      })
      const input = wrapper.get('input')

      expect(input.element.value).toBe('Pero')
      expect(input.attributes('placeholder')).toBe('请输入名称')
      expect(input.attributes('type')).toBe('password')
      expect(input.attributes('disabled')).toBeDefined()
      expect(input.classes()).toContain('p-input-lg')
    })

    it('应当在输入时发出 update:modelValue 事件', async () => {
      const wrapper = mount(PInput, {
        props: {
          modelValue: '',
        },
      })

      await wrapper.get('input').setValue('新名称')

      expect(wrapper.emitted('update:modelValue')).toEqual([['新名称']])
    })
  })

  describe('PTextarea', () => {
    it('应当渲染标签、图标和文本域属性', () => {
      const wrapper = mount(PTextarea, {
        props: {
          modelValue: '长文本',
          label: '简介',
          icon: 'book',
          placeholder: '请输入简介',
          rows: 5,
          maxlength: 120,
          disabled: true,
        },
      })
      const textarea = wrapper.get('textarea')

      expect(wrapper.text()).toContain('简介')
      expect(textarea.element.value).toBe('长文本')
      expect(textarea.attributes('placeholder')).toBe('请输入简介')
      expect(textarea.attributes('rows')).toBe('5')
      expect(textarea.attributes('maxlength')).toBe('120')
      expect(textarea.attributes('disabled')).toBeDefined()
      expect(textarea.classes()).toContain('p-textarea-disabled')
    })

    it('应当在文本变化时发出 update:modelValue 事件', async () => {
      const wrapper = mount(PTextarea, {
        props: {
          modelValue: '',
        },
      })

      await wrapper.get('textarea').setValue('新的描述')

      expect(wrapper.emitted('update:modelValue')).toEqual([['新的描述']])
    })
  })

  describe('PSwitch', () => {
    it('应当点击后发出取反后的模型事件和 change 事件', async () => {
      const wrapper = mount(PSwitch, {
        props: {
          modelValue: false,
          label: '启用功能',
        },
      })

      await wrapper.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
      expect(wrapper.emitted('change')).toEqual([[true]])
    })

    it('应当在禁用状态下忽略点击', async () => {
      const wrapper = mount(PSwitch, {
        props: {
          modelValue: true,
          disabled: true,
        },
      })

      await wrapper.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(wrapper.emitted('change')).toBeUndefined()
      expect(wrapper.classes()).toContain('p-switch-disabled')
    })
  })

  describe('PCheckbox', () => {
    it('应当点击后发出勾选状态事件', async () => {
      const wrapper = mount(PCheckbox, {
        props: {
          modelValue: false,
          label: '同意协议',
        },
      })

      await wrapper.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
      expect(wrapper.emitted('change')).toEqual([[true]])
    })

    it('应当优先渲染默认插槽并在禁用时忽略点击', async () => {
      const wrapper = mount(PCheckbox, {
        props: {
          modelValue: true,
          label: '不会显示',
          disabled: true,
        },
        slots: {
          default: '插槽标签',
        },
      })

      await wrapper.trigger('click')

      expect(wrapper.text()).toContain('插槽标签')
      expect(wrapper.text()).not.toContain('不会显示')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(wrapper.find('.p-checkbox-wrapper').classes()).toContain('p-checkbox-disabled')
    })
  })

  describe('PInputNumber', () => {
    it('应当按步进增加并受最大值约束', async () => {
      const wrapper = mount(PInputNumber, {
        props: {
          modelValue: 9,
          min: 0,
          max: 10,
          step: 3,
        },
      })
      const buttons = wrapper.findAll('button')

      await buttons[1]?.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([[10]])
    })

    it('应当按步进减少并受最小值约束', async () => {
      const wrapper = mount(PInputNumber, {
        props: {
          modelValue: 1,
          min: 0,
          max: 10,
          step: 3,
        },
      })
      const buttons = wrapper.findAll('button')

      await buttons[0]!.trigger('click')

      expect(wrapper.emitted('update:modelValue')).toEqual([[0]])
    })

    it('应当把空输入按 null 处理并接受有效数字', async () => {
      const wrapper = mount(PInputNumber, {
        props: {
          modelValue: null,
          min: 0,
          max: 10,
        },
      })
      const input = wrapper.get('input')

      await input.setValue('')
      await input.setValue('7')

      expect(wrapper.emitted('update:modelValue')).toEqual([[null], [7]])
    })
  })

  describe('PSlider', () => {
    it('应当按当前值计算填充宽度和滑块位置', () => {
      const wrapper = mount(PSlider, {
        props: {
          modelValue: 50,
          min: 0,
          max: 200,
        },
      })

      expect(wrapper.get('.p-slider-fill').attributes('style')).toContain('width: 25%')
      expect(wrapper.get('.p-slider-thumb').attributes('style')).toContain('left: calc(25% - 10px)')
    })

    it('应当支持范围输入和数字输入同步发出事件', async () => {
      const wrapper = mount(PSlider, {
        props: {
          modelValue: 20,
          showInput: true,
        },
      })
      const inputs = wrapper.findAll('input')

      await inputs[0]?.setValue('30')
      await inputs[1]?.setValue('40')

      expect(wrapper.emitted('update:modelValue')).toEqual([[30], [40]])
    })
  })
})
