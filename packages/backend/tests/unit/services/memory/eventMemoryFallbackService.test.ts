import { describe, expect, it, vi } from 'vitest'
import { EventMemoryFallbackService } from '@infos/backend/services/memory/eventMemoryFallbackService'

function message(id: number, pairId: string, content: string) {
  return {
    id,
    threadId: 'thread-1',
    role: id % 2 ? 'user' : 'assistant',
    content,
    rawContent: null,
    pairId,
    senderId: null,
    agentId: 'pero',
    metadataJson: '{}',
    scorerStatus: 'pending',
    revision: 0,
    timestamp: `2026-08-27T1${id}:00:00.000Z`,
    status: 'active',
  }
}

function fixture(extracted: unknown[] = []) {
  const timers = new Map<string, number>()
  const saveCoverage = vi.fn()
  const create = vi.fn(async (_input: unknown, operationId: string) => ({ id: operationId }))
  const messages = [message(1, 'pair-1', '用户消息'), message(2, 'pair-1', '助手回复')]
  const repo = {
    readTimer: vi.fn(async (key: string) => timers.get(key) ?? 0),
    checkpointTimer: vi.fn(async (key: string, value: number) => {
      timers.set(key, value)
    }),
    resetTimer: vi.fn(async (key: string) => {
      timers.set(key, 0)
    }),
    coveredPairIds: vi.fn().mockResolvedValue(new Set<string>()),
    claimCoverageRange: vi.fn().mockResolvedValue(true),
    releaseCoverageClaim: vi.fn(),
    commitCoverageUnderClaim: saveCoverage,
  }
  const threads = {
    listThreads: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'thread-1',
          agentId: 'pero',
          channel: 'desktop',
          lastMessageAt: '2026-08-27T10:00:00.000Z',
        },
      ],
      total: 1,
    }),
    queryActiveMessagePairs: vi.fn().mockResolvedValue(messages),
    findMessagesByPairIds: vi.fn().mockResolvedValue(messages),
  }
  const extractor = { extract: vi.fn().mockResolvedValue(extracted) }
  const service = new EventMemoryFallbackService(
    repo as never,
    threads as never,
    { create } as never,
    extractor as never,
    {
      agentSilenceSeconds: 60,
      threadIdleSeconds: 120,
      safeInputTokens: 24_000,
      now: (() => {
        let time = new Date('2026-08-27T12:00:00.000Z').getTime()
        return () => new Date((time += 60_000))
      })(),
    },
  )
  return { service, repo, extractor, saveCoverage, create }
}

