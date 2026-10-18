// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import Viewer from '../../src/components/workspace/WorkspaceImageViewer.vue'
import { createPreviewState } from '../../src/components/workspace/workspacePreview'

const wrappers: VueWrapper[] = []
let frames: FrameRequestCallback[] = []
function viewer() {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width: 800, height: 600 } }] as never, this as never)
      }
      disconnect() {}
    },
  )
  const wrapper = mount(Viewer, {
    attachTo: document.body,
    props: { src: '/original.png', name: '原图', active: true, state: createPreviewState() },
  })
  wrappers.push(wrapper)
  const image = wrapper.get('img').element as HTMLImageElement
  Object.defineProperties(image, { naturalWidth: { value: 400 }, naturalHeight: { value: 300 } })
  const stage = wrapper.get('.workspace-image__stage').element as HTMLElement
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect
  stage.setPointerCapture = vi.fn()
  stage.hasPointerCapture = () => false
  return wrapper
}
function flushFrame() {
  for (const callback of frames.splice(0)) callback(0)
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
})

describe('共享图片查看器', () => {
  it('普通滚轮即可放大，缩放后鼠标下仍是同一处图片内容', async () => {
    const wrapper = viewer()
    await wrapper.get('img').trigger('load')
    await wrapper
      .get('.workspace-image__stage')
      .trigger('wheel', { deltaY: -100, clientX: 600, clientY: 300 })
    flushFrame()
    const patch = wrapper.emitted('state')!.at(-1)![0] as { zoom: number; panX: number }
    expect(patch.zoom).toBeGreaterThan(1)
    expect((200 - patch.panX) / patch.zoom).toBeCloseTo(200)
  })
  it('图片适应窗口且没有滚动条时，也能自由拖动', async () => {
    const wrapper = viewer()
    await wrapper.get('img').trigger('load')
    const stage = wrapper.get('.workspace-image__stage')
    await stage.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 100, clientY: 100 })
    await stage.trigger('pointermove', { pointerId: 1, clientX: 180, clientY: 130 })
    flushFrame()
    expect(wrapper.emitted('state')!.at(-1)![0]).toMatchObject({ panX: 80, panY: 30 })
    await stage.trigger('pointerup', { pointerId: 1 })
    expect(stage.classes()).not.toContain('dragging')
  })
  it('Esc 先退出全屏观察，不把事件交给外层关闭弹窗', async () => {
    const wrapper = viewer()
    const button = wrapper.findAll('button').find((item) => item.text() === '全屏观察')!
    await button.trigger('click')
    expect(document.querySelector('.workspace-image--expanded')).not.toBeNull()
    const bubble = vi.fn()
    window.addEventListener('keydown', bubble)
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await nextTick()
      expect(document.querySelector('.workspace-image--expanded')).toBeNull()
      expect(bubble).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', bubble)
    }
  })
})
