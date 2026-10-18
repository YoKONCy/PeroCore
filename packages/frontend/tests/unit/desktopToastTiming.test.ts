// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TaskToast from '@infos/frontend/components/taskCenter/TaskToast.vue'
import type { TaskToastItem } from '@infos/frontend/components/taskCenter'

const toast: TaskToastItem = {
  id: 'task-1',
  type: 'task_completed',
  title: '完成',
  message: '工作已完成',
  createdAt: 1,
}
afterEach(() => {
  vi.useRealTimers()
})

describe('通知层的任务计时', () => {
  it('镜像层不启动第二份自动关闭计时器', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const wrapper = mount(TaskToast, { props: { toast, onDismiss: dismiss, autoDismiss: false } })
    vi.advanceTimersByTime(10_000)
    expect(dismiss).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('通知层悬停可暂停主窗口计时，结束后恢复', async () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const wrapper = mount(TaskToast, { props: { toast, onDismiss: dismiss } })
    vi.advanceTimersByTime(2000)
    await wrapper.setProps({ paused: true })
    vi.advanceTimersByTime(10_000)
    expect(dismiss).not.toHaveBeenCalled()
    await wrapper.setProps({ paused: false })
    vi.advanceTimersByTime(5000)
    expect(dismiss).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('进度通知变为完成后恢复普通通知的关闭行为', async () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const wrapper = mount(TaskToast, {
      props: { toast: { ...toast, type: 'task_progress' }, onDismiss: dismiss },
    })
    vi.advanceTimersByTime(10_000)
    expect(dismiss).not.toHaveBeenCalled()
    await wrapper.setProps({ toast })
    await nextTick()
    vi.advanceTimersByTime(5000)
    expect(dismiss).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
