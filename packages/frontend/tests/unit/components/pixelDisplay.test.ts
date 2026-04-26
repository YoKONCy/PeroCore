/* @vitest-environment happy-dom */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PBadge from '@perocore/frontend/components/pixel/PBadge.vue'
import PButton from '@perocore/frontend/components/pixel/PButton.vue'
import PCard from '@perocore/frontend/components/pixel/PCard.vue'
import PEmpty from '@perocore/frontend/components/pixel/PEmpty.vue'
import PixelIcon from '@perocore/frontend/components/pixel/PixelIcon.vue'

describe('基础像素展示组件', () => {
  describe('PButton', () => {
    it('应当按默认配置渲染主按钮内容', () => {
      const wrapper = mount(PButton, {
        slots: {
          default: '保存',
        },
      })

      expect(wrapper.text()).toContain('保存')
      expect(wrapper.classes()).toContain('p-btn-primary')
      expect(wrapper.classes()).toContain('p-btn-md')
      expect(wrapper.attributes('disabled')).toBeUndefined()
    })

    it('应当在加载中禁用按钮并显示加载图标', () => {
      const wrapper = mount(PButton, {
        props: {
          loading: true,
          variant: 'danger',
          size: 'sm',
        },
        slots: {
          default: '删除',
        },
      })

      expect(wrapper.classes()).toEqual(
        expect.arrayContaining(['p-btn-danger', 'p-btn-sm', 'p-btn-loading']),
      )
      expect(wrapper.attributes('disabled')).toBeDefined()
      expect(wrapper.findComponent(PixelIcon).exists()).toBe(true)
      expect(wrapper.findComponent(PixelIcon).props()).toMatchObject({
        name: 'refresh',
        animation: 'spin',
      })
    })
  })

  describe('PBadge', () => {
    it('应当按变体和尺寸渲染徽章内容', () => {
      const wrapper = mount(PBadge, {
        props: {
          variant: 'success',
          size: 'sm',
        },
        slots: {
          default: '在线',
        },
      })

      expect(wrapper.text()).toBe('在线')
      expect(wrapper.classes()).toEqual(expect.arrayContaining(['p-badge-success', 'p-badge-sm']))
    })

    it('应当在点标记模式下保留点样式并允许无内容', () => {
      const wrapper = mount(PBadge, {
        props: {
          dot: true,
          variant: 'danger',
        },
      })

      expect(wrapper.text()).toBe('')
      expect(wrapper.classes()).toEqual(expect.arrayContaining(['p-badge-dot', 'p-badge-danger']))
    })
  })

  describe('PCard', () => {
    it('应当渲染头部插槽、默认内容和基础状态 class', () => {
      const wrapper = mount(PCard, {
        props: {
          pixel: true,
          active: true,
          padding: 'lg',
          fullHeight: true,
        },
        slots: {
          header: '卡片标题',
          default: '卡片内容',
        },
      })

      expect(wrapper.text()).toContain('卡片标题')
      expect(wrapper.text()).toContain('卡片内容')
      expect(wrapper.classes()).toEqual(
        expect.arrayContaining(['p-card-pixel', 'p-card-active', 'p-card-pad-lg']),
      )
      expect(wrapper.find('.p-card-body').classes()).toContain('p-card-body-full')
    })

    it('应当在可悬停或发光时渲染装饰元素', () => {
      const wrapper = mount(PCard, {
        props: {
          hoverable: true,
          glow: true,
          variant: 'sky',
          overflowVisible: true,
        },
        slots: {
          default: '可交互卡片',
        },
      })

      expect(wrapper.classes()).toEqual(
        expect.arrayContaining([
          'p-card-hoverable',
          'p-card-glow',
          'p-card-overflow',
          'p-card-variant-sky',
        ]),
      )
      expect(wrapper.find('.p-card-sparkle').exists()).toBe(true)
      expect(wrapper.find('.p-card-glow-orb').exists()).toBe(true)
    })
  })

  describe('PEmpty', () => {
    it('应当渲染默认空状态描述和提示文案', () => {
      const wrapper = mount(PEmpty)

      expect(wrapper.text()).toContain('这里空空如也喵...')
      expect(wrapper.text()).toContain('NO DATA FOUND')
      expect(wrapper.find('.p-empty-paw').exists()).toBe(true)
    })

    it('应当支持自定义描述、操作插槽并隐藏猫爪', () => {
      const wrapper = mount(PEmpty, {
        props: {
          description: '暂无记忆',
          showPaw: false,
        },
        slots: {
          default: '<button>立即创建</button>',
        },
      })

      expect(wrapper.text()).toContain('暂无记忆')
      expect(wrapper.text()).toContain('立即创建')
      expect(wrapper.find('.p-empty-actions').exists()).toBe(true)
      expect(wrapper.find('.p-empty-paw').exists()).toBe(false)
    })
  })
})
