/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ContextMenu from '@infos/frontend/components/pixel/ContextMenu.vue'
import PDatePicker from '@infos/frontend/components/pixel/PDatePicker.vue'
import PImageViewer from '@infos/frontend/components/pixel/PImageViewer.vue'
import PixelIcon from '@infos/frontend/components/pixel/PixelIcon.vue'

type ContextMenuItem =
  | {
      type?: undefined
      label: string
      action?: () => void
      shortcut?: string
      disabled?: boolean
    }
  | {
      type: 'separator'
    }

describe('剩余像素基础组件', () => {
  describe('PixelIcon', () => {
    it('应当按名称、尺寸和动画渲染图标 class', () => {
      const wrapper = mount(PixelIcon, {
        props: {
          name: 'heart',
          size: 'lg',
          animation: 'pulse',
        },
      })
      const path = wrapper.get('path')

      expect(wrapper.classes()).toEqual(
        expect.arrayContaining(['w-6', 'h-6', 'animate-pixel-pulse']),
      )
      expect(path.attributes('fill')).toBe('currentColor')
      expect(path.attributes('d')).toBeTruthy()
    })

    it('应当对未知尺寸和未知动画使用安全回退', () => {
      const wrapper = mount(PixelIcon, {
        props: {
          name: 'unknown-icon',
          size: 'mega',
          animation: 'unknown-animation',
        },
      })
      const path = wrapper.get('path')

      expect(wrapper.classes()).toEqual(expect.arrayContaining(['w-5', 'h-5']))
      expect(path.attributes('fill')).toBe('none')
      expect(path.attributes('d')).toBe(
        'M12 3v2 M12 19v2 M5.64 5.64l1.41 1.41 M16.95 16.95l1.41 1.41 M3 12h2 M19 12h2 M5.64 18.36l1.41-1.41 M16.95 7.05l1.41-1.41',
      )
    })
  })

  describe('PDatePicker', () => {
    it('应当渲染日期输入状态并显示日历图标', () => {
      const wrapper = mount(PDatePicker, {
        props: {
          modelValue: '2026-04-27',
          disabled: true,
        },
      })
      const input = wrapper.get('input')

      expect(input.element.value).toBe('2026-04-27')
      expect(input.attributes('type')).toBe('date')
      expect(input.attributes('disabled')).toBeDefined()
      expect(wrapper.classes()).toContain('p-datepicker-disabled')
      expect(wrapper.findComponent(PixelIcon).props('name')).toBe('calendar')
    })

    it('应当在日期变化时发出 update:modelValue 事件', async () => {
      const wrapper = mount(PDatePicker, {
        props: {
          modelValue: '',
        },
      })

      await wrapper.get('input').setValue('2026-05-01')

      expect(wrapper.emitted('update:modelValue')).toEqual([['2026-05-01']])
    })
  })

  describe('ContextMenu', () => {
    const createItems = (action = vi.fn()): ContextMenuItem[] => [
      { label: '复制', action, shortcut: 'Ctrl+C' },
      { type: 'separator' },
      { label: '禁用项', disabled: true },
    ]

    it('应当在可见时按坐标渲染菜单项和分隔线', () => {
      const wrapper = mount(ContextMenu, {
        props: {
          visible: true,
          x: 120,
          y: 80,
          items: createItems(),
        },
        attachTo: document.body,
      })
      const menu = document.body.querySelector('.p-context-menu') as HTMLElement

      expect(menu.textContent).toContain('复制')
      expect(menu.textContent).toContain('Ctrl+C')
      expect(menu.style.left).toBe('120px')
      expect(menu.style.top).toBe('80px')
      expect(document.body.querySelector('.p-ctx-separator')).not.toBeNull()

      wrapper.unmount()
    })

    it('应当点击可用菜单项时执行动作并关闭菜单', async () => {
      const action = vi.fn()
      const wrapper = mount(ContextMenu, {
        props: {
          visible: true,
          x: 0,
          y: 0,
          items: createItems(action),
        },
        attachTo: document.body,
      })
      const firstButton = document.body.querySelector('.p-ctx-item') as HTMLButtonElement

      firstButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(action).toHaveBeenCalledOnce()
      expect(wrapper.emitted('close')?.length).toBeGreaterThanOrEqual(1)

      wrapper.unmount()
    })

    it('应当忽略禁用项并响应 Escape 关闭', async () => {
      const wrapper = mount(ContextMenu, {
        props: {
          visible: true,
          x: 0,
          y: 0,
          items: createItems(),
        },
        attachTo: document.body,
      })
      const buttons = document.body.querySelectorAll('.p-ctx-item')

      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('close')).toEqual([[]])

      wrapper.unmount()
    })
  })

  describe('PImageViewer', () => {
    it('应当在可见时显示初始图片和计数器', () => {
      const wrapper = mount(PImageViewer, {
        props: {
          visible: true,
          images: ['a.png', 'b.png', 'c.png'],
          initialIndex: 1,
        },
        attachTo: document.body,
      })
      const image = document.body.querySelector('.piv-image') as HTMLImageElement

      expect(image.getAttribute('src')).toBe('b.png')
      expect(document.body.querySelector('.piv-counter')?.textContent).toContain('2/3')
      expect(document.body.querySelectorAll('.piv-nav')).toHaveLength(2)

      wrapper.unmount()
    })

    it('应当通过导航按钮切换图片并限制边界', async () => {
      const wrapper = mount(PImageViewer, {
        props: {
          visible: true,
          images: ['a.png', 'b.png'],
          initialIndex: 0,
        },
        attachTo: document.body,
      })
      const leftButton = document.body.querySelector('.piv-nav-left') as HTMLButtonElement
      const rightButton = document.body.querySelector('.piv-nav-right') as HTMLButtonElement

      expect(leftButton.disabled).toBe(true)

      rightButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await wrapper.vm.$nextTick()

      expect(
        (document.body.querySelector('.piv-image') as HTMLImageElement).getAttribute('src'),
      ).toBe('b.png')
      expect(rightButton.disabled).toBe(true)

      wrapper.unmount()
    })

    it('应当点击关闭按钮、遮罩或 Escape 时发出关闭事件', async () => {
      const wrapper = mount(PImageViewer, {
        props: {
          visible: true,
          images: ['a.png'],
        },
        attachTo: document.body,
      })
      const closeButton = document.body.querySelector('.piv-close') as HTMLButtonElement
      const overlay = document.body.querySelector('.piv-overlay') as HTMLElement

      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await wrapper.vm.$nextTick()

      expect(wrapper.emitted('update:visible')).toEqual([[false], [false], [false]])

      wrapper.unmount()
    })
  })
})
