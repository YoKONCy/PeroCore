import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VectorWriteHelper } from './vectorWriteHelper'

type VectorRepoMock = {
  upsert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

type VectorSyncRepoMock = {
  enqueueUpsert: ReturnType<typeof vi.fn>
  enqueueDelete: ReturnType<typeof vi.fn>
}

type EmbeddingServiceMock = {
  embedOne: ReturnType<typeof vi.fn>
}

describe('VectorWriteHelper', () => {
  const vectorRepo: VectorRepoMock = {
    upsert: vi.fn(),
    delete: vi.fn(),
  }

  const vectorSyncRepo: VectorSyncRepoMock = {
    enqueueUpsert: vi.fn(),
    enqueueDelete: vi.fn(),
  }

  const embeddingService: EmbeddingServiceMock = {
    embedOne: vi.fn(),
  }

  let helper: VectorWriteHelper

  beforeEach(() => {
    vi.clearAllMocks()
    helper = new VectorWriteHelper(
      vectorRepo as never,
      vectorSyncRepo as never,
      embeddingService as never,
    )
  })

  describe('upsertWithFallback', () => {
    it('应当先生成 embedding 再写入向量仓库', async () => {
      embeddingService.embedOne.mockResolvedValue([0.1, 0.2, 0.3])
      vectorRepo.upsert.mockResolvedValue(undefined)

      await helper.upsertWithFallback({
        memoryId: 1,
        content: '今天学了做螺蛳粉',
        tags: '料理 美食',
        metadata: { importance: 3 },
        agentId: 'pero',
        source: 'desktop',
      })

      expect(embeddingService.embedOne).toHaveBeenCalledWith('料理 美食 料理 美食 今天学了做螺蛳粉')
      expect(vectorRepo.upsert).toHaveBeenCalledWith(
        1,
        [0.1, 0.2, 0.3],
        { content: '今天学了做螺蛳粉', importance: 3 },
        'pero',
        'desktop',
      )
      expect(vectorSyncRepo.enqueueUpsert).not.toHaveBeenCalled()
    })

    it('embedding 为空时应当写入补偿队列', async () => {
      embeddingService.embedOne.mockResolvedValue([])

      await helper.upsertWithFallback({
        memoryId: 7,
        content: '没有向量',
        metadata: { source: 'test' },
        agentId: 'agent-1',
        storeName: 'custom',
      })

      expect(vectorRepo.upsert).not.toHaveBeenCalled()
      expect(vectorSyncRepo.enqueueUpsert).toHaveBeenCalledWith({
        memoryId: 7,
        agentId: 'agent-1',
        embedding: [],
        payload: { source: 'test' },
        storeName: 'custom',
      })
    })

    it('向量写入失败时应当保留 embedding 并写入补偿队列', async () => {
      embeddingService.embedOne.mockResolvedValue([0.9, 0.8])
      vectorRepo.upsert.mockRejectedValue(new Error('db failed'))

      await helper.upsertWithFallback({
        memoryId: 9,
        content: '写入失败测试',
        metadata: { topic: 'fallback' },
        agentId: 'agent-9',
      })

      expect(vectorSyncRepo.enqueueUpsert).toHaveBeenCalledWith({
        memoryId: 9,
        agentId: 'agent-9',
        embedding: [0.9, 0.8],
        payload: { topic: 'fallback' },
        storeName: 'main',
      })
    })
  })

  describe('deleteWithFallback', () => {
    it('删除成功时不应写入补偿队列', async () => {
      vectorRepo.delete.mockResolvedValue(undefined)

      await helper.deleteWithFallback(11, 'agent-11', 'desktop')

      expect(vectorRepo.delete).toHaveBeenCalledWith(11, 'agent-11', 'desktop')
      expect(vectorSyncRepo.enqueueDelete).not.toHaveBeenCalled()
    })

    it('删除失败时应当写入删除补偿任务', async () => {
      vectorRepo.delete.mockRejectedValue(new Error('delete failed'))

      await helper.deleteWithFallback(12, 'agent-12')

      expect(vectorSyncRepo.enqueueDelete).toHaveBeenCalledWith({
        memoryId: 12,
        agentId: 'agent-12',
      })
    })
  })
})
