import { describe, expect, it, vi } from 'vitest'
import { ScorerService } from '@perocore/backend/services/memory/scorerService'

const modelConfig = { provider: 'openai', modelId: 'scorer-model', apiKey: 'key' }

function createLog(
  id: number,
  role: 'user' | 'assistant',
  content: string,
  pairId = `p${Math.ceil(id / 2)}`,
) {
  return { id, role, content, pairId, source: 'desktop' }
}

function createService(
  options: {
    pending?: ReturnType<typeof createLog>[]
    llmContent?: string | null
    model?: typeof modelConfig | null
    embedding?: number[][]
    chatReject?: Error
    vectorReject?: boolean
  } = {},
) {
  const pending = options.pending ?? [
    createLog(1, 'user', '主人喜欢猫'),
    createLog(2, 'assistant', '猫很可爱'),
  ]
  const memoryService = {
    create: vi.fn().mockResolvedValue({ id: 99 }),
  }
  const logService = {
    getPendingForScorer: vi.fn().mockResolvedValue(pending),
    markAnalyzed: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  }
  const llmService = {
    chat: options.chatReject
      ? vi.fn().mockRejectedValue(options.chatReject)
      : vi.fn().mockResolvedValue({
          choices: [{ message: { content: options.llmContent } }],
        }),
  }
  const mdpEngine = {
    render: vi.fn().mockReturnValue('评分提示词'),
  }
  const vectorRepo = {
    indexKeyword: options.vectorReject
      ? vi.fn().mockRejectedValue(new Error('索引失败'))
      : vi.fn().mockResolvedValue(undefined),
    link: options.vectorReject
      ? vi.fn().mockRejectedValue(new Error('连边失败'))
      : vi.fn().mockResolvedValue(undefined),
  }
  const embeddingService = {
    embed: vi.fn().mockResolvedValue(
      options.embedding ?? [
        [1, 0],
        [0, 1],
      ],
    ),
  }
  const getModelConfig = vi
    .fn()
    .mockResolvedValue(options.model === undefined ? modelConfig : options.model)
  const service = new ScorerService(
    memoryService as never,
    logService as never,
    llmService as never,
    getModelConfig as never,
    mdpEngine as never,
    vectorRepo as never,
    embeddingService as never,
    { batchSize: 2, maxBatchChars: 40, dedupThreshold: 0.9, temperature: 0.2 },
  )
  return {
    service,
    memoryService,
    logService,
    llmService,
    mdpEngine,
    vectorRepo,
    embeddingService,
    getModelConfig,
  }
}

