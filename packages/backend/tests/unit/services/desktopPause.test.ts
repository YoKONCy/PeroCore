import { describe, expect, it } from 'vitest'
import {
  desktopPauseFromObservation,
  isDesktopControlInterruption,
} from '../../../src/services/execution/desktopPause'

describe('桌面暂停原因解析', () => {
  it.each([
    JSON.stringify({ success: false, error: { code: 'DESKTOP_WAITING', message: '用户已接管' } }),
    JSON.stringify({ error: '截图失败: DESKTOP_WAITING: 用户已接管' }),
    '执行失败: DESKTOP_WAITING: 用户已接管',
  ])('新旧桌面工具返回均保留真实原因', (output) => {
    expect(
      desktopPauseFromObservation({
        name: 'take_screenshot',
        output,
        isError: true,
        callId: 'screen',
      }),
    ).toMatchObject({ code: 'DESKTOP_WAITING', message: '用户已接管', callId: 'screen' })
  })

  it('短暂繁忙保留工作计划但不要求整段暂停', () => {
    const observation = {
      name: 'open_application',
      output: JSON.stringify({
        error: {
          code: 'DESKTOP_USER_BUSY',
          message: '用户正在输入',
        },
      }),
      isError: true,
    }
    expect(desktopPauseFromObservation(observation)).toBeUndefined()
    expect(isDesktopControlInterruption(observation)).toBe(true)
  })

  it('终端日志及成功工具不能伪造桌面接管', () => {
    expect(
      desktopPauseFromObservation({
        name: 'terminal_execute',
        output: 'DESKTOP_WAITING: 日志',
        isError: true,
      }),
    ).toBeUndefined()
    expect(
      desktopPauseFromObservation({
        name: 'open_application',
        output: 'DESKTOP_WAITING: 文本',
        isError: false,
      }),
    ).toBeUndefined()
  })
})
