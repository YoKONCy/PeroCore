import { describe, expect, it } from 'vitest'
import { DEFAULT_PET_CONTROLS, pttVirtualKeys } from '../src/types/petControls'

describe('桌宠全局输入绑定', () => {
  it('默认不开启麦克风，并支持两个鼠标侧键和键盘组合', () => {
    expect(DEFAULT_PET_CONTROLS.voiceMode).toBe('off')
    expect(pttVirtualKeys('Mouse4')).toEqual([5])
    expect(pttVirtualKeys('Mouse5')).toEqual([6])
    expect(pttVirtualKeys('Ctrl+Alt+KeyV')).toEqual([0x11, 0x12, 0x56])
    expect(pttVirtualKeys('F24')).toEqual([0x87])
  })
  it('不接受任意脚本、未知键位或过长组合', () => {
    for (const binding of [
      '',
      'Mouse1',
      'F25',
      'Ctrl++KeyV',
      'Ctrl+Alt+Shift+Meta+KeyV',
      'process.exit()',
    ])
      expect(pttVirtualKeys(binding)).toBeNull()
  })
})
