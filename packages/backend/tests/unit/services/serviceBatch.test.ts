import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSendParams,
  checkIsMentioned,
  cleanCQCodes,
  extractAttachments,
  toOneBotSegments,
} from '@perocore/backend/extensions/adapters/napcat/napcatParser'
import { ModelService } from '@perocore/backend/services/model/modelService'
import { SchedulerService } from '@perocore/backend/services/scheduler/schedulerService'
import { BackgroundScheduler } from '@perocore/backend/services/scheduler/backgroundScheduler'

function createModel(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: '主模型',
    modelId: 'gpt-4o',
    provider: 'openai',
    providerType: 'llm',
    apiKey: 'sk-1234567890',
    apiBase: null,
    temperature: 0.7,
    topP: null,
    maxTokens: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    ...overrides,
  }
}

function createModelService(models = [createModel()]) {
  const store = new Map(models.map((model) => [Number(model.id), model]))
  const repo = {
    findAll: vi.fn(() => Promise.resolve([...store.values()])),
    findById: vi.fn((id: number) => Promise.resolve(store.get(id) ?? null)),
    create: vi.fn((data: Record<string, unknown>) => {
      const model = createModel({ id: 2, ...data })
      store.set(2, model)
      return Promise.resolve(model)
    }),
    update: vi.fn((id: number, data: Record<string, unknown>) => {
      const model = createModel({ id, ...(store.get(id) ?? {}), ...data })
      store.set(id, model)
      return Promise.resolve(model)
    }),
    deleteById: vi.fn((id: number) => {
      store.delete(id)
      return Promise.resolve()
    }),
  }
  const llmService = {
    listModels: vi.fn(() => Promise.resolve(['gpt-4o', 'gpt-4.1'])),
    chat: vi.fn(() =>
      Promise.resolve({
        choices: [
          { message: { content: 'OK，这是一段很长的模型响应内容，用于验证截断行为。'.repeat(3) } },
        ],
      }),
    ),
  }
  const registry = { invalidateCache: vi.fn() }
  return {
    service: new ModelService(repo as never, llmService as never, registry as never),
    repo,
    llmService,
    registry,
  }
}

function createSchedulerDb(rows: Array<Record<string, unknown>> = []) {
  const dueRows = [...rows]
  const insertedRows: Array<Record<string, unknown>> = []
  const updatedIds: unknown[] = []
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((value: Record<string, unknown>) => ({
        returning: vi.fn(() => {
          const row = { id: 10, createdAt: '2026-01-01', ...value }
          insertedRows.push(row)
          return Promise.resolve([row])
        }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          all: vi.fn(() => Promise.resolve(dueRows)),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn((condition: unknown) => {
          updatedIds.push(condition)
          return {
            returning: vi.fn(() => Promise.resolve(dueRows.length > 0 ? [dueRows[0]] : [])),
          }
        }),
      })),
    })),
  }
  return { db, insertedRows, updatedIds }
}

describe('NapCat 消息解析器', () => {
  it('应当清洗 CQ 码为可读文本', () => {
    const content =
      '你好[CQ:image,summary=猫猫][CQ:file,name=报告.pdf][CQ:face,id=1][CQ:at,qq=100,name=主人][CQ:reply,id=1][CQ:unknown,x=1]'

    const result = cleanCQCodes(content)

    expect(result).toBe('你好[猫猫][文件: 报告.pdf][表情]@主人')
  })

  it('应当提取附件并判断是否提到了机器人', () => {
    const segments = [
      { type: 'image', data: { url: 'https://example.com/a.png', file: 'a.png' } },
      { type: 'file', data: { url: 'https://example.com/a.zip', name: 'a.zip' } },
      { type: 'at', data: { qq: 42 } },
    ]

    expect(extractAttachments(segments)).toEqual([
      { type: 'image', url: 'https://example.com/a.png', name: 'a.png' },
      { type: 'file', url: 'https://example.com/a.zip', name: 'a.zip' },
    ])
    expect(checkIsMentioned(segments, '42')).toBe(true)
    expect(checkIsMentioned(segments, '43')).toBe(false)
  })

  it('应当把出站内容和附件转换为 OneBot 消息段与发送参数', () => {
    const segments = toOneBotSegments('你好', [
      { type: 'sticker', localPath: 'C:\\sticker\\开心.png' },
      { type: 'image', url: 'https://example.com/a.jpg' },
    ])

    expect(segments).toEqual([
      { type: 'text', data: { text: '你好' } },
      {
        type: 'image',
        data: { file: 'file:///C:/sticker/开心.png', subType: 1, summary: '[表情]' },
      },
      { type: 'image', data: { file: 'https://example.com/a.jpg' } },
    ])
    expect(buildSendParams('123', 'group', segments)).toEqual({ group_id: 123, message: segments })
    expect(buildSendParams('456', 'private', segments)).toEqual({ user_id: 456, message: segments })
  })
})

