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

import { agentApi } from '@infos/frontend/api/modules/agentApi'
import { configApi } from '@infos/frontend/api/modules/configApi'
import { maintenanceApi } from '@infos/frontend/api/modules/maintenanceApi'
import { memoryApi } from '@infos/frontend/api/modules/memoryApi'
import { modelApi } from '@infos/frontend/api/modules/modelApi'
import { schedulerApi } from '@infos/frontend/api/modules/schedulerApi'
import { strongholdApi } from '@infos/frontend/api/modules/strongholdApi'
import { systemApi } from '@infos/frontend/api/modules/systemApi'

describe('基础 API modules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agentApi 应当转发 Agent 相关端点和请求体', () => {
    agentApi.list()
    agentApi.getActive()
    agentApi.enable('assistant')
    agentApi.disable('assistant')
    agentApi.reload()
    agentApi.getTexts('pero')

    expect(clientMock.get).toHaveBeenCalledWith('/agents')
    expect(clientMock.get).toHaveBeenCalledWith('/agents/active')
    expect(clientMock.post).toHaveBeenCalledWith('/agents/assistant/enable')
    expect(clientMock.post).toHaveBeenCalledWith('/agents/assistant/disable')
    expect(clientMock.post).toHaveBeenCalledWith('/agents/reload')
    expect(clientMock.get).toHaveBeenCalledWith('/agents/pero/texts')
  })

  it('configApi 应当转发单项、批量、导入导出和Embedding激活端点', () => {
    const activation = {
      provider: 'api' as const,
      model: 'embedding-test',
      dimension: 4,
      apiBase: 'https://embedding.test/v1',
      apiKey: 'key',
      reranker: { enabled: false },
    }
    configApi.activateEmbedding(activation)
    configApi.get('theme')
    configApi.set('theme', 'dark')
    configApi.remove('theme')
    configApi.batch(['theme', 'language'])
    configApi.batchSet([{ key: 'theme', value: 'dark' }])
    configApi.exportAll()
    configApi.importAll({ theme: 'dark' }, false)

    expect(clientMock.post).toHaveBeenCalledWith('/configs/embedding/activate', activation)
    expect(clientMock.get).toHaveBeenCalledWith('/configs/theme')
    expect(clientMock.put).toHaveBeenCalledWith('/configs', { key: 'theme', value: 'dark' })
    expect(clientMock.delete).toHaveBeenCalledWith('/configs/theme')
    expect(clientMock.post).toHaveBeenCalledWith('/configs/batch', { keys: ['theme', 'language'] })
    expect(clientMock.put).toHaveBeenCalledWith('/configs/batch', {
      items: [{ key: 'theme', value: 'dark' }],
    })
    expect(clientMock.post).toHaveBeenCalledWith('/configs/export')
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

  it('systemApi 与 maintenanceApi 应当转发系统和维护端点', () => {
    systemApi.health()
    systemApi.info()
    systemApi.openPath('C:/Pero')
    maintenanceApi.status()
    maintenanceApi.trigger('daily')
    maintenanceApi.reindex()
    maintenanceApi.reindex('assistant')

    expect(clientMock.get).toHaveBeenCalledWith('/health')
    expect(clientMock.get).toHaveBeenCalledWith('/system/info')
    expect(clientMock.post).toHaveBeenCalledWith('/system/open-path', { path: 'C:/Pero' })
    expect(clientMock.get).toHaveBeenCalledWith('/maintenance/status')
    expect(clientMock.post).toHaveBeenCalledWith('/maintenance/trigger', { task: 'daily' })
    expect(clientMock.post).toHaveBeenCalledWith('/maintenance/reindex', { agentId: 'pero' })
    expect(clientMock.post).toHaveBeenCalledWith('/maintenance/reindex', { agentId: 'assistant' })
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
    memoryApi.detail('note-1')
    memoryApi.source('note-1')
    memoryApi.graph('pero', true, 120)

    expect(clientMock.get).toHaveBeenCalledWith(
      '/memories?agentId=pero&query=%E5%85%B3%E9%94%AE%E8%AF%8D&statuses=active%2Carchived&topics=RAG%2C%E8%AE%B0%E5%BF%86&importanceMin=6&sort=eventAt&order=desc&page=2&pageSize=30',
    )
    expect(clientMock.get).toHaveBeenCalledWith('/memories/note-1')
    expect(clientMock.get).toHaveBeenCalledWith('/memories/note-1/source')
    expect(clientMock.get).toHaveBeenCalledWith(
      '/memories/graph?agentId=pero&includeArchived=true&limit=120',
    )
  })

  it('modelApi 应当转发模型配置端点', () => {
    const model = { name: '主模型', provider: 'openai', modelId: 'gpt', apiKey: 'key' }

    modelApi.list()
    modelApi.getById('main')
    modelApi.create(model)
    modelApi.update('main', { name: '新模型' })
    modelApi.remove('main')
    modelApi.test('main')
    modelApi.listRemote({ provider: 'openai', apiKey: 'key', apiBase: 'https://api.example' })

    expect(clientMock.get).toHaveBeenCalledWith('/models')
    expect(clientMock.get).toHaveBeenCalledWith('/models/main')
    expect(clientMock.post).toHaveBeenCalledWith('/models', model)
    expect(clientMock.put).toHaveBeenCalledWith('/models/main', { name: '新模型' })
    expect(clientMock.delete).toHaveBeenCalledWith('/models/main')
    expect(clientMock.post).toHaveBeenCalledWith('/models/main/test')
    expect(clientMock.post).toHaveBeenCalledWith('/models/list-remote', {
      provider: 'openai',
      apiKey: 'key',
      apiBase: 'https://api.example',
    })
  })

  it('schedulerApi 应当按 agentId 可选参数拼接提醒端点', () => {
    schedulerApi.status()
    schedulerApi.tasks()
    schedulerApi.reminders()
    schedulerApi.reminders('pero')
    schedulerApi.trigger('memory-cleanup')

    expect(clientMock.get).toHaveBeenCalledWith('/scheduler/status')
    expect(clientMock.get).toHaveBeenCalledWith('/scheduler/tasks')
    expect(clientMock.get).toHaveBeenCalledWith('/scheduler/reminders')
    expect(clientMock.get).toHaveBeenCalledWith('/scheduler/reminders?agentId=pero')
    expect(clientMock.post).toHaveBeenCalledWith('/scheduler/trigger/memory-cleanup')
  })
})
