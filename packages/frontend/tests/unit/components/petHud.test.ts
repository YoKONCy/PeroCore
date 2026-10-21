// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DEFAULT_PET_CONTROLS } from '@infos/shared'
import PetOverlayUI from '@infos/frontend/components/pet/PetOverlayUI.vue'
import { splitSpokenCaptions } from '@infos/frontend/composables/pet/petPresentation'

const wrappers: ReturnType<typeof mount>[] = []
function create(props = {}) {
  const wrapper = mount(PetOverlayUI, {
    props: {
      petName: 'Nana',
      settings: { ...DEFAULT_PET_CONTROLS },
      bounds: { left: 250, right: 450, top: 100, bottom: 650 },
      viewport: { width: 800, height: 800 },
      ...props,
    },
    global: {
      stubs: {
        PixelIcon: true,
        PetConversationPicker: true,
        PetAppearancePanel: { template: '<div>外观与动作</div>' },
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
describe('桌宠 HUD 信息按需出现', () => {
  it('会话草稿分别保留，旧会话发送完成不能清空新会话输入', async () => {
    const wrapper = create({ agentId: 'pero', threadId: 'first' })
    await wrapper.find('.floating-trigger').trigger('click')
    await wrapper.find('textarea').setValue('第一条消息')
    await wrapper.find('.primary').trigger('click')
    const complete = wrapper.emitted('send-message')![0]![1] as (accepted: boolean) => void
    await wrapper.setProps({ threadId: 'second' })
    // 发送后操作面会收起，重新展开后验证另一会话的独立草稿。
    await wrapper.find('.floating-trigger').trigger('click')
    await wrapper.find('textarea').setValue('第二个会话的草稿')
    complete(true)
    await wrapper.vm.$nextTick()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('第二个会话的草稿')
    await wrapper.setProps({ threadId: 'first' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.setProps({ threadId: 'second' })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('第二个会话的草稿')
  })
  it('思考状态在菜单收起时仍然可见，阶段更新后同步，结束后收起', async () => {
    const wrapper = create({ thinking: true, stage: '正在思考' })
    expect(wrapper.find('.dock').exists()).toBe(false)
    expect(wrapper.find('.pet-activity').text()).toContain('让我想一想')
    await wrapper.setProps({ activity: { phase: 'generating', steps: [], nit: false } })
    expect(wrapper.find('.pet-activity').text()).toContain('正在整理回复')
    await wrapper.setProps({ thinking: false })
    expect(wrapper.find('.pet-activity').exists()).toBe(false)
  })
  it('空闲不显示空任务、输入框与角色状态，主动探索才展开', async () => {
    const wrapper = create({ moodText: '开心', mindText: '想出去玩' })
    expect(wrapper.find('.attention-card').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('开心')
    await wrapper.find('.floating-trigger').trigger('click')
    await wrapper
      .findAll('.dock button')
      .find((button) => button.text() === '互动')!
      .trigger('click')
    expect(wrapper.text()).toContain('开心')
    expect(wrapper.text()).toContain('外观与动作')
    expect(wrapper.find('details').exists()).toBe(true)
  })
  it('必要事项可以收起，后续不同事项出现也不会让旧事项重新自动展开', async () => {
    const wrapper = create({ attention: '需要确认操作', attentionKey: 'first' })
    expect(wrapper.find('.attention-card').exists()).toBe(true)
    await wrapper.find('[aria-label^="暂时收起"]').trigger('click')
    expect(wrapper.find('.attention-card').exists()).toBe(false)
    await wrapper.setProps({ attentionKey: 'second' })
    expect(wrapper.find('.attention-card').exists()).toBe(true)
    await wrapper.find('[aria-label^="暂时收起"]').trigger('click')
    await wrapper.setProps({ attentionKey: 'first' })
    expect(wrapper.find('.attention-card').exists()).toBe(false)
  })
  it('录音时单独显示语音状态，触碰台词与事项摘要让位', () => {
    const wrapper = create({
      recording: true,
      reaction: '摸摸头',
      attention: '需要确认',
      attentionKey: 'one',
    })
    expect(wrapper.find('.voice-strip.recording[role="status"]').exists()).toBe(true)
    expect(wrapper.find('.pet-speech-bubble').exists()).toBe(false)
    expect(wrapper.find('.attention-card').exists()).toBe(false)
  })
  it('没有标点的口语答复也拆成有限字幕段，不丢失内容', () => {
    const text = '长😀'.repeat(50)
    const chunks = splitSpokenCaptions(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length < text.length)).toBe(true)
    expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(chunk))).toBe(true)
    expect(chunks.join('')).toBe(text)
    expect(splitSpokenCaptions('第一句。第二句！')).toEqual(['第一句。', '第二句！'])
  })
  it('从面板按住发言时保留按钮，录音开始不能卸载松开事件的接收目标', async () => {
    const wrapper = create({
      settings: { ...DEFAULT_PET_CONTROLS, voiceMode: 'ptt' },
      voiceReady: true,
    })
    await wrapper.find('.floating-trigger').trigger('click')
    await wrapper
      .findAll('.dock button')
      .find((button) => button.text() === '语音')!
      .trigger('click')
    expect(wrapper.find('.hold-button').exists()).toBe(true)
    await wrapper.setProps({ recording: true })
    expect(wrapper.find('.hold-button').exists()).toBe(true)
  })
})
