import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  KnowledgeIndex,
  knowledgeEmbeddingKey,
} from '@infos/backend/services/knowledge/knowledgeIndex'
import { tokenCounter } from '@infos/backend/services/tokenizer/tokenCounter'
import type { EmbeddingService } from '@infos/backend/services/embedding/embeddingService'
import type {
  KnowledgeRepository,
  KnowledgeDocumentRow,
  KnowledgePartRow,
} from '@infos/backend/repositories/knowledge.repo'
import type { MemoryStoreRegistry } from '@infos/backend/repositories/storeRegistry'

const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture(
  bodies: string[],
  {
    vectors = false,
    bm25 = [],
    vector = [],
  }: {
    vectors?: boolean
    bm25?: number[]
    vector?: number[]
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'infos-knowledge-search-'))
  temporaryDirectories.push(directory)
  const embedding = {
    isAvailable: vectors,
    getConfig: () => ({
      apiBase: 'https://embedding.example/v1',
      model: 'summary-model',
      dimension: 2,
    }),
    getDimension: () => 2,
    embedOne: vi.fn().mockResolvedValue([1, 0]),
  } as unknown as EmbeddingService
  const key = knowledgeEmbeddingKey(embedding)
  const entries = bodies.map((body, i) => {
    const document: KnowledgeDocumentRow = {
      id: `doc-${i + 1}`,
      title: `资料 ${i + 1}`,
      sourceKind: 'text',
      source: '',
      content: body,
      contentHash: 'hash',
      tokenCount: tokenCounter.countTokens(body),
      revision: 1,
      status: 'ready',
      vectorStatus: vectors ? 'ready' : 'skipped',
      modelName: 'organizer',
      error: null,
      createdAt: '',
      updatedAt: '',
    }
    const part: KnowledgePartRow = {
      id: i + 1,
      documentId: document.id,
      ordinal: 0,
      title: '参数',
      summary: '参数与使用方法。',
      keywordsJson: '["参数"]',
      startOffset: 0,
      endOffset: body.length,
      tokenCount: document.tokenCount,
      embeddingJson: vectors ? '[1,0]' : null,
      embeddingKey: vectors ? key : null,
    }
    return { document, part }
  })
  const payloads = new Map<number, Record<string, unknown>>()
  // 数据库版本与索引快照独立，不能靠共享对象让旧结果自动消失。
  const versions = new Map<string, { revision: number; status: string }>(
    entries.map(({ document }) => [
      document.id,
      {
        revision: document.revision,
        status: document.status,
      },
    ]),
  )
  const store = {
    allNodeIds: () => [...payloads.keys()],
    contains: (id: number) => payloads.has(id),
    delete: (id: number) => payloads.delete(id),
    upsertWithId: (id: number, _vector: number[], payload: Record<string, unknown>) =>
      payloads.set(id, payload),
    indexText: vi.fn(),
    buildTextIndex: vi.fn(),
    flush: vi.fn(),
    searchHybrid: vi.fn(() =>
      bm25.map((id, i) => ({
        id,
        score: 1 / (i + 1),
        payload: payloads.get(id),
      })),
    ),
    search: vi.fn(() => vector.map((id) => ({ id, score: 0.9, payload: payloads.get(id) }))),
  }
  const repo = {
    readyParts: () => entries,
    version: (id: string) => versions.get(id),
    generation: () => 'a'.repeat(64),
    partInfo: (part: KnowledgePartRow) => ({
      id: String(part.id),
      documentId: part.documentId,
      ordinal: part.ordinal,
      title: part.title,
      summary: part.summary,
      keywords: JSON.parse(part.keywordsJson),
      tokenCount: part.tokenCount,
      startOffset: part.startOffset,
      endOffset: part.endOffset,
    }),
  }
  const stores = { getSharedStore: () => store, getDimension: () => 2 }
  const index = new KnowledgeIndex(
    repo as unknown as KnowledgeRepository,
    stores as unknown as MemoryStoreRegistry,
    embedding,
    directory,
  )
  index.rebuild()
  return { index, versions, embedding, store }
}

