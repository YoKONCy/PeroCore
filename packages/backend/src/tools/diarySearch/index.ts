/**
 * search_diary — 日记查找工具
 *
 * 允许 Agent 搜索历史日记，支持两种模式：
 * 1. 语义检索 (query) — 通过 embedding 向量匹配最相关的日记
 * 2. 精确日期 (date) — 直接按日期查找指定天的日记
 *
 * 日记存储在 shared/diary.tdb 中，由 DiaryEngine 每日 23:00 生成。
 *
 * @module packages/backend/src/tools/diarySearch
 */

import type { BuiltinTool } from '../index'
import type { VectorRepository } from '../../repositories/vector.repo'
import type { EmbeddingProvider } from '../../services/embedding/embeddingService'
import type { MemoryStoreRegistry } from '../../repositories/storeRegistry'

/** 模块引用 */
let _vectorRepo: VectorRepository | null = null
let _embeddingService: EmbeddingProvider | null = null
let _storeRegistry: MemoryStoreRegistry | null = null

/** 设置日记查找依赖 */
export function setDiarySearchDeps(deps: {
  vectorRepo: VectorRepository
  embeddingService: EmbeddingProvider
  storeRegistry: MemoryStoreRegistry
}): void {
  _vectorRepo = deps.vectorRepo
  _embeddingService = deps.embeddingService
  _storeRegistry = deps.storeRegistry
}

/** 日记 payload 结构 */
interface DiaryPayload {
  type: string
  date: string
  agentId: string
  diary: string
  mood: string
  highlights: string[]
  entities: Array<{ name: string; type: string }>
  relations: Array<{ from: string; to: string; label: string; weight: number }>
}

export const searchDiaryTool: BuiltinTool = {
  definition: {
    name: 'search_diary',
    description:
      '搜索历史日记。可以按关键词语义查找，也可以按日期查找。' +
      '当主人问「之前某天发生了什么」「上次聊过XX」「最近的日记」等场景时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '搜索关键词或问题 (语义检索)。例如「和主人讨论过美食的日子」「心情不好的时候」',
        },
        date: {
          type: 'string',
          description: '精确日期 (ISO 格式 YYYY-MM-DD)。例如 2026-04-25',
        },
        limit: {
          type: 'number',
          description: '最多返回条数 (默认 5，最大 20)',
        },
      },
    },
  },

  async execute(args, ctx) {
    if (!_vectorRepo || !_embeddingService || !_storeRegistry) {
      return JSON.stringify({ error: '日记服务未初始化' })
    }

    const query = args.query as string | undefined
    const date = args.date as string | undefined
    const limit = Math.min(Math.max((args.limit as number) ?? 5, 1), 20)

    // 模式 1: 按精确日期查找
    if (date) {
      return await searchByDate(date, ctx.agentId)
    }

    // 模式 2: 语义检索
    if (query) {
      return await searchBySemantic(query, limit)
    }

    // 无参数 — 返回最近的日记
    return await listRecentDiaries(limit, ctx.agentId)
  },
}

/** 按日期精确查找 */
async function searchByDate(date: string, agentId: string): Promise<string> {
  const store = _storeRegistry!.getDiaryStore()
  const allIds = store.allNodeIds()

  const results: DiaryPayload[] = []
  for (const id of allIds) {
    const node = store.get(id)
    if (!node) continue
    const payload = node.payload as unknown as DiaryPayload
    if (payload?.type !== 'diary') continue
    if (payload.date === date && payload.agentId === agentId) {
      // 可选：只返回匹配 agentId 的日记，或全部
      results.push(payload)
    }
  }

  if (results.length === 0) {
    return JSON.stringify({
      found: false,
      message: `${date} 没有找到日记记录`,
    })
  }

  return JSON.stringify({
    found: true,
    total: results.length,
    entries: results.map(formatDiaryEntry),
  })
}

/** 语义检索 */
async function searchBySemantic(query: string, limit: number): Promise<string> {
  // 生成查询向量
  const queryVector = await _embeddingService!.embedOne(query)
  if (!queryVector?.length) {
    return JSON.stringify({ error: '查询向量生成失败' })
  }

  // 在 diary.tdb 中语义检索
  const hits = await _vectorRepo!.searchDiary(queryVector, limit)

  if (hits.length === 0) {
    return JSON.stringify({
      found: false,
      message: `没有找到与「${query}」相关的日记`,
    })
  }

  const entries = hits
    .map((hit) => {
      const payload = hit.payload as unknown as DiaryPayload
      if (payload?.type !== 'diary') return null
      return {
        ...formatDiaryEntry(payload),
        relevance: Math.round(hit.score * 100) / 100,
      }
    })
    .filter(Boolean)

  return JSON.stringify({
    found: true,
    total: entries.length,
    query,
    entries,
  })
}

/** 列出最近日记 (按日期倒序) */
async function listRecentDiaries(limit: number, agentId: string): Promise<string> {
  const store = _storeRegistry!.getDiaryStore()
  const allIds = store.allNodeIds()

  const allDiaries: DiaryPayload[] = []
  for (const id of allIds) {
    const node = store.get(id)
    if (!node) continue
    const payload = node.payload as unknown as DiaryPayload
    if (payload?.type !== 'diary') continue
    if (payload.agentId !== agentId) continue
    allDiaries.push(payload)
  }

  // 按日期倒序排列
  allDiaries.sort((a, b) => b.date.localeCompare(a.date))

  const entries = allDiaries.slice(0, limit)

  if (entries.length === 0) {
    return JSON.stringify({
      found: false,
      message: '还没有日记记录呢，等我先写几篇吧~',
    })
  }

  return JSON.stringify({
    found: true,
    total: entries.length,
    entries: entries.map(formatDiaryEntry),
  })
}

/** 格式化日记条目 (给 LLM 阅读) */
function formatDiaryEntry(p: DiaryPayload) {
  return {
    date: p.date,
    agentId: p.agentId,
    mood: p.mood,
    diary: p.diary,
    highlights: p.highlights,
    entities: p.entities.map((e) => `${e.name}(${e.type})`),
  }
}
