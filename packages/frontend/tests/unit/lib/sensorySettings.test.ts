import { describe, expect, it } from 'vitest'
import { resolveSavedMotionLevel } from '../../../src/lib/sensorySettings'

describe('新用户动效默认值与旧配置兼容', () => {
  it('批量配置把不存在的值返回为 null 时，仍然默认完整动效', () => {
    expect(resolveSavedMotionLevel(null, null)).toBe('full')
    expect(resolveSavedMotionLevel(undefined, undefined)).toBe('full')
    expect(resolveSavedMotionLevel('', '')).toBe('full')
  })

  it('只识别明确的旧配置，优先保留新配置中的主动选择', () => {
    expect(resolveSavedMotionLevel(null, 'true')).toBe('full')
    expect(resolveSavedMotionLevel(null, 'false')).toBe('off')
    expect(resolveSavedMotionLevel('reduced', 'false')).toBe('reduced')
    expect(resolveSavedMotionLevel('off', null)).toBe('off')
    expect(resolveSavedMotionLevel(null, '无效值')).toBe('full')
  })
})