describe('知识检索与原文展开', () => {
  it('多路召回去重后最多返回20项，默认只有摘要和原文节选', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1)
    const { index } = await fixture(
      Array.from({ length: 30 }, (_, i) => `第${i + 1}份参数原文。`),
      { vectors: true, bm25: ids, vector: [...ids].reverse() },
    )
    const result = await index.search({ keywords: ['参数'], limit: 20 })
    expect(result.items).toHaveLength(20)
    expect(new Set(result.items.map((item) => item.id)).size).toBe(20)
    expect(
      result.items.every((item) => item.summary && item.excerpt && item.content === undefined),
    ).toBe(true)
    expect(
      result.items.every(
        (item) => item.matchedBy.includes('bm25') && item.matchedBy.includes('vector'),
      ),
    ).toBe(true)
  })

  it('多路共同命中的资料优先，单路命中仍保留，无关资料不混入', async () => {
    const { index } = await fixture(
      ['词面候选', '语义候选', '共同候选：唯一操作规范', '完全无关的资料'],
      { vectors: true, bm25: [1, 3], vector: [2, 3] },
    )
    const result = await index.search({ keywords: ['操作规范'], regex: '唯一操作规范' })
    expect(result.items[0]?.id).toBe('3')
    expect(new Set(result.items.map((hit) => hit.id))).toEqual(new Set(['1', '2', '3']))
    expect(result.items[0]?.matchedBy).toEqual(expect.arrayContaining(['bm25', 'vector', 'regex']))
    expect(result.items.find((hit) => hit.id === '1')?.matchedBy).toEqual(['bm25'])
    expect(result.items.find((hit) => hit.id === '2')?.matchedBy).toEqual(['vector'])
  })

  it('向量服务失败时仍返回文本命中，不伪造向量匹配', async () => {
    const { index, embedding } = await fixture(['参数原文', '无关资料'], {
      vectors: true,
      bm25: [1],
      vector: [2],
    })
    vi.mocked(embedding.embedOne).mockRejectedValueOnce(new Error('服务暂不可用'))
    const result = await index.search({ keywords: ['参数'] })
    expect(result.items.map((hit) => hit.id)).toEqual(['1'])
    expect(result.items[0]?.matchedBy).toEqual(['bm25'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('ripgrep 命中位置按 UTF-8 字节转换，中文长文仍能返回正确节选', async () => {
    const { index } = await fixture(['中文'.repeat(2000) + '\n这是目标词所在的位置。'])
    const result = await index.search({ regex: '目标词' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.excerpt).toContain('这是目标词所在的位置')
    expect(result.items[0]?.matchedBy).toEqual(['regex'])
  })

  it('展开预算包含 JSON 转义，字符游标能连续读回原文', async () => {
    const body = '甲😀\\"\n'.repeat(7000)
    const { index } = await fixture([body])
    let offset = 0
    let combined = ''
    // 仅限制测试自身的循环，防止游标不前进时挂住测试进程。
    for (let page = 0; page < 20; page++) {
      const result = await index.search({ partIds: ['1'], expand: true, offset })
      expect(tokenCounter.countTokens(JSON.stringify(result))).toBeLessThanOrEqual(24_000)
      expect(result.items).toHaveLength(1)
      const hit = result.items[0]!
      expect(hit.contentOffset).toBe(offset)
      expect(hit.content?.length).toBeGreaterThan(0)
      expect(hit.content).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/)
      combined += hit.content!
      if (!hit.truncated) {
        expect(hit.nextOffset).toBeUndefined()
        break
      }
      expect(hit.nextOffset).toBeGreaterThan(offset)
      expect(hit.nextOffset).toBe(offset + hit.content!.length)
      offset = hit.nextOffset!
    }
    expect(combined).toBe(body)
  })

  it.each([
    { title: '删除', version: undefined },
    { title: '替换成就绪的新版本', version: { status: 'ready', revision: 2 } },
    { title: '变为失败状态', version: { status: 'failed', revision: 1 } },
  ])('向量请求在途时$title，不能返回旧快照', async ({ version }) => {
    const { index, versions, embedding } = await fixture(['参数原文。'], {
      vectors: true,
      bm25: [1],
      vector: [1],
    })
    let finish!: (value: number[]) => void
    vi.mocked(embedding.embedOne).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = index.search({ keywords: ['参数'] })
    if (version) versions.set('doc-1', version)
    else versions.delete('doc-1')
    finish([1, 0])
    expect((await pending).items).toHaveLength(0)
  })
})
