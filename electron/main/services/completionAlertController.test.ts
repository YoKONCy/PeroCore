import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CompletionAlertController, type CompletionAlertPorts } from './completionAlertController'
import type { CompletionAlert } from '@infos/shared'

const files = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  default: {
    readFileSync: (file: string) => {
      if (!files.has(file)) throw new Error('文件不存在')
      return files.get(file)
    },
    mkdirSync: vi.fn(),
    writeFileSync: (file: string, value: string) => {
      files.set(file, value)
    },
    renameSync: (from: string, to: string) => {
      files.set(to, files.get(from)!)
      files.delete(from)
    },
  },
}))

const now = Date.parse('2026-10-14T10:00:00Z')
function alert(id = 'conversation:thread:message'): CompletionAlert {
  return {
    id,
    kind: 'conversation',
    agentId: 'pero',
    agentName: 'Pero',
    title: '动画已完成',
    completedAt: new Date(now).toISOString(),
    threadId: 'thread',
    messageId: 'message',
  }
}
function fixture(visible = false) {
  const ports: CompletionAlertPorts = {
    applicationFocused: vi.fn(() => false),
    petVisible: vi.fn(async () => visible),
    playSound: vi.fn(async () => {}),
    stopSound: vi.fn(),
    showNotification: vi.fn(),
    windowsNotificationsSupported: () => true,
    warn: vi.fn(),
    now: () => now,
  }
  return { ports, controller: new CompletionAlertController('settings.json', 'seen.json', ports) }
}
beforeEach(() => files.clear())

describe('完成提醒', () => {
  it('用户正在应用内时不发送系统通知，也不会在离开后补发', async () => {
    const { controller, ports } = fixture(false)
    vi.mocked(ports.applicationFocused).mockReturnValue(true)
    await controller.notify(alert())
    expect(ports.showNotification).not.toHaveBeenCalled()
    vi.mocked(ports.applicationFocused).mockReturnValue(false)
    expect(await controller.notify(alert())).toEqual({ accepted: false })
  })
  it('桌宠显示时只响提示音，隐藏时另外发送通知', async () => {
    const shown = fixture(true)
    await shown.controller.notify(alert('shown'))
    expect(shown.ports.playSound).toHaveBeenCalledTimes(1)
    expect(shown.ports.showNotification).not.toHaveBeenCalled()
    const hidden = fixture(false)
    await hidden.controller.notify(alert('hidden'))
    expect(hidden.ports.playSound).toHaveBeenCalledTimes(1)
    expect(hidden.ports.showNotification).toHaveBeenCalledTimes(1)
  })

  it('关闭声音仍发送通知，关闭通知仍播放声音', async () => {
    const { controller, ports } = fixture()
    controller.update({ soundEnabled: false })
    await controller.notify(alert('silent'))
    expect(ports.playSound).not.toHaveBeenCalled()
    expect(ports.stopSound).toHaveBeenCalledTimes(1)
    expect(ports.showNotification).toHaveBeenCalledTimes(1)
    expect(await controller.preview()).toBe(false)
    controller.update({ soundEnabled: true, windowsNotificationsEnabled: false })
    await controller.notify(alert('sound-only'))
    expect(ports.playSound).toHaveBeenCalledTimes(1)
    expect(ports.showNotification).toHaveBeenCalledTimes(1)
  })

  it('两个开关关闭时保持安静，重新开启不补播已处理事件', async () => {
    const { controller, ports } = fixture()
    controller.update({ soundEnabled: false, windowsNotificationsEnabled: false })
    await controller.notify(alert())
    controller.update({ soundEnabled: true, windowsNotificationsEnabled: true })
    expect(await controller.notify(alert())).toEqual({ accepted: false })
    expect(ports.playSound).not.toHaveBeenCalled()
    expect(ports.showNotification).not.toHaveBeenCalled()
  })

  it('并发重复投递与客户端重启后都不重复提醒', async () => {
    const { controller, ports } = fixture()
    await Promise.all([controller.notify(alert()), controller.notify(alert())])
    expect(ports.playSound).toHaveBeenCalledTimes(1)
    expect(ports.showNotification).toHaveBeenCalledTimes(1)
    const restarted = fixture()
    expect(await restarted.controller.notify(alert())).toEqual({ accepted: false })
    expect(restarted.ports.playSound).not.toHaveBeenCalled()
  })

  it('偏好持久化，过期事件和不支持系统通知时不会弹出通知', async () => {
    const { controller } = fixture()
    controller.update({ soundEnabled: false })
    const restored = fixture()
    expect(restored.controller.snapshot().soundEnabled).toBe(false)
    expect(
      await restored.controller.notify({
        ...alert(),
        completedAt: new Date(now - 10 * 60_000).toISOString(),
      }),
    ).toEqual({ accepted: false })
    restored.controller.update({ soundEnabled: true })
    restored.ports.windowsNotificationsSupported = () => false
    await restored.controller.notify(alert('unsupported'))
    expect(restored.ports.showNotification).not.toHaveBeenCalled()
    expect(restored.ports.playSound).toHaveBeenCalledTimes(1)
  })

  it('声音播放失败不影响已经发出的系统通知', async () => {
    const { controller, ports } = fixture()
    ports.playSound = vi.fn(async () => {
      throw new Error('音频设备不可用')
    })
    await expect(controller.notify(alert())).resolves.toEqual({ accepted: true })
    expect(ports.showNotification).toHaveBeenCalledTimes(1)
    expect(ports.warn).toHaveBeenCalledTimes(1)
  })
})
