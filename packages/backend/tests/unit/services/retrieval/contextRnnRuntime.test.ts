import { describe, expect, it, vi } from 'vitest'
import { ContextRnnRuntime } from '@infos/backend/services/retrieval/contextRnnRuntime'
import { DEFAULT_MEMORY_RUNTIME_CONFIG } from '@infos/backend/services/memory/memoryRuntimeConfig'

const disabled = DEFAULT_MEMORY_RUNTIME_CONFIG.advanced
const enabled = { ...disabled, enableSaPpr: true, enableContextRnn: true }

function fixture() {
  const model = { hasDirtyChanges: false, saveAll: vi.fn() }
  const create = vi.fn(() => model as never)
  const runtime = new ContextRnnRuntime(create)
  return { model, create, runtime }
}

describe('ContextRNN 按需生命周期', () => {
  it('关闭或仅开启高级管线时不创建模型、不保存，也不派发脏检查点', () => {
    const { runtime, create, model } = fixture()
    for (const advanced of [disabled, { ...disabled, enableSaPpr: true, enableFeedback: true }]) {
      runtime.configure(advanced)
      expect(runtime.acquire(runtime.generation)).toBeUndefined()
      expect(runtime.feedbackEnabled).toBe(false)
      expect(runtime.hasPendingChanges).toBe(false)
      runtime.checkpoint()
    }
    runtime.dispose()
    expect(create).not.toHaveBeenCalled()
    expect(model.saveAll).not.toHaveBeenCalled()
  })
  it('开启开关本身不加载权重，第一次实际检索才创建且复用实例', () => {
    const { runtime, create, model } = fixture()
    runtime.configure(enabled)
    expect(create).not.toHaveBeenCalled()
    expect(runtime.peek(runtime.generation)).toBeUndefined()
    expect(runtime.acquire(runtime.generation)).toBe(model)
    expect(runtime.acquire(runtime.generation)).toBe(model)
    expect(create).toHaveBeenCalledTimes(1)
    runtime.checkpoint()
    expect(model.saveAll).not.toHaveBeenCalled()
    model.hasDirtyChanges = true
    runtime.checkpoint()
    expect(model.saveAll).toHaveBeenCalledTimes(1)
  })
  it('关闭后清理实例并使迟到请求失效，重新开启不会复用旧代次', () => {
    const { runtime, create, model } = fixture()
    runtime.configure(enabled)
    const oldGeneration = runtime.generation
    runtime.acquire(oldGeneration)
    runtime.configure(disabled)
    expect(model.saveAll).toHaveBeenCalledTimes(1)
    expect(runtime.peek(oldGeneration)).toBeUndefined()
    expect(runtime.acquire(oldGeneration)).toBeUndefined()
    runtime.configure(enabled)
    expect(runtime.acquire(oldGeneration)).toBeUndefined()
    runtime.acquire(runtime.generation)
    expect(create).toHaveBeenCalledTimes(2)
  })
  it('关闭反馈使旧反馈代次失效，不影响后续检索继续使用现有模型', () => {
    const { runtime, create, model } = fixture()
    runtime.configure({ ...enabled, enableFeedback: true })
    const oldGeneration = runtime.generation
    runtime.acquire(oldGeneration)
    runtime.configure(enabled)
    expect(runtime.feedbackEnabled).toBe(false)
    expect(runtime.peek(oldGeneration)).toBeUndefined()
    expect(runtime.acquire(runtime.generation)).toBe(model)
    expect(create).toHaveBeenCalledTimes(1)
  })
})
