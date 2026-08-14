import { describe, expect, it, vi } from 'vitest'
import { ScorerService } from '@infos/backend/services/memory/scorerService'

const modelConfig = { provider: 'openai', modelId: 'scorer-model', apiKey: 'key' }

/**
 * 创建对话对（AIOS: 替代旧版 createLog，匹配 ThreadRepository.getPendingForScorer 返回结构）
 *
 * 返回 { userMessage, assistantMessage, pairId } 三元组，
 * 其中 userMessage / assistantMessage 是 ThreadMessageRow 的最小子集。
 * 第五阶段：新增 threadId 字段（Scorer 写候选时读取 pair.userMessage.threadId 作为 originThreadId）。
 */
function createPair(
  userId: number,
  userContent: string,
  assistantId: number,
  assistantContent: string,
  pairId = `p${Math.ceil(userId / 2)}`,
  threadId = 'thread-1',
) {
  return {
    userMessage: { id: userId, content: userContent, pairId, role: 'user' as const, threadId },
    assistantMessage: {
      id: assistantId,
      content: assistantContent,
      pairId,
      role: 'assistant' as const,
      threadId,
    },
    pairId,
  }
}

function createService(
  options: {
    pending?: ReturnType<typeof createPair>[]
    llmContent?: string | null
    model?: typeof modelConfig | null
    embedding?: number[][]
    chatReject?: Error
    vectorReject?: boolean
  } = {},
) {
  // AIOS: 默认一组对话对（user 主人喜欢猫 + assistant 猫很可爱）
  const pending = options.pending ?? [createPair(1, '主人喜欢猫', 2, '猫很可爱', 'p1')]
  // 第五阶段：memoryService 不再被 ScorerService 调用，但构造函数仍保留参数（向后兼容）
  const memoryService = {
    create: vi.fn().mockResolvedValue({ id: 99 }),
  }
  // 第五阶段：memoryCandidateRepo 是 ScorerService 写入候选的目标
  const memoryCandidateRepo = {
    create: vi.fn().mockResolvedValue({
      id: 'candidate-uuid',
      agentId: 'pero',
      source: 'thread',
      originThreadId: 'thread-1',
      summary: '',
      evidenceRefs: [],
      importance: 5,
      confidence: 0.5,
      suggestedType: 'event',
      status: 'pending',
      createdAt: new Date().toISOString(),
    }),
  }
  // AIOS: logService 已改为 threadRepo（数据源从 ConversationLog 改为 ThreadRepository）
  const threadRepo = {
    getPendingForScorer: vi.fn().mockResolvedValue(pending),
    updateScorerStatus: vi.fn().mockResolvedValue(undefined),
    listThreads: vi.fn().mockResolvedValue({ items: [], total: 0 }),
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
    isAvailable: true,
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
    threadRepo as never,
    llmService as never,
    getModelConfig as never,
    mdpEngine as never,
    memoryCandidateRepo as never,
    vectorRepo as never,
    embeddingService as never,
    { batchSize: 2, maxBatchChars: 40, dedupThreshold: 0.9, temperature: 0.2 },
  )
  return {
    service,
    memoryService,
    memoryCandidateRepo,
    threadRepo,
    llmService,
    mdpEngine,
    vectorRepo,
    embeddingService,
    getModelConfig,
  }
}

