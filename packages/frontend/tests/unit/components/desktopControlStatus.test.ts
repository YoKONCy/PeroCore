// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DesktopControlStatus from '../../../src/components/desktop/DesktopControlStatus.vue'

const mocks = vi.hoisted(() => ({ control: vi.fn() }))
vi.mock('../../../src/composables/useDesktopControl', async () => {
  const { ref } = await import('vue')
  return {
    useDesktopControl: () => ({
      state: ref({ phase: 'idle', epoch: 1 }),
      error: ref(''),
      control: mocks.control,
      supported: true,
    }),
  }
})
const pause = {
  kind: 'desktop' as const,
  code: 'DESKTOP_WAITING',
  message: '用户已接管',
  toolName: 'open_application',
  callId: 'open',
  pausedAt: '2026-10-18T08:00:00Z',
}
beforeEach(() => {
  mocks.control.mockReset().mockResolvedValue(true)
})

describe('普通会话的桌面暂停续接', () => {
  it('设备重启空闲后仍显示持久暂停原因，用户点击才继续', async () => {
    const wrapper = mount(DesktopControlStatus, { props: { threadId: 'thread', pause } })
    expect(wrapper.text()).toContain('用户已接管')
    expect(wrapper.text()).toContain('继续任务')
    expect(mocks.control).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click')
    expect(mocks.control).toHaveBeenCalledWith('resume')
    expect(wrapper.emitted('resumeTask')).toEqual([[{ threadId: 'thread', callId: 'open' }]])
    wrapper.unmount()
  })

  it('桌面恢复失败时不启动下一段 ReAct', async () => {
    mocks.control.mockResolvedValue(false)
    const wrapper = mount(DesktopControlStatus, { props: { threadId: 'thread', pause } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('resumeTask')).toBeUndefined()
    wrapper.unmount()
  })

  it('正在生成时禁止重复续接', async () => {
    const wrapper = mount(DesktopControlStatus, {
      props: { threadId: 'thread', pause, busy: true },
    })
    await wrapper.get('button').trigger('click')
    expect(mocks.control).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
