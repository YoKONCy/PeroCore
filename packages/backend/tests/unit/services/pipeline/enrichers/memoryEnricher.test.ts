import { describe, expect, it, vi } from 'vitest'
import { MemoryEnricher } from '@perocore/backend/services/pipeline/enrichers/memoryEnricher'
import type { MemorySearchResult } from '@perocore/backend/services/memory/memorySearch'

function createResult(
  partial: Partial<MemorySearchResult> & { id: number; content: string },
): MemorySearchResult {
  return {
    id: partial.id,
    content: partial.content,
    score: partial.score ?? 0.8,
    tags: partial.tags ?? '',
    importance: partial.importance ?? 3,
    source: partial.source ?? 'desktop',
    type: partial.type ?? 'event',
    timestamp: partial.timestamp ?? 1,
  }
}

function createEnricher(results: MemorySearchResult[], flashbacks: MemorySearchResult[] = []) {
  const searchService = {
    search: vi.fn().mockResolvedValue(results),
    flashback: vi.fn().mockResolvedValue(flashbacks),
  }
  const memoryService = {
    markAccessed: vi.fn().mockResolvedValue(undefined),
  }
  const embeddingService = {
    embedOne: vi.fn(async (text: string) => {
      if (text.includes('空')) return []
      return text.includes('assistant') ? [0, 2] : text.includes('tool') ? [0, 0, 3] : [2, 0]
    }),
  }
  return {
    enricher: new MemoryEnricher(
      searchService as never,
      memoryService as never,
      embeddingService as never,
      5,
    ),
    searchService,
    memoryService,
    embeddingService,
  }
}

describe('MemoryEnricher', () => {
  it('应当在用户文本为空时返回空上下文', async () => {
    const { enricher, searchService } = createEnricher([])

    const result = await enricher.enrich({
      userText: '',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
    })

    expect(result).toEqual({ memoryContext: '', graphContext: '' })
    expect(searchService.search).not.toHaveBeenCalled()
  })

  it('应当检索记忆、过滤 entity、标记访问并生成图谱闪回', async () => {
    const hit = createResult({ id: 1, content: '猫猫喜欢晒太阳', score: 0.8765, importance: 4 })
    const entity = createResult({ id: 2, content: '实体节点', type: 'entity' })
    const flashbacks = [
      createResult({ id: 1, content: '重复命中' }),
      createResult({ id: 3, content: '关联记忆一'.repeat(10) }),
      createResult({ id: 4, content: '关联记忆二' }),
    ]
    const { enricher, searchService, memoryService } = createEnricher([hit, entity], flashbacks)

    const result = await enricher.enrich({
      userText: '猫猫',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
    })

    expect(searchService.search).toHaveBeenCalledWith({
      query: '猫猫',
      agentId: 'pero',
      source: 'desktop',
      topK: 5,
    })
    expect(memoryService.markAccessed).toHaveBeenCalledWith(1)
    expect(memoryService.markAccessed).not.toHaveBeenCalledWith(2)
    expect(searchService.flashback).toHaveBeenCalledWith(1, 'pero', 2)
    expect(result.memoryContext).toBe(
      '<memory_context>\n<memory id="1" type="event" importance="4" score="0.876">猫猫喜欢晒太阳</memory>\n</memory_context>',
    )
    expect(result.graphContext).toContain('关联思绪:')
    expect(result.graphContext).toContain('关联记忆一')
    expect(result.graphContext).toContain('关联记忆二')
    expect(result.graphContext).not.toContain('重复命中')
  })

  it('应当基于最近多角色消息构造加权查询文本并清理噪声', async () => {
    const { enricher, searchService, embeddingService } = createEnricher([])

    await enricher.enrich({
      userText: '原始问题',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
      recentMessages: [
        { role: 'user', content: '旧消息' },
        { role: 'assistant', content: 'assistant <TAG>应删除</TAG> 保留' },
        { role: 'tool', content: 'tool data:image/png;base64,abcdef 结果' },
        {
          role: 'user',
          content: 'user <!-- PERO_RAG_BLOCK_START -->隐藏<!-- PERO_RAG_BLOCK_END --> 最新',
        },
      ],
    })

    expect(embeddingService.embedOne).toHaveBeenCalledTimes(3)
    expect(searchService.search).toHaveBeenCalledWith({
      query: 'user 隐藏 最新 assistant  保留 tool [IMAGE] 结果',
      agentId: 'pero',
      source: 'desktop',
      topK: 5,
    })
  })

  it('应当在检索为空时返回未命中注释且不生成闪回', async () => {
    const { enricher, searchService } = createEnricher([])

    const result = await enricher.enrich({
      userText: '空结果',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
    })

    expect(result).toEqual({ memoryContext: '<!-- 未检索到相关记忆 -->', graphContext: '' })
    expect(searchService.flashback).not.toHaveBeenCalled()
  })

  it('应当在标记访问或闪回失败时继续返回记忆上下文', async () => {
    const hit = createResult({ id: 1, content: '保留下来的记忆' })
    const searchService = {
      search: vi.fn().mockResolvedValue([hit]),
      flashback: vi.fn().mockRejectedValue(new Error('闪回失败')),
    }
    const memoryService = {
      markAccessed: vi.fn().mockRejectedValue(new Error('标记失败')),
    }
    const embeddingService = {
      embedOne: vi.fn().mockResolvedValue([1, 2]),
    }
    const enricher = new MemoryEnricher(
      searchService as never,
      memoryService as never,
      embeddingService as never,
    )

    const result = await enricher.enrich({
      userText: '猫猫',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
    })

    expect(result.memoryContext).toContain('保留下来的记忆')
    expect(result.graphContext).toBe('')
  })

  it('应当在检索主流程失败时降级为空上下文', async () => {
    const searchService = {
      search: vi.fn().mockRejectedValue(new Error('检索失败')),
      flashback: vi.fn(),
    }
    const enricher = new MemoryEnricher(
      searchService as never,
      { markAccessed: vi.fn() } as never,
      { embedOne: vi.fn().mockResolvedValue([1]) } as never,
    )

    const result = await enricher.enrich({
      userText: '猫猫',
      agentId: 'pero',
      source: 'desktop',
      sessionId: 'session-1',
    })

    expect(result).toEqual({ memoryContext: '', graphContext: '' })
  })
})
