// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CompanionActivityPanel from '../../src/components/taskCenter/CompanionActivityPanel.vue'
import { ApiError } from '../../src/api/errors'

const api = vi.hoisted(() => ({
  activity: vi.fn(),
  resolveSuggestion: vi.fn(),
  cancelReminder: vi.fn(),
  retryReminder: vi.fn(),
}))
const gateway = vi.hoisted(() => ({ onPush: vi.fn(), offPush: vi.fn(), connect: vi.fn() }))
vi.mock('../../src/api/modules/schedulerApi', () => ({ schedulerApi: api }))
vi.mock('../../src/api/modules/backgroundTasksApi', () => ({
  backgroundTasksApi: { detail: vi.fn(), markRead: vi.fn() },
}))
vi.mock('../../src/composables/gateway/useGateway', () => ({
  useGateway: () => ({ ...gateway, state: ref('connected') }),
}))
vi.mock('../../src/components/taskCenter/TaskDetailModal.vue', () => ({
  default: { template: '<div />' },
}))

const state = (agentId = 'pero') => ({
  agentId,
  tasks: [],
  recent: [],
  scheduled: [],
  suggestions: [],
})
const wrappers: Array<{ unmount: () => void }> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  api.activity.mockImplementation(async (agentId) => ({ data: state(agentId) }))
  api.resolveSuggestion.mockResolvedValue({ data: {} })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
})

describe('桌宠活动投影', () => {
  it('建议显示依据与行动内容，只在点击采纳后提交', async () => {
    api.activity.mockResolvedValue({
      data: {
        ...state(),
        suggestions: [
          {
            id: 'suggestion-1',
            title: '整理报告',
            instruction: '把报告分类',
            reason: '有三份新报告',
            status: 'open',
          },
        ],
      },
    })
    const wrapper = mount(CompanionActivityPanel, { props: { agentId: 'pero' } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('有三份新报告')
    expect(wrapper.text()).toContain('把报告分类')
    expect(api.resolveSuggestion).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '采纳并开始')!
      .trigger('click')
    expect(api.resolveSuggestion).toHaveBeenCalledWith('suggestion-1', 'pero', 'accept')
  })

  it('角色切换时丢弃旧角色的慢响应', async () => {
    let finish!: (value: unknown) => void
    api.activity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(CompanionActivityPanel, { props: { agentId: 'pero' } })
    wrappers.push(wrapper)
    await wrapper.setProps({ agentId: 'nana' })
    await flushPromises()
    finish({
      data: { ...state(), suggestions: [{ id: 'old', title: '旧角色建议', status: 'open' }] },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧角色建议')
    expect(api.activity).toHaveBeenLastCalledWith('nana')
  })

  it('隐藏时停止刷新，重新激活后读取最新状态', async () => {
    const shown = ref(true)
    const placeholder = { render: () => h('div') }
    const wrapper = mount({
      render: () =>
        h(KeepAlive, null, {
          default: () =>
            shown.value
              ? h(CompanionActivityPanel, { agentId: 'pero', key: 'work' })
              : h(placeholder, { key: 'other' }),
        }),
    })
    wrappers.push(wrapper)
    await flushPromises()
    const before = api.activity.mock.calls.length
    shown.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(api.activity).toHaveBeenCalledTimes(before)
    shown.value = true
    await nextTick()
    await flushPromises()
    expect(api.activity).toHaveBeenCalledTimes(before + 1)
  })

  it('权限错误停止轮询并允许手动重新加载', async () => {
    api.activity.mockRejectedValueOnce(new ApiError('FORBIDDEN', '当前角色不可访问'))
    const wrapper = mount(CompanionActivityPanel, { props: { agentId: 'pero' } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('当前角色不可访问')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(api.activity).toHaveBeenCalledTimes(1)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(api.activity).toHaveBeenCalledTimes(2)
  })
})
