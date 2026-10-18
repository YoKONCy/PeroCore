// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTerminal from '../../src/components/workspace/WorkspaceTerminal.vue'
import { ApiError } from '../../src/api/errors'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  action: vi.fn(),
  cleanup: vi.fn(),
  pin: vi.fn(),
}))
vi.mock('../../src/api/modules/approvalsApi', () => ({ terminalsApi: api }))
vi.mock('../../src/stores', () => ({ useNotificationStore: () => ({ toast: vi.fn() }) }))
vi.mock('../../src/components/pixel', () => ({ PixelIcon: { template: '<span />' } }))

const wrappers: Array<{ unmount: () => void }> = []
const props = { agentId: 'pero', threadId: 'thread-1' }

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  api.list.mockResolvedValue({ data: { terminals: [] } })
  api.read.mockResolvedValue({ data: { output: '', nextCursor: 0, status: 'running' } })
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.useRealTimers()
})

describe('工作区终端轮询', () => {
  const terminal = (id: string, extra = {}) => ({
    id,
    title: `python ${'很长的命令参数 '.repeat(20)}${id}`,
    status: 'running',
    backend: 'pipe',
    cols: 120,
    rows: 30,
    outputLength: 0,
    ...extra,
  })

  it('任意数量和长度的标题独立省略，始终只挂载当前 xterm 实例', async () => {
    api.list.mockResolvedValue({
      data: { terminals: [terminal('a'), terminal('b'), terminal('c')] },
    })
    const wrapper = mount(WorkspaceTerminal, {
      props,
      global: {
        stubs: {
          WorkspaceTerminalScreen: {
            name: 'WorkspaceTerminalScreen',
            props: ['output', 'outputOffset'],
            template: '<pre class="screen">{{ output }}</pre>',
          },
        },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(3)
    expect(wrapper.findAll('.terminal-tab__title')).toHaveLength(3)
    expect(wrapper.get('[role="tab"]').attributes('title')).toContain('很长的命令参数')
    expect(wrapper.findAll('.screen')).toHaveLength(1)
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper.findAll('.screen')).toHaveLength(1)
    expect(wrapper.emitted('active')?.at(-1)).toEqual(['b'])
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('active')?.at(-1)).toEqual(['c'])
    expect(wrapper.find('.terminal-controls .terminal-create').exists()).toBe(true)
  })

  it('输出窗口有界，归档可重新打开读取且不会创建新进程', async () => {
    const old = terminal('old', {
      archivedAt: new Date().toISOString(),
      status: 'exited',
      exitCode: 0,
    })
    api.list.mockResolvedValue({ data: { terminals: [terminal('a')], history: [old] } })
    api.read.mockResolvedValue({
      data: { output: 'x'.repeat(200_000), nextCursor: 200_000, status: 'running' },
    })
    const wrapper = mount(WorkspaceTerminal, {
      props,
      global: {
        stubs: {
          WorkspaceTerminalScreen: {
            name: 'WorkspaceTerminalScreen',
            props: ['output', 'outputOffset'],
            template: '<pre class="screen">{{ output }}</pre>',
          },
        },
      },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.screen').text().length).toBe(128_000)
    await wrapper.get('.terminal-history button').trigger('click')
    await flushPromises()
    expect(api.read).toHaveBeenCalledWith(props, 'old', 0)
    expect(api.create).not.toHaveBeenCalled()
    expect(wrapper.findAll('.screen')).toHaveLength(1)
    expect(wrapper.get('.terminal-toolbar').text()).toContain('已归档')
  })

  it('统一管理入口区分归档和停止 Agent，页面卸载不杀进程', async () => {
    api.cleanup.mockResolvedValue({ data: {} })
    const wrapper = mount(WorkspaceTerminal, { props })
    wrappers.push(wrapper)
    await flushPromises()
    const buttons = wrapper.findAll('.terminal-menu__panel button')
    await buttons.find((button) => button.text() === '归档已结束')!.trigger('click')
    await flushPromises()
    expect(api.cleanup).toHaveBeenCalledWith(props, 'archive_completed')
    await buttons.find((button) => button.text() === '停止 Agent 终端')!.trigger('click')
    await flushPromises()
    expect(api.cleanup).toHaveBeenCalledWith(props, 'stop_agent')
    expect(api.action).not.toHaveBeenCalled()
  })

  it('403 后停止自动轮询，展示原因并允许手动重试', async () => {
    api.list.mockRejectedValueOnce(new ApiError('FORBIDDEN', '终端关联的会话不属于当前角色'))
    const wrapper = mount(WorkspaceTerminal, { props })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('不属于当前角色')
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.list).toHaveBeenCalledTimes(1)
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('KeepAlive 隐藏时暂停，重新激活后继续轮询', async () => {
    const shown = ref(true)
    const placeholder = { render: () => h('div') }
    const wrapper = mount({
      render: () =>
        h(KeepAlive, null, {
          default: () =>
            shown.value
              ? h(WorkspaceTerminal, { ...props, key: 'terminal' })
              : h(placeholder, { key: 'placeholder' }),
        }),
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(1)
    shown.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.list).toHaveBeenCalledTimes(1)
    shown.value = true
    await nextTick()
    await flushPromises()
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('慢请求不会叠加，切换会话后丢弃旧请求结果', async () => {
    let resolveOld!: (value: unknown) => void
    api.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        }),
    )
    const wrapper = mount(WorkspaceTerminal, { props })
    wrappers.push(wrapper)
    await vi.advanceTimersByTimeAsync(2400)
    expect(api.list).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ agentId: 'nana', threadId: 'thread-2' })
    await flushPromises()
    expect(api.list).toHaveBeenLastCalledWith({ agentId: 'nana', threadId: 'thread-2' })
    resolveOld({
      data: { terminals: [{ id: 'old-terminal', title: '旧终端', status: 'running' }] },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧终端')
    expect(api.read).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(api.list).toHaveBeenCalledTimes(3)
  })
})
