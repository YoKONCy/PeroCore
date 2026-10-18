import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@infos/frontend/api/client', () => ({
  apiClient: clientMock,
}))

import { configApi } from '@infos/frontend/api/modules/configApi'
import { memoryApi } from '@infos/frontend/api/modules/memoryApi'
import { strongholdApi } from '@infos/frontend/api/modules/strongholdApi'

describe('基础 API modules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Embedding 激活应携带完整配置，配置导入保留不覆盖选项', () => {
    const activation = {
      provider: 'api' as const,
      model: 'embedding-test',
      dimension: 4,
      apiBase: 'https://embedding.test/v1',
      apiKey: 'key',
      reranker: { enabled: false },
    }
    configApi.activateEmbedding(activation)
    configApi.importAll({ theme: 'dark' }, false)

    expect(clientMock.post).toHaveBeenCalledWith('/configs/embedding/activate', activation)
    expect(clientMock.post).toHaveBeenCalledWith('/configs/import', {
      data: { theme: 'dark' },
      overwrite: false,
    })
  })

  it('strongholdApi 应当向据点消息端点发送明确角色', () => {
    strongholdApi.sendMessage('room-uuid', '检查环境', {
      senderId: 'Butler',
      role: 'system',
    })

    expect(clientMock.post).toHaveBeenCalledWith('/stronghold/rooms/room-uuid/messages', {
      content: '检查环境',
      senderId: 'Butler',
      role: 'system',
    })
  })

  it('memoryApi 应当拼接档案过滤查询与图谱快照参数', () => {
    memoryApi.archive({
      agentId: 'pero',
      query: '关键词',
      statuses: ['active', 'archived'],
      topics: ['RAG', '记忆'],
      importanceMin: 6,
      sort: 'eventAt',
      order: 'desc',
      page: 2,
      pageSize: 30,
    })
    const archive = new URL(clientMock.get.mock.calls[0]![0], 'https://infos.test')
    expect(archive.pathname).toBe('/memories')
    expect(Object.fromEntries(archive.searchParams)).toEqual({
      agentId: 'pero',
      query: '关键词',
      statuses: 'active,archived',
      topics: 'RAG,记忆',
      importanceMin: '6',
      sort: 'eventAt',
      order: 'desc',
      page: '2',
      pageSize: '30',
    })

    memoryApi.graph('pero', true, 120)
    const graph = new URL(clientMock.get.mock.calls[1]![0], 'https://infos.test')
    expect(graph.pathname).toBe('/memories/graph')
    expect(Object.fromEntries(graph.searchParams)).toEqual({
      agentId: 'pero',
      includeArchived: 'true',
      status: 'archived',
      limit: '120',
    })
  })
})
