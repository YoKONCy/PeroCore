import { describe, expect, it, vi } from 'vitest'
import { EventMemoryService } from '@infos/backend/services/memory/eventMemoryService'
import { ContextRnnRuntime } from '@infos/backend/services/retrieval/contextRnnRuntime'
import {
  DEFAULT_MEMORY_RUNTIME_CONFIG,
  type MemoryRuntimeConfig,
} from '@infos/backend/services/memory/memoryRuntimeConfig'

function fixture(advanced: Partial<MemoryRuntimeConfig['advanced']>) {
  const config = structuredClone(DEFAULT_MEMORY_RUNTIME_CONFIG)
  Object.assign(config.advanced, advanced)
  const note = {
    kind: 'event_note',
    id: 'note-1',
    agentId: 'pero',
    status: 'active',
    narrative: '有关检索的话题',
    eventAt: '2026-10-09T00:00:00Z',
    topics: ['检索'],
    participants: [],
  }
  const store = {
    allNodeIds: () => [1],
    get: () => ({ payload: note }),
    searchAdvanced: vi.fn(() => [{ id: 1, score: 1 }]),
    searchHybrid: vi.fn(() => [{ id: 1, score: 1 }]),
  }
  const stores = {
    getAgentStore: () => store,
    ensureTextIndexReady: () => store,
    getDimension: () => 4,
  }
  const embedOne = vi.fn().mockResolvedValue([0, 1, 0, 0])
  const rnn = {
    update: vi.fn(),
    generateBias: vi.fn(() => new Float32Array([0, 1, 0, 0])),
    trainMinGru: vi.fn(),
    updateOutputWeights: vi.fn(),
    getHiddenState: vi.fn(() => new Float32Array(4)),
    saveAll: vi.fn(),
  }
  const create = vi.fn(() => rnn as never)
  const runtime = new ContextRnnRuntime(create)
  const service = new EventMemoryService(
    {} as never,
    stores as never,
    { embedOne, isAvailable: true } as never,
  )
  service.setAdvancedRetrieval(runtime, async () => structuredClone(config))
  return { config, store, embedOne, rnn, create, runtime, service }
}

describe('自动 RAG 的 ContextRNN 开关边界', () => {
  it('基础检索不加载 RNN；高级检索关闭 RNN 时也不注册反馈轨迹', async () => {
    for (const enableSaPpr of [false, true]) {
      const { service, create, rnn } = fixture({
        enableSaPpr,
        enableContextRnn: false,
        enableFeedback: true,
      })
      await service.automaticRag('pero', '检索', 2, 'desktop', 'trace-1')
      expect(service.takeAutomaticRagTrace('trace-1')).toBeUndefined()
      await service.applyRetrievalFeedback('trace-1', '检索完成')
      expect(create).not.toHaveBeenCalled()
      expect(rnn.trainMinGru).not.toHaveBeenCalled()
    }
  })
  it('三个开关同时开启才训练，权重由后续检查点统一保存', async () => {
    const { service, create, rnn } = fixture({
      enableSaPpr: true,
      enableContextRnn: true,
      enableFeedback: true,
    })
    await service.automaticRag('pero', '检索', 2, 'desktop', 'trace-1')
    await service.applyRetrievalFeedback('trace-1', '检索完成')
    expect(create).toHaveBeenCalledTimes(1)
    expect(rnn.update).toHaveBeenCalledTimes(1)
    expect(rnn.trainMinGru).toHaveBeenCalledTimes(1)
    expect(rnn.updateOutputWeights).toHaveBeenCalledTimes(1)
    expect(rnn.saveAll).not.toHaveBeenCalled()
  })
  it('Embedding 等待期间关闭 RNN，迟到检索不能创建实例或带入偏置', async () => {
    const { service, config, create, embedOne, store } = fixture({
      enableSaPpr: true,
      enableContextRnn: true,
    })
    let resolve!: (value: number[]) => void
    embedOne.mockImplementation(
      () =>
        new Promise((value) => {
          resolve = value
        }),
    )
    const pending = service.automaticRag('pero', '检索', 2)
    await vi.waitFor(() => expect(embedOne).toHaveBeenCalledTimes(1))
    config.advanced.enableContextRnn = false
    service.syncAdvancedRetrievalConfig(config)
    resolve([0, 1, 0, 0])
    await pending
    expect(create).not.toHaveBeenCalled()
    expect(store.searchAdvanced).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ diffusionBias: undefined }),
    )
  })
  it('反馈向量等待期间关闭管线，迟到反馈不修改已释放的实例', async () => {
    const { service, config, embedOne, rnn } = fixture({
      enableSaPpr: true,
      enableContextRnn: true,
      enableFeedback: true,
    })
    await service.automaticRag('pero', '检索', 2, 'desktop', 'trace-1')
    let resolve!: (value: number[]) => void
    embedOne.mockImplementation(
      () =>
        new Promise((value) => {
          resolve = value
        }),
    )
    const pending = service.applyRetrievalFeedback('trace-1', '检索完成')
    await vi.waitFor(() => expect(embedOne).toHaveBeenCalledTimes(2))
    config.advanced.enableSaPpr = false
    service.syncAdvancedRetrievalConfig(config)
    resolve([0, 1, 0, 0])
    await pending
    expect(rnn.trainMinGru).not.toHaveBeenCalled()
    expect(rnn.updateOutputWeights).not.toHaveBeenCalled()
  })
})