describe('ModelService', () => {
  it('应当列出与获取模型并遮蔽 API Key', async () => {
    const { service } = createModelService([createModel(), createModel({ id: 2, apiKey: 'short' })])

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: 1, apiKey: 'sk-1****7890' }),
      expect.objectContaining({ id: 2, apiKey: '****' }),
    ])
    await expect(service.getById(1)).resolves.toMatchObject({ id: 1, apiKey: 'sk-1****7890' })
  })

  it('应当在创建、更新和删除模型后失效缓存', async () => {
    const { service, repo, registry } = createModelService()

    await expect(
      service.create({ name: '新模型', modelId: 'gpt-new', apiKey: null } as never),
    ).resolves.toMatchObject({
      id: 2,
      apiKey: '',
    })
    await expect(service.update(1, { apiKey: 'abcdefghi' } as never)).resolves.toMatchObject({
      apiKey: 'abcd****fghi',
    })
    await expect(service.delete(1)).resolves.toBeUndefined()

    expect(repo.deleteById).toHaveBeenCalledWith(1)
    expect(registry.invalidateCache).toHaveBeenCalledTimes(3)
  })

  it('应当把缺失模型和远程调用失败映射为业务错误', async () => {
    const { service, llmService } = createModelService([])
    llmService.listModels.mockRejectedValueOnce(new Error('网络失败'))

    await expect(service.getById(99)).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })
    await expect(service.update(99, {} as never)).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })
    await expect(service.delete(99)).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })
    await expect(
      service.listRemoteModels({ provider: 'openai', apiKey: 'key' }),
    ).rejects.toMatchObject({ code: 'LLM_ERROR' })
  })

  it('应当列出远程模型并测试模型连通性', async () => {
    const { service, llmService } = createModelService()

    await expect(
      service.listRemoteModels({ provider: 'openai', apiKey: 'key', apiBase: 'base' }),
    ).resolves.toEqual(['gpt-4o', 'gpt-4.1'])
    const result = await service.test(1)

    expect(llmService.listModels).toHaveBeenCalledWith({
      provider: 'openai',
      modelId: '',
      apiKey: 'key',
      apiBase: 'base',
    })
    expect(llmService.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        modelId: 'gpt-4o',
        temperature: 0,
        maxTokens: 10,
      }),
      [{ role: 'user', content: 'Hello, respond with OK.' }],
    )
    expect(result).toMatchObject({ success: true })
    expect(result.response!.length).toBeLessThanOrEqual(50)
  })
})

describe('SchedulerService', () => {
  it('应当创建提醒并通知前端', async () => {
    const { db } = createSchedulerDb()
    const gatewayHub = { pushNotification: vi.fn().mockResolvedValue(undefined) }
    const service = new SchedulerService(db as never, gatewayHub as never)

    const reminder = await service.create({ time: '2026-01-01T00:00:00.000Z', content: '喝水' })

    expect(reminder).toMatchObject({
      id: 10,
      type: 'reminder',
      content: '喝水',
      agentId: 'pero',
      isTriggered: false,
    })
    expect(gatewayHub.pushNotification).toHaveBeenCalledWith({ title: '提醒已设置', body: '喝水' })
  })

  it('应当列出待触发任务并支持取消', async () => {
    const row = {
      id: 1,
      type: 'topic',
      time: '2026-01-01',
      content: '聊天',
      isTriggered: false,
      agentId: 'pero',
      createdAt: null,
    }
    const { db } = createSchedulerDb([row])
    const service = new SchedulerService(db as never, { pushNotification: vi.fn() } as never)

    await expect(service.listPending('pero')).resolves.toEqual([row])
    await expect(service.cancel(1)).resolves.toBe(true)
  })

  it('应当按类型触发到期任务并生成 Agent 指令', async () => {
    const rows = [
      {
        id: 1,
        type: 'reminder',
        time: '2020-01-01',
        content: '喝水',
        isTriggered: false,
        agentId: 'pero',
        createdAt: null,
      },
      {
        id: 2,
        type: 'topic',
        time: '2020-01-01',
        content: '猫咪',
        isTriggered: false,
        agentId: 'pero',
        createdAt: null,
      },
      {
        id: 3,
        type: 'topic',
        time: '2020-01-01',
        content: '工作',
        isTriggered: false,
        agentId: 'pero',
        createdAt: null,
      },
      {
        id: 4,
        type: 'reaction',
        time: '2020-01-01',
        content: '发送鼓励',
        isTriggered: false,
        agentId: 'pero',
        createdAt: null,
      },
    ]
    const { db } = createSchedulerDb(rows)
    const service = new SchedulerService(db as never, { pushNotification: vi.fn() } as never)

    const results = await service.checkDueTasks('pero')

    expect(results.map((item) => item.type)).toEqual(['reminder', 'topic', 'reaction'])
    expect(results[0]!.instruction).toContain('喝水')
    expect(results[1]!.instruction).toContain('- 猫咪\n- 工作')
    expect(results[2]!.instruction).toContain('发送鼓励')
  })
})

describe('BackgroundScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当注册、启动、停止并手动触发任务', async () => {
    const scheduler = new BackgroundScheduler()
    const handler = vi.fn().mockResolvedValue(undefined)

    scheduler.register('flush', 1000, handler)
    scheduler.start()
    const triggered = await scheduler.triggerNow('flush')
    scheduler.stop()

    expect(triggered).toBe(true)
    expect(scheduler.isStarted).toBe(false)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(scheduler.getTaskNames()).toEqual(['flush'])
    expect(scheduler.getStatus()[0]).toMatchObject({
      name: 'flush',
      stats: { totalRuns: 1, successCount: 1, errorCount: 0 },
    })
  })

  it('应当记录任务失败并跳过不存在或运行中的任务', async () => {
    let release!: () => void
    const running = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new BackgroundScheduler()
    const failing = vi.fn().mockRejectedValue(new Error('失败'))
    const slow = vi.fn(() => running)

    scheduler.register('fail', 1000, failing)
    scheduler.register('slow', 1000, slow)
    await scheduler.triggerNow('fail')
    const firstSlow = scheduler.triggerNow('slow')
    const secondSlow = await scheduler.triggerNow('slow')
    release()
    await firstSlow

    expect(await scheduler.triggerNow('missing')).toBe(false)
    expect(secondSlow).toBe(false)
    expect(scheduler.getStatus().find((item) => item.name === 'fail')!.stats).toMatchObject({
      totalRuns: 1,
      successCount: 0,
      errorCount: 1,
      lastError: 'Error: 失败',
    })
  })
})
