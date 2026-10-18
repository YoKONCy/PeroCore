import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSendParams,
  checkIsMentioned,
  cleanCQCodes,
  extractAttachments,
  toOneBotSegments,
} from '@infos/social/adapters/napcat/napcatParser'
import { ModelService } from '@infos/backend/services/model/modelService'

import { KernelScheduler } from '@infos/backend/kernel/kernelScheduler'

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
  it('列表遮蔽API Key，单项详情返回编辑所需暗文', async () => {
    const { service } = createModelService([createModel(), createModel({ id: 2, apiKey: 'short' })])

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: 1, apiKey: expect.not.stringContaining('sk-1234567890') }),
      expect.objectContaining({ id: 2, apiKey: expect.not.stringContaining('short') }),
    ])
    await expect(service.getById(1)).resolves.toMatchObject({
      id: 1,
      apiKey: 'sk-1234567890',
    })
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
      apiKey: expect.not.stringContaining('abcdefghi'),
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
    // listRemoteModels 未对远程调用失败做封装，原始错误会原样向上抛出
    await expect(service.listRemoteModels({ provider: 'openai', apiKey: 'key' })).rejects.toThrow(
      '网络失败',
    )
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
      [expect.objectContaining({ role: 'user', content: expect.any(String) })],
    )
    expect(result).toMatchObject({ success: true })
  })
})

function schedulerRuntime() {
  return {
    create: vi.fn(async (input) => ({
      executionId: `execution-${Date.now()}-${Math.random()}`,
      processId: `process-${Date.now()}`,
      principalId: input.principalId,
      taskId: input.taskId,
      class: input.class,
      priority: input.priority ?? 5,
      budget: input.budget ?? {},
    })),
    start: vi.fn(),
    stateChanged: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn(),
    timeout: vi.fn(),
    fail: vi.fn(),
  }
}

describe('KernelScheduler周期计划', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('应当注册、启动、停止并手动触发任务', async () => {
    const scheduler = new KernelScheduler(schedulerRuntime() as never)
    const handler = vi.fn().mockResolvedValue(undefined)

    scheduler.registerPeriodic({
      name: 'flush',
      displayName: '刷新任务',
      description: '测试刷新任务',
      intervalMs: 1000,
      handler,
    })
    const initial = scheduler.getPeriodicScheduleStatus()[0]!
    expect(initial).toMatchObject({
      name: 'flush',
      displayName: '刷新任务',
      description: '测试刷新任务',
      lastStartedAt: null,
      lastFinishedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastOutcome: null,
      nextDueAt: Date.parse('2026-01-01T00:00:01.000Z'),
    })

    scheduler.startPeriodic()
    expect(scheduler.isPeriodicStarted).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(handler).toHaveBeenCalledTimes(1)
    scheduler.stopPeriodic()
    await vi.advanceTimersByTimeAsync(2000)
    expect(handler).toHaveBeenCalledTimes(1)
    const triggered = await scheduler.triggerPeriodicNow('flush')

    expect(triggered).toBe(true)
    expect(scheduler.isPeriodicStarted).toBe(false)
    expect(handler).toHaveBeenCalledTimes(2)
    expect(scheduler.getPeriodicScheduleNames()).toEqual(['flush'])
    expect(scheduler.getPeriodicScheduleStatus()[0]).toMatchObject({
      name: 'flush',
      lastStartedAt: Date.parse('2026-01-01T00:00:03.000Z'),
      lastFinishedAt: Date.parse('2026-01-01T00:00:03.000Z'),
      lastSuccessAt: Date.parse('2026-01-01T00:00:03.000Z'),
      lastFailureAt: null,
      lastOutcome: 'success',
      nextDueAt: Date.parse('2026-01-01T00:00:04.000Z'),
      stats: { totalRuns: 2, successCount: 2, errorCount: 0 },
    })
  })

  it('应当记录任务失败并跳过不存在或运行中的任务', async () => {
    let release!: () => void
    const running = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new KernelScheduler(schedulerRuntime() as never)
    const failing = vi.fn().mockRejectedValue(new Error('失败'))
    const slow = vi.fn(() => running)

    scheduler.registerPeriodic({
      name: 'fail',
      displayName: '失败任务',
      description: '测试失败任务',
      intervalMs: 1000,
      handler: failing,
    })
    scheduler.registerPeriodic({
      name: 'slow',
      displayName: '慢任务',
      description: '测试防重入',
      intervalMs: 1000,
      handler: slow,
    })
    await scheduler.triggerPeriodicNow('fail')
    const firstSlow = scheduler.triggerPeriodicNow('slow')
    const secondSlow = await scheduler.triggerPeriodicNow('slow')
    release()
    await firstSlow

    expect(await scheduler.triggerPeriodicNow('missing')).toBe(false)
    expect(secondSlow).toBe(false)
    const failedStatus = scheduler.getPeriodicScheduleStatus().find((item) => item.name === 'fail')
    expect(failedStatus).toMatchObject({
      lastOutcome: 'error',
      lastFailureAt: Date.parse('2026-01-01T00:00:00.000Z'),
      lastFinishedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      stats: {
        totalRuns: 1,
        successCount: 0,
        errorCount: 1,
        lastError: 'Error: KERNEL_PERIODIC_FAILED',
      },
    })

    failing.mockResolvedValueOnce(undefined)
    await scheduler.triggerPeriodicNow('fail')
    expect(
      scheduler.getPeriodicScheduleStatus().find((item) => item.name === 'fail'),
    ).toMatchObject({
      lastOutcome: 'success',
      lastSuccessAt: Date.parse('2026-01-01T00:00:00.000Z'),
      lastFailureAt: Date.parse('2026-01-01T00:00:00.000Z'),
      stats: {
        totalRuns: 2,
        successCount: 1,
        errorCount: 1,
        lastError: 'Error: KERNEL_PERIODIC_FAILED',
      },
    })
  })
})