describe('EventMemoryFallbackService动态兜底', () => {
  it('第41轮且前40轮完全未覆盖时应一次触发整批炼化', async () => {
    const { service, repo, extractor } = fixture([])
    const messages = Array.from({ length: 41 }, (_, index) =>
      message(index + 1, `pair-${index + 1}`, `第${index + 1}轮`),
    )
    const threads = (
      service as unknown as {
        threads: {
          queryActiveMessagePairs: ReturnType<typeof vi.fn>
          findMessagesByPairIds: ReturnType<typeof vi.fn>
        }
      }
    ).threads
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )

    await service.ensureContextWindowCoverage({
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      contextPairs: 40,
    })

    const expectedPairs = Array.from({ length: 40 }, (_, index) => `pair-${index + 1}`)
    expect(repo.claimCoverageRange).toHaveBeenCalledTimes(1)
    expect(repo.claimCoverageRange).toHaveBeenCalledWith(
      expect.objectContaining({ pairIds: expectedPairs }),
    )
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining(
          expectedPairs.map((pairId) => expect.objectContaining({ pairId })),
        ),
      }),
    )
    expect(
      extractor.extract.mock.calls[0]?.[0]?.messages.some(
        (item: { pairId: string }) => item.pairId === 'pair-41',
      ),
    ).toBe(false)
  })

  it('只有40轮时不应提前触发批量兜底', async () => {
    const { service, extractor } = fixture([])
    const messages = Array.from({ length: 40 }, (_, index) =>
      message(index + 1, `pair-${index + 1}`, `第${index + 1}轮`),
    )
    const threads = (
      service as unknown as {
        threads: { queryActiveMessagePairs: ReturnType<typeof vi.fn> }
      }
    ).threads
    threads.queryActiveMessagePairs.mockResolvedValue(messages)

    await service.ensureContextWindowCoverage({
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      contextPairs: 40,
    })

    expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('窗口中部分轮次已有覆盖时应整批提炼其余未覆盖轮次', async () => {
    const { service, repo, extractor } = fixture([])
    const messages = Array.from({ length: 41 }, (_, index) =>
      message(index + 1, `pair-${index + 1}`, `第${index + 1}轮`),
    )
    const threads = (
      service as unknown as {
        threads: {
          queryActiveMessagePairs: ReturnType<typeof vi.fn>
          findMessagesByPairIds: ReturnType<typeof vi.fn>
        }
      }
    ).threads
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )
    repo.coveredPairIds.mockResolvedValue(new Set(['pair-1']))

    await service.ensureContextWindowCoverage({
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      contextPairs: 40,
    })

    expect(extractor.extract).toHaveBeenCalledTimes(1)
    const extractedMessages = extractor.extract.mock.calls[0]?.[0]?.messages ?? []
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-1')).toBe(
      false,
    )
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-40')).toBe(
      true,
    )
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-41')).toBe(
      false,
    )
  })

  it('有效运行静默达到阈值后应审阅连续未覆盖区间，并用reviewed_no_event推进Coverage', async () => {
    const { service, extractor, saveCoverage, create } = fixture([])
    await service.tick(['pero'])
    await service.tick(['pero'])

    expect(extractor.extract).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'pero',
        threadId: 'thread-1',
        messages: expect.arrayContaining([expect.objectContaining({ content: '用户消息' })]),
      }),
    )
    expect(saveCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'reviewed_no_event',
        pairIds: ['pair-1'],
        eventNoteIds: [],
        mode: 'background',
      }),
      expect.stringContaining('background:'),
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('后台提取事件时应写入background来源且不重置主动静默语义', async () => {
    const draft = {
      narrative: '我和用户确认了重要事项。',
      importance: 8,
      affect: { tones: ['认真'], valence: 7, arousal: 6 },
    }
    const { service, create, saveCoverage } = fixture([draft])
    await service.tick(['pero'])
    await service.tick(['pero'])

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        narrative: draft.narrative,
        origin: expect.objectContaining({ mode: 'background', pairIds: ['pair-1'] }),
      }),
      expect.stringContaining('background:'),
      { deferCoverage: true },
    )
    expect(saveCoverage).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'event_recorded',
        eventNoteIds: expect.any(Array),
      }),
      expect.stringContaining('background:'),
    )
  })

  it('Claim冲突时不得调用后台模型', async () => {
    const { service, repo, extractor } = fixture([])
    repo.claimCoverageRange.mockResolvedValue(false)
    await service.tick(['pero'])
    await service.tick(['pero'])

    expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('被已覆盖Pair分隔的未覆盖区间不得拼接', async () => {
    const { service, repo, extractor } = fixture([])
    const messages = [
      message(1, 'pair-1', '第一段'),
      message(2, 'pair-2', '已覆盖'),
      message(3, 'pair-3', '第二段'),
    ]
    const threads = (
      service as unknown as {
        threads: {
          queryActiveMessagePairs: ReturnType<typeof vi.fn>
          findMessagesByPairIds: ReturnType<typeof vi.fn>
        }
      }
    ).threads
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )
    repo.coveredPairIds.mockResolvedValue(new Set(['pair-2']))

    await service.tick(['pero'])
    await service.tick(['pero'])

    expect(extractor.extract).toHaveBeenCalledTimes(2)
    expect(repo.claimCoverageRange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pairIds: ['pair-1'] }),
    )
    expect(repo.claimCoverageRange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pairIds: ['pair-3'] }),
    )
  })

  it('达到容量阈值时应按Pair边界切片', async () => {
    const { service, repo, extractor } = fixture([])
    const messages = [
      message(1, 'pair-1', '一'.repeat(30)),
      message(2, 'pair-2', '二'.repeat(30)),
      message(3, 'pair-3', '三'.repeat(30)),
    ]
    const internals = service as unknown as {
      threads: {
        queryActiveMessagePairs: ReturnType<typeof vi.fn>
        findMessagesByPairIds: ReturnType<typeof vi.fn>
      }
      options: { safeInputTokens: number; capacityRatio: number }
      estimatePairTokens: (
        messages: Array<{ pairId: string | null; content: string }>,
        pairIds: string[],
      ) => number
    }
    internals.options.safeInputTokens = internals.estimatePairTokens(messages, ['pair-1', 'pair-2'])
    internals.options.capacityRatio = 1
    internals.threads.queryActiveMessagePairs.mockResolvedValue(messages)
    internals.threads.findMessagesByPairIds.mockImplementation(
      async (_threadId: string, pairIds: string[]) =>
        messages.filter((item) => pairIds.includes(item.pairId)),
    )

    await service.tick(['pero'])

    expect(extractor.extract).toHaveBeenCalledTimes(2)
    expect(repo.claimCoverageRange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ pairIds: ['pair-1', 'pair-2'] }),
    )
    expect(repo.claimCoverageRange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pairIds: ['pair-3'] }),
    )
  })

  it('应根据模型上下文窗口扣除Prompt和输出预留后计算80%安全容量', async () => {
    const { service } = fixture([])
    const internals = service as unknown as {
      options: {
        safeInputTokens: number
        getModelConfig: () => Promise<{ contextWindowTokens: number; maxTokens: number }>
        reservedPromptTokens: number
        reservedOutputTokens: number
        capacityRatio: number
      }
      capacityTokens: () => Promise<number>
    }
    internals.options.safeInputTokens = 0
    internals.options.getModelConfig = async () => ({
      contextWindowTokens: 32_000,
      maxTokens: 3_000,
    })
    internals.options.reservedPromptTokens = 4_000
    internals.options.reservedOutputTokens = 2_000
    internals.options.capacityRatio = 0.8

    expect(await internals.capacityTokens()).toBe(20_000)
  })

  it('checkpoint只保存daemon有效运行累计值', async () => {
    const { service, repo } = fixture([])
    await service.tick(['pero'])
    await service.tick(['pero'])
    await service.checkpoint()

    expect(repo.checkpointTimer).toHaveBeenCalledWith('agent-silence:pero', 60)
  })
})