describe('ScorerService', () => {
  it('应当在待处理数量不足时不触发批处理', async () => {
    const { service, logService, llmService } = createService({
      pending: [createLog(1, 'user', '一句话')],
    })

    await service.checkAndProcess('pero')

    expect(logService.getPendingForScorer).toHaveBeenCalledWith('pero', 2)
    expect(llmService.chat).not.toHaveBeenCalled()
  })

  it('应当批量提炼记忆、写入图谱建材并标记已分析', async () => {
    const llmContent = JSON.stringify({
      content: '主人喜欢猫猫',
      tags: ['偏好', '猫'],
      importance: 8,
      sentiment: 'positive',
      memory_type: 'preference',
      entities: [{ name: '猫猫', type: 'concept' }],
      causal_refs: [7],
      topic_keys: ['宠物'],
      nearest_cluster: 'animal',
    })
    const { service, memoryService, logService, llmService, mdpEngine, vectorRepo } = createService(
      { llmContent },
    )

    await service.processBatch('pero')

    expect(mdpEngine.render).toHaveBeenCalledWith('tasks/memory/scorer/summary', {
      agent_name: 'AI',
      owner_name: '主人',
    })
    expect(llmService.chat).toHaveBeenCalledWith(
      modelConfig,
      [
        { role: 'system', content: '评分提示词' },
        { role: 'user', content: '主人: 主人喜欢猫\nAI: 猫很可爱' },
      ],
      { temperature: 0.2, responseFormat: { type: 'json_object' } },
    )
    expect(memoryService.create).toHaveBeenCalledWith({
      content: '主人喜欢猫猫',
      agentId: 'pero',
      tags: '偏好,猫',
      importance: 8,
      sentiment: 'positive',
      type: 'preference',
      source: 'desktop',
    })
    expect(vectorRepo.indexKeyword).toHaveBeenCalledWith(99, 'entity_猫猫', 'pero', 'desktop')
    expect(vectorRepo.indexKeyword).toHaveBeenCalledWith(99, 'topic_宠物', 'pero', 'desktop')
    expect(vectorRepo.link).toHaveBeenCalledWith(7, 99, 'causal', 0.6, 'pero', 'desktop')
    expect(logService.markAnalyzed).toHaveBeenCalledWith('p1', {
      sentiment: 'positive',
      importance: 8,
      memoryId: 99,
    })
  })

  it('应当对重复用户消息去重', async () => {
    const pending = [
      createLog(1, 'user', '重复问题', 'p1'),
      createLog(2, 'assistant', '回答一', 'p1'),
      createLog(3, 'user', '重复问题', 'p2'),
      createLog(4, 'assistant', '回答二', 'p2'),
    ]
    const { service, llmService, embeddingService, logService } = createService({
      pending,
      embedding: [
        [1, 0],
        [1, 0],
      ],
      llmContent: JSON.stringify({
        content: '整合结果',
        tags: [],
        importance: 5,
        sentiment: 'neutral',
        memory_type: 'event',
        entities: [],
        causal_refs: [],
        topic_keys: [],
      }),
    })

    await service.processBatch('pero')

    expect(embeddingService.embed).toHaveBeenCalledWith(['重复问题', '重复问题'])
    const userPrompt = (llmService.chat as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.[1]
      ?.content as string
    expect(userPrompt).toContain('主人: 重复问题')
    expect(userPrompt).toContain('AI: 回答一')
    expect(userPrompt).not.toContain('回答二')
    expect(logService.markAnalyzed).toHaveBeenCalledWith('p1', expect.any(Object))
    expect(logService.markAnalyzed).toHaveBeenCalledWith('p2', expect.any(Object))
  })

  it('应当在没有模型配置时跳过分析', async () => {
    const { service, llmService, memoryService } = createService({ model: null })

    await service.processBatch('pero')

    expect(llmService.chat).not.toHaveBeenCalled()
    expect(memoryService.create).not.toHaveBeenCalled()
  })

  it('应当在 LLM 未返回有效内容时标记对话已分析但不创建记忆', async () => {
    const { service, logService, memoryService } = createService({ llmContent: null })

    await service.processBatch('pero')

    expect(memoryService.create).not.toHaveBeenCalled()
    expect(logService.markAnalyzed).toHaveBeenCalledWith('p1', {})
  })

  it('应当在 LLM 或 JSON 失败时标记失败', async () => {
    const { service, logService, memoryService } = createService({
      chatReject: new Error('模型失败'),
    })

    await service.processBatch('pero')

    expect(memoryService.create).not.toHaveBeenCalled()
    expect(logService.markFailed).toHaveBeenCalledWith('p1', expect.stringContaining('模型失败'))
  })

  it('应当在 Embedding 去重失败或图谱写入失败时继续主流程', async () => {
    const llmContent = JSON.stringify({
      content: '稳定记忆',
      tags: [],
      importance: 5,
      sentiment: 'neutral',
      memory_type: 'event',
      entities: [{ name: '猫', type: 'concept' }],
      causal_refs: [1],
      topic_keys: ['主题'],
    })
    const { service, embeddingService, memoryService, logService } = createService({
      llmContent,
      vectorReject: true,
    })
    embeddingService.embed.mockRejectedValueOnce(new Error('向量失败'))

    await service.processBatch('pero')

    expect(memoryService.create).toHaveBeenCalledWith(
      expect.objectContaining({ content: '稳定记忆' }),
    )
    expect(logService.markAnalyzed).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ memoryId: 99 }),
    )
  })

  it('应当恢复未完成任务直到没有待处理项', async () => {
    const first = [createLog(1, 'user', '第一轮'), createLog(2, 'assistant', '回答')]
    const logService = {
      getPendingForScorer: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce([]),
      markAnalyzed: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
    }
    const service = new ScorerService(
      { create: vi.fn().mockResolvedValue({ id: 1 }) } as never,
      logService as never,
      {
        chat: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  content: '记忆',
                  tags: [],
                  importance: 5,
                  sentiment: 'neutral',
                  memory_type: 'event',
                  entities: [],
                  causal_refs: [],
                  topic_keys: [],
                }),
              },
            },
          ],
        }),
      } as never,
      vi.fn().mockResolvedValue(modelConfig) as never,
      { render: vi.fn().mockReturnValue('提示词') } as never,
      undefined,
      undefined,
      { batchSize: 2 },
    )

    await service.recoverPendingTasks('pero')

    expect(logService.getPendingForScorer).toHaveBeenCalledTimes(3)
  })
})
