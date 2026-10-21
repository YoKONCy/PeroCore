// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import PetConversationPicker from '@infos/frontend/components/pet/PetConversationPicker.vue'

const api = vi.hoisted(() => ({ agents: vi.fn(), threads: vi.fn() }))
vi.mock('@infos/frontend/api/modules/agentApi', () => ({ agentApi: { list: api.agents } }))
vi.mock('@infos/frontend/api/modules/threadsApi', () => ({ threadsApi: { list: api.threads } }))
const wrappers: ReturnType<typeof mount>[] = []
function create() {
  const wrapper = mount(PetConversationPicker, {
    props: { agentId: 'pero', petName: 'Pero', threadId: 'first', threadTitle: '周末计划' },
    global: { stubs: { PetHudIcon: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
function thread(id: string, title: string) {
  return { id, title, status: 'active', messageCount: 4, createdAt: '2026-10-22T00:00:00Z' }
}
beforeEach(() => {
  api.agents.mockReset()
  api.threads.mockReset()
  api.agents.mockResolvedValue({
    data: [
      { id: 'pero', name: 'Pero', isEnabled: true },
      { id: 'nana', name: 'Nana', isEnabled: true },
      { id: 'disabled', name: '已停用角色', isEnabled: false },
    ],
  })
  api.threads.mockResolvedValue({
    data: { items: [thread('first', '周末计划'), thread('second', '另一个会话')], total: 2 },
  })
})
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('桌宠角色与会话切换', () => {
  it('按需加载启用角色，选择成功后回到输入框', async () => {
    const wrapper = create()
    expect(api.agents).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="切换角色"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('已停用角色')
    await wrapper
      .findAll('.is-agents button')
      .find((item) => item.text() === 'Nana')!
      .trigger('click')
    const [id, callback] = wrapper.emitted('select-agent')![0]!
    const complete = callback as (success: boolean) => void
    expect(id).toBe('nana')
    complete(true)
    await flushPromises()
    expect(wrapper.find('.pet-conversation-picker__drawer').exists()).toBe(false)
    expect(wrapper.emitted('focus-input')).toHaveLength(1)
  })
  it('会话查询绑定角色与桌面对话用途，选择透传真实 Thread ID', async () => {
    const wrapper = create()
    await wrapper.get('[aria-label="切换会话"]').trigger('click')
    await flushPromises()
    expect(api.threads).toHaveBeenCalledWith({
      agentId: 'pero',
      channel: 'desktop',
      purpose: 'conversation',
      page: 1,
      pageSize: 20,
    })
    await wrapper
      .findAll('.pet-conversation-picker__list button')
      .find((item) => item.text().includes('另一个会话'))!
      .trigger('click')
    expect(wrapper.emitted('select-thread')![0]![0]).toBe('second')
  })
  it('角色切换后忽略旧角色迟到的会话列表', async () => {
    let finish: (value: unknown) => void = () => {}
    api.threads.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const wrapper = create()
    await wrapper.get('[aria-label="切换会话"]').trigger('click')
    await wrapper.setProps({ agentId: 'nana', petName: 'Nana', threadId: 'nana-thread' })
    api.threads.mockResolvedValueOnce({
      data: { items: [thread('nana-thread', 'Nana 的会话')], total: 1 },
    })
    await wrapper.get('[aria-label="切换会话"]').trigger('click')
    await flushPromises()
    finish({ data: { items: [thread('old', '旧角色的迟到会话')], total: 1 } })
    await flushPromises()
    expect(wrapper.text()).toContain('Nana 的会话')
    expect(wrapper.text()).not.toContain('旧角色的迟到会话')
  })
  it('切换失败显示短提示，切换期间阻止重复操作', async () => {
    const wrapper = create()
    await wrapper.get('[aria-label="切换会话"]').trigger('click')
    await flushPromises()
    await wrapper.findAll('.pet-conversation-picker__list button')[1]!.trigger('click')
    expect(wrapper.get('[aria-label="新会话"]').attributes('disabled')).toBeDefined()
    const complete = wrapper.emitted('select-thread')![0]![1] as (success: boolean) => void
    complete(false)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('切换失败，请重试')
    expect(wrapper.get('[aria-label="新会话"]').attributes('disabled')).toBeUndefined()
  })
})
