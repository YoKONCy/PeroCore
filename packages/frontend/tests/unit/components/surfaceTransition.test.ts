// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import SurfaceTransition from '../../../src/components/motion/SurfaceTransition.vue'
import { useSensoryPreferences } from '../../../src/composables/ui/useSensoryPreferences'

const preference = useSensoryPreferences()
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> = []
const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
  const result = { cancel: vi.fn(), onfinish: null as (() => void) | null }
  animations.push(result)
  return result as unknown as Animation
})
beforeEach(async () => {
  preference.motionLevel.value = 'full'
  animations.length = 0
  animate.mockClear()
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  await nextTick()
})
afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.unstubAllGlobals()
})

describe('页面切换动效', () => {
  it('整页过渡时内层不叠加淡入，外层结束也不会补播一次', async () => {
    const outer = ref(true)
    const wrapper = mount(SurfaceTransition, {
      props: { identity: '甲' },
      global: { provide: { 'infos:surface-motion-active': outer } },
    })
    try {
      await wrapper.setProps({ identity: '乙' })
      expect(animate).not.toHaveBeenCalled()
      outer.value = false
      await nextTick()
      expect(animate).not.toHaveBeenCalled()
      await wrapper.setProps({ identity: '丙' })
      expect(animate).toHaveBeenCalledTimes(1)
    } finally {
      wrapper.unmount()
    }
  })

  it('自定义背景下保留材质透景，切换途中启用背景会清理旧透明度动画', async () => {
    const material = ref(false)
    const wrapper = mount(SurfaceTransition, {
      props: { identity: '甲' },
      global: { provide: { 'infos:app-background-active': material } },
    })
    try {
      await wrapper.setProps({ identity: '乙' })
      const old = animations.at(-1)!
      material.value = true
      await nextTick()
      expect(old.cancel).toHaveBeenCalled()
      expect(wrapper.classes()).toContain('surface-transition--material')
      await wrapper.setProps({ pending: true })
      expect(animate.mock.calls.at(-1)![0].every((frame) => frame.opacity === undefined)).toBe(true)
      await wrapper.setProps({ identity: '丙', pending: false })
      expect(animate.mock.calls.at(-1)![0].every((frame) => frame.opacity === undefined)).toBe(true)
    } finally {
      wrapper.unmount()
    }
  })

  it('加载先退场，完成后入场，始终保留原组件与交互现场', async () => {
    const wrapper = mount(SurfaceTransition, {
      props: { identity: '甲' },
      slots: { default: '<input value="草稿" />' },
    })
    try {
      await nextTick()
      const input = wrapper.find('input').element
      await wrapper.setProps({ pending: true })
      expect(wrapper.attributes('aria-busy')).toBe('true')
      expect(wrapper.classes()).toContain('is-departing')
      animations.at(-1)!.onfinish?.()
      await nextTick()
      expect(wrapper.classes()).toContain('is-waiting')
      await wrapper.setProps({ identity: '乙', pending: false })
      expect(wrapper.classes()).toContain('is-entering')
      expect(wrapper.find('input').element).toBe(input)
      animations.at(-1)!.onfinish?.()
      await nextTick()
      expect(wrapper.classes()).toContain('is-idle')
    } finally {
      wrapper.unmount()
    }
  })

  it('连续切换打断旧动画，旧完成回调不能清除新状态', async () => {
    const wrapper = mount(SurfaceTransition, { props: { identity: '甲' } })
    try {
      await wrapper.setProps({ identity: '乙' })
      const old = animations.at(-1)!
      await wrapper.setProps({ identity: '丙', pending: true })
      expect(old.cancel).toHaveBeenCalled()
      old.onfinish?.()
      await nextTick()
      expect(wrapper.classes()).toContain('is-departing')
      await wrapper.setProps({ identity: '丁', pending: false })
      expect(wrapper.classes()).toContain('is-entering')
    } finally {
      wrapper.unmount()
    }
  })

  it('关闭动效时不播放动画，加载状态仍然准确', async () => {
    preference.motionLevel.value = 'off'
    const wrapper = mount(SurfaceTransition, { props: { identity: '甲' } })
    try {
      await wrapper.setProps({ identity: '乙', pending: true })
      expect(animate).not.toHaveBeenCalled()
      expect(wrapper.attributes('aria-busy')).toBe('true')
      await wrapper.setProps({ pending: false })
      expect(wrapper.classes()).toContain('is-idle')
    } finally {
      wrapper.unmount()
    }
  })

  it('系统减少动态效果时只使用短淡入，不执行位移', async () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const wrapper = mount(SurfaceTransition, { props: { identity: '甲' } })
    try {
      await nextTick()
      await wrapper.setProps({ identity: '乙' })
      const [frames, options] = animate.mock.calls.at(-1)!
      expect(options.duration).toBe(100)
      expect(frames[0]?.transform).toBe('translate3d(0px, 0, 0)')
    } finally {
      wrapper.unmount()
    }
  })

  it('加载途中切成减少动效时立即取消旧位移，从无位移状态继续', async () => {
    const wrapper = mount(SurfaceTransition, { props: { identity: '甲' } })
    try {
      await wrapper.setProps({ pending: true })
      const old = animations.at(-1)!
      preference.motionLevel.value = 'reduced'
      await nextTick()
      expect(old.cancel).toHaveBeenCalled()
      const [frames, options] = animate.mock.calls.at(-1)!
      expect(options.duration).toBe(100)
      expect(frames[0]?.transform).toBe('none')
      expect(frames[1]?.transform).toBe('translate3d(0px, 0, 0)')
    } finally {
      wrapper.unmount()
    }
  })

  it('静默期间不播放动画，恢复时只播放一次入场', async () => {
    const wrapper = mount(SurfaceTransition, { props: { identity: '甲', active: false } })
    try {
      await wrapper.setProps({ identity: '乙' })
      expect(animate).not.toHaveBeenCalled()
      await wrapper.setProps({ active: true })
      expect(animate).toHaveBeenCalledTimes(1)
    } finally {
      wrapper.unmount()
    }
  })
})