describe('ScorerService', () => {
  it('应当在待处理数量不足时不触发批处理', async () => {
    const { service, threadRepo, llmService } = createService({
      pending: [],
    })

    await service.checkAndProcess('pero')

    // AIOS(Phase5): getPendingForScorer 新增 threadId + channel 可选参数
    expect(threadRepo.getPendingForScorer).toHaveBeenCalledWith('pero', 2, undefined, undefined)
    expect(llmService.chat).not.toHaveBeenCalled()
  })

  it('应当在轮次不足但字符预算达到上限时提前触发批处理', async () => {
    const longText = '长对话'.repeat(20)
    const { service, llmService } = createService({
      pending: [createPair(1, longText, 2, longText, 'p1')],
      llmContent: JSON.stringify({
        content: '长对话摘要',
        tags: [],
        importance: 5,
        sentiment: 'neutral',
        memory_type: 'event',
        entities: [],
        causal_refs: [],
        topic_keys: [],
      }),
    })

    await service.checkAndProcess('pero', 'thread-1', 'desktop')

    expect(llmService.chat).toHaveBeenCalledOnce()
  })

  it('定时刷新应按 Thread 分批，避免不同 Channel 的原始对话混批', async () => {
    const { service, threadRepo } = createService({ pending: [] })
    threadRepo.listThreads.mockResolvedValue({
      items: [
        { id: 'desktop-1', channel: 'desktop' },
        { id: 'group-1', channel: 'group' },
      ],
      total: 2,
    })

    await service.flushPendingByThread('pero')

    expect(threadRepo.getPendingForScorer).toHaveBeenCalledWith('pero', 2, 'desktop-1', 'desktop')
    expect(threadRepo.getPendingForScorer).toHaveBeenCalledWith('pero', 2, 'group-1', 'group')
  })

  it('应当批量提炼候选、写入 memory_candidates 并标记已分析（第五阶段：不再写 memory_nodes/向量）', async () => {
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
    const {
      service,
      memoryService,
      memoryCandidateRepo,
      threadRepo,
      llmService,
      mdpEngine,
      vectorRepo,
    } = createService({ llmContent })

    await service.processBatch('pero')

    expect(mdpEngine.render).toHaveBeenCalledWith('tasks/memory/scorer/summary', {
      agent_name: 'AI',
      owner_name: '用户',
      owner_appellation: '主人',
    })
    expect(llmService.chat).toHaveBeenCalledWith(
      modelConfig,
      [
        { role: 'system', content: '评分提示词' },
        { role: 'user', content: '用户: 主人喜欢猫\nAI: 猫很可爱' },
      ],
      { responseFormat: { type: 'json_object' } },
    )
    // 第五阶段：Scorer 不再调 memoryService.create，改为调 memoryCandidateRepo.create
    expect(memoryService.create).not.toHaveBeenCalled()
    expect(memoryCandidateRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'pero',
        source: 'thread',
        originThreadId: 'thread-1',
        originMessageIds: ['1', '2'],
        summary: '主人喜欢猫猫',
        importance: 8,
        suggestedType: 'preference',
        status: 'pending',
      }),
    )
    // 第五阶段：Scorer 不再调 vectorRepo.indexKeyword（图谱建材改由 Reflection 管道负责）
    expect(vectorRepo.indexKeyword).not.toHaveBeenCalled()
    expect(vectorRepo.link).not.toHaveBeenCalled()
    // updateScorerStatus 现在用 candidateId 关联（替代旧 memoryId）
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith('p1', 'analyzed', {
      sentiment: 'positive',
      importance: 8,
      candidateId: 'candidate-uuid',
    })
  })

  it('应当对重复用户消息去重', async () => {
    const pending = [
      createPair(1, '重复问题', 2, '回答一', 'p1'),
      createPair(3, '重复问题', 4, '回答二', 'p2'),
    ]
    const { service, llmService, embeddingService, threadRepo } = createService({
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
    expect(userPrompt).toContain('用户: 重复问题')
    expect(userPrompt).toContain('AI: 回答一')
    expect(userPrompt).not.toContain('回答二')
    // AIOS: 即使去重过滤了 p2 的上下文，pairIds 仍取自原始 pending，两者都标记已分析
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith('p1', 'analyzed', expect.any(Object))
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith('p2', 'analyzed', expect.any(Object))
  })

  it('应当在没有模型配置时跳过分析', async () => {
    const { service, llmService, memoryCandidateRepo } = createService({ model: null })

    await service.processBatch('pero')

    expect(llmService.chat).not.toHaveBeenCalled()
    expect(memoryCandidateRepo.create).not.toHaveBeenCalled()
  })

  it('应当在 LLM 未返回有效内容时标记对话已分析但不创建候选', async () => {
    const { service, threadRepo, memoryCandidateRepo } = createService({ llmContent: null })

    await service.processBatch('pero')

    expect(memoryCandidateRepo.create).not.toHaveBeenCalled()
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith('p1', 'analyzed', {})
  })

  it('应当在 LLM 或 JSON 失败时标记失败', async () => {
    const { service, threadRepo, memoryCandidateRepo } = createService({
      chatReject: new Error('模型失败'),
    })

    await service.processBatch('pero')

    expect(memoryCandidateRepo.create).not.toHaveBeenCalled()
    // AIOS: markFailed 已改为 threadRepo.updateScorerStatus('failed', { error })
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith(
      'p1',
      'failed',
      expect.objectContaining({ error: expect.stringContaining('模型失败') }),
    )
  })

  it('应当在 Embedding 去重失败时继续主流程（第五阶段：不再依赖向量写入）', async () => {
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
    const { service, embeddingService, memoryCandidateRepo, threadRepo } = createService({
      llmContent,
      vectorReject: true,
    })
    embeddingService.embed.mockRejectedValueOnce(new Error('向量失败'))

    await service.processBatch('pero')

    // 第五阶段：即使 embedding 失败，候选仍应写入
    expect(memoryCandidateRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ summary: '稳定记忆' }),
    )
    expect(threadRepo.updateScorerStatus).toHaveBeenCalledWith(
      'p1',
      'analyzed',
      expect.objectContaining({ candidateId: 'candidate-uuid' }),
    )
  })

  it('应当恢复未完成任务直到没有待处理项', async () => {
    const first = [createPair(1, '第一轮', 2, '回答', 'p1')]
    const threadRepo = {
      getPendingForScorer: vi
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce([]),
      updateScorerStatus: vi.fn().mockResolvedValue(undefined),
    }
    const memoryCandidateRepo = {
      create: vi.fn().mockResolvedValue({ id: 'candidate-1' }),
    }
    const service = new ScorerService(
      threadRepo as never,
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
      memoryCandidateRepo as never,
      undefined,
      undefined,
      { batchSize: 2 },
    )

    await service.recoverPendingTasks('pero')

    expect(threadRepo.getPendingForScorer).toHaveBeenCalledTimes(3)
    // processBatch 在循环1中执行一次（调用 create 一次）；循环2因 pending 为空直接退出
    expect(memoryCandidateRepo.create).toHaveBeenCalledTimes(1)
  })
})
