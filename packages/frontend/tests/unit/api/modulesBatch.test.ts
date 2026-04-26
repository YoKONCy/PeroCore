import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@perocore/frontend/api/client', () => ({
  apiClient: clientMock,
}))

import { agentApi } from '@perocore/frontend/api/modules/agentApi'
import { configApi } from '@perocore/frontend/api/modules/configApi'
import { maintenanceApi } from '@perocore/frontend/api/modules/maintenanceApi'
import { memoryApi } from '@perocore/frontend/api/modules/memoryApi'
import { modelApi } from '@perocore/frontend/api/modules/modelApi'
import { schedulerApi } from '@perocore/frontend/api/modules/schedulerApi'
import { systemApi } from '@perocore/frontend/api/modules/systemApi'

describe('基础 API modules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('agentApi 应当转发 Agent 相关端点和请求体', () => {
    agentApi.list()
    agentApi.getActive()
    agentApi.setActive('pero')
    agentApi.enable('assistant')
    agentApi.disable('assistant')
    agentApi.reload()
    agentApi.getTexts('pero')

    expect(clientMock.get).toHaveBeenCalledWith('/agents')
    expect(clientMock.get).toHaveBeenCalledWith('/agents/active')
    expect(clientMock.put).toHaveBeenCalledWith('/agents/active', { agentId: 'pero' })
    expect(clientMock.post).toHaveBeenCalledWith('/agents/assistant/enable')
    expect(clientMock.post).toHaveBeenCalledWith('/agents/assistant/disable')
    expect(clientMock.post).toHaveBeenCalledWith('/agents/reload')
    expect(clientMock.get).toHaveBeenCalledWith('/agents/pero/texts')
  })

  it('configApi 应当转发单项、批量、导入导出配置端点', () => {
    configApi.get('theme')
    configApi.set('theme', 'dark')
    configApi.remove('theme')
    configApi.batch(['theme', 'language'])
    configApi.batchSet([{ key: 'theme', value: 'dark' }])
    configApi.exportAll()
    configApi.importAll({ theme: 'dark' }, false)

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

  it('memoryApi 应当正确拼接查询参数和请求体', () => {
    memoryApi.list({
      page: 2,
      pageSize: 20,
      agentId: 'pero',
      type: 'fact',
      source: 'chat',
      dateStart: '2026-04-27',
    })
    memoryApi.list()
    memoryApi.create({ content: '记忆', agentId: 'pero' })
    memoryApi.search({ query: '关键词', topK: 5 })
    memoryApi.graph()
    memoryApi.graph('assistant', 50)
    memoryApi.remove(12)
    memoryApi.remove(13, 'assistant', 'web')
    memoryApi.importStory({ text: '故事', agentId: 'pero' })

    expect(clientMock.get).toHaveBeenCalledWith(
      '/memories?page=2&pageSize=20&agentId=pero&type=fact&source=chat&dateStart=2026-04-27',
    )
    expect(clientMock.get).toHaveBeenCalledWith('/memories')
    expect(clientMock.post).toHaveBeenCalledWith('/memories', { content: '记忆', agentId: 'pero' })
    expect(clientMock.post).toHaveBeenCalledWith('/memories/search', { query: '关键词', topK: 5 })
    expect(clientMock.get).toHaveBeenCalledWith('/memories/graph?agentId=pero&limit=100')
    expect(clientMock.get).toHaveBeenCalledWith('/memories/graph?agentId=assistant&limit=50')
    expect(clientMock.delete).toHaveBeenCalledWith('/memories/12?agentId=pero&source=desktop')
    expect(clientMock.delete).toHaveBeenCalledWith('/memories/13?agentId=assistant&source=web')
    expect(clientMock.post).toHaveBeenCalledWith('/memories/import', {
      text: '故事',
      agentId: 'pero',
    })
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
