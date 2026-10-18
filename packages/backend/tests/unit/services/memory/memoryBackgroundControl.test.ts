import { describe, expect, it } from 'vitest'
import { MemoryBackgroundControl } from '@infos/backend/services/memory/memoryBackgroundControl'

describe('长记忆后台开关', () => {
  it('关闭会中止旧信号，重新开启不能复活旧任务', () => {
    const policy = new MemoryBackgroundControl()
    const original = policy.signal
    policy.setEnabled(false)
    expect(policy.enabled).toBe(false)
    expect(original.aborted).toBe(true)
    policy.setEnabled(true)
    expect(policy.enabled).toBe(true)
    expect(policy.signal).not.toBe(original)
    expect(policy.signal.aborted).toBe(false)
    expect(original.aborted).toBe(true)
  })

  it('重复保存相同值不会打断正在运行的任务', () => {
    const policy = new MemoryBackgroundControl()
    const original = policy.signal
    policy.setEnabled(true)
    expect(policy.signal).toBe(original)
    expect(original.aborted).toBe(false)
  })
})
