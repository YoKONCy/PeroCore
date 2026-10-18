// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import ReplySelection from '../../../src/components/chat/ReplySelection.vue'

const speech = vi.hoisted(() => ({ speak: vi.fn(async () => {}), stop: vi.fn() }))
vi.mock('../../../src/composables/chat/useSelectionSpeech', () => ({
  useSelectionSpeech: () => ({ ...speech, busy: { value: false } }),
}))
const wrappers: VueWrapper[] = []
function view(streaming = false) {
  const wrapper = mount(ReplySelection, {
    attachTo: document.body,
    props: { streaming, identity: 'reply' },
    slots: { default: '<p>已经完成的回复</p>' },
    global: { plugins: [createPinia()] },
  })
  wrappers.push(wrapper)
  const range = document.createRange()
  range.selectNodeContents(wrapper.find('p').element)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  return wrapper
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  window.getSelection()?.removeAllRanges()
  vi.clearAllMocks()
})
describe('回复文字选区菜单', () => {
  it('完成后允许选中正文并直接朗读选区', async () => {
    const wrapper = view()
    await wrapper.find('p').trigger('contextmenu', { clientX: 100, clientY: 100 })
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!
    expect(menu.textContent).toContain('复制')
    menu.querySelectorAll<HTMLButtonElement>('button')[1]!.click()
    await Promise.resolve()
    expect(speech.speak).toHaveBeenCalledWith('已经完成的回复')
  })
  it('流式期间不提供选区菜单，转为流式会关闭已有菜单', async () => {
    const wrapper = view(true)
    await wrapper.find('p').trigger('contextmenu')
    expect(document.querySelector('[role="menu"]')).toBeNull()
    await wrapper.setProps({ streaming: false })
    await wrapper.find('p').trigger('contextmenu')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    await wrapper.setProps({ streaming: true })
    expect(document.querySelector('[role="menu"]')).toBeNull()
    expect(speech.stop).toHaveBeenCalled()
  })
})
