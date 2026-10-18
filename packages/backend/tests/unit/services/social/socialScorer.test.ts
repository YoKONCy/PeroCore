import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { SocialScorerService } from '@infos/social/runtime/socialScorer'
import { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'

it('社交炼化跟随 768 维配置，并在热切换后刷新零向量缓存', async () => {
  const root = mkdtempSync(join(tmpdir(), 'infos-social-dimension-'))
  const resolver = {
    resolve: (alias: string) =>
      alias === '@data' ? root : join(root, alias.slice('@data/'.length)),
  }
  const stores = new MemoryStoreRegistry(resolver as never, 768)
  const storage = {
    memoryAvailable: async () => true,
    getDataVersion: async () => 1,
    getUnsummarized: async () => [
      {
        id: 1,
        senderName: '用户',
        content: '一起研究蓝莓',
        channelType: 'group',
        channelId: '123',
      },
    ],
    markSummarized: vi.fn(async () => {}),
  }
  const llm = {
    chat: vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              new_event: { summary: '一起研究蓝莓', features: ['蓝莓'] },
              ontology_updates: [],
            }),
          },
        },
      ],
    })),
  }
  const scorer = new SocialScorerService(
    storage as never,
    stores,
    llm as never,
    async () => ({ model: '测试模型' }) as never,
    { render: () => '整理社交消息' } as never,
  )
  try {
    await scorer.processBatch('pero')
    expect(storage.markSummarized).toHaveBeenCalledWith([1])
    const first = stores.getAgentStore('pero', 'social')
    expect(first.nodeCount()).toBe(2)
    expect(first.get(first.allNodeIds()[0]!)?.vector).toHaveLength(768)
    stores.resetAllForDimension(1536)
    await scorer.processBatch('pero')
    expect(storage.markSummarized).toHaveBeenCalledTimes(2)
    const second = stores.getAgentStore('pero', 'social')
    expect(second.nodeCount()).toBe(3)
    for (const id of second.allNodeIds()) expect(second.get(id)?.vector).toHaveLength(1536)
  } finally {
    stores.closeAll()
    rmSync(root, { recursive: true, force: true })
  }
})
