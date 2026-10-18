import { afterEach, describe, expect, it, vi } from 'vitest'
import { tokenCounter } from '@infos/backend/services/tokenizer/tokenCounter'
import { MemoryBackgroundControl } from '@infos/backend/services/memory/memoryBackgroundControl'
import {
  EventMemoryFallbackService,
  type EventMemoryFallbackOptions,
} from '@infos/backend/services/memory/eventMemoryFallbackService'

afterEach(() => vi.restoreAllMocks())

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
    timestamp: new Date(2026, 7, 27, 12, 0, id).toISOString(),
    status: 'active',
  }
}

function rounds(count: number) {
  return Array.from({ length: count }, (_, index) => [
    message(index * 2 + 1, `pair-${index + 1}`, `第${index + 1}轮用户消息`),
    message(index * 2 + 2, `pair-${index + 1}`, `第${index + 1}轮助手回复`),
  ]).flat()
}

function fixture(extracted: unknown[] = [], options: EventMemoryFallbackOptions = {}) {
  let time = new Date(2026, 7, 27, 12).getTime()
  const advanceTime = (milliseconds = 60_000) => {
    time += milliseconds
  }
  const timers = new Map<string, number>()
  const operations = new Map<string, { payload: unknown }>()
  const coverage = new Set<string>()
  const saveCoverage = vi.fn(async (value: { pairIds: string[] }) => {
    value.pairIds.forEach((id) => coverage.add(id))
  })
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
    advanceTimer: vi.fn(async (key: string, delta: number) => {
      const value = (timers.get(key) ?? 0) + delta
      timers.set(key, value)
      return value
    }),
    memoryScheduleTime: vi.fn(async (key: string) => timers.get(`schedule:${key}`) ?? 0),
    setMemoryScheduleTime: vi.fn(async (key: string, value: number) => {
      timers.set(`schedule:${key}`, value)
    }),
    coveredPairIds: vi.fn(async () => new Set(coverage)),
    claimCoverageRange: vi.fn().mockResolvedValue(true),
    releaseCoverageClaim: vi.fn(),
    commitCoverageUnderClaim: saveCoverage,
    findOperation: vi.fn(async (id: string) => operations.get(id)),
    createOperation: vi.fn(
      async (id: string, _agentId: string, _operation: string, payload: unknown) => {
        if (operations.has(id)) return false
        operations.set(id, { payload })
        return true
      },
    ),
    markOperationCommitted: vi.fn(),
  }
  const threads = {
    getThread: vi.fn().mockResolvedValue({ id: 'thread-1', agentId: 'pero', status: 'active' }),
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
    queryActiveMessagePairs: vi
      .fn<() => Promise<ReturnType<typeof message>[]>>()
      .mockResolvedValue(messages),
    findMessagesByPairIds: vi.fn(
      async (_threadId: string, pairIds: string[]): Promise<ReturnType<typeof message>[]> =>
        (await threads.queryActiveMessagePairs()).filter((item) => pairIds.includes(item.pairId)),
    ),
  }
  const extractor = {
    extract: vi
      .fn<(input: { messages: ReturnType<typeof message>[] }) => Promise<unknown[]>>()
      .mockResolvedValue(extracted),
  }
  const restart = () =>
    new EventMemoryFallbackService(
      repo as never,
      threads as never,
      { create } as never,
      extractor as never,
      {
        agentSilenceSeconds: 60,
        threadIdleSeconds: 120,
        safeInputTokens: 24_000,
        now: () => new Date(time),
        ...options,
      },
    )
  return {
    service: restart(),
    repo,
    extractor,
    saveCoverage,
    create,
    threads,
    advanceTime,
    restart,
  }
}

describe('EventMemoryFallbackService动态兜底', () => {
  it('后台开关关闭时不扫描对话，重新开启后正常恢复提炼', async () => {
    const background = new MemoryBackgroundControl()
    background.setEnabled(false)
    const { service, threads, extractor } = fixture([], { background })
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(8))
    await service.tick(['pero'])
    expect(threads.listThreads).not.toHaveBeenCalled()
    expect(extractor.extract).not.toHaveBeenCalled()
    background.setEnabled(true)
    await service.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledOnce()
  })

  it('关闭期间迟到的提炼结果不能写入记忆，也不能标记原对话已覆盖', async () => {
    const background = new MemoryBackgroundControl()
    const { service, threads, extractor, create, saveCoverage, repo } = fixture([], { background })
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(8))
    let complete!: (drafts: unknown[]) => void
    extractor.extract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const processing = service.tick(['pero'])
    await vi.waitFor(() => expect(extractor.extract).toHaveBeenCalledOnce())
    background.setEnabled(false)
    complete([{ narrative: '迟到的结果' }])
    await processing
    expect(create).not.toHaveBeenCalled()
    expect(saveCoverage).not.toHaveBeenCalled()
    expect(repo.releaseCoverageClaim).toHaveBeenCalledOnce()
  })

  it('只提炼真正滑出窗口的完整旧轮次，保留窗口内的新对话', async () => {
    const { service, repo, extractor, threads } = fixture([])
    const messages = [...rounds(12), message(25, 'pair-13', '当前问题')]
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )

    await service.ensureContextWindowCoverage({
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      contextPairs: 5,
    })

    const expectedPairs = Array.from({ length: 8 }, (_, index) => `pair-${index + 1}`)
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
      extractor.extract.mock.calls[0]?.[0]?.messages.some((item: { pairId: string }) =>
        ['pair-9', 'pair-10', 'pair-11', 'pair-12', 'pair-13'].includes(item.pairId),
      ),
    ).toBe(false)
  })

  it('窗口满后连续七轮对话不应逐轮炼化，第八轮才审阅旧批次', async () => {
    const { service, extractor, threads } = fixture([])
    for (let evicted = 0; evicted <= 8; evicted++) {
      threads.queryActiveMessagePairs.mockResolvedValue(rounds(5 + evicted))
      await service.ensureContextWindowCoverage({
        agentId: 'pero',
        threadId: 'thread-1',
        channel: 'desktop',
        contextPairs: 5,
      })
      if (evicted < 8) expect(extractor.extract).not.toHaveBeenCalled()
    }
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(
      new Set(extractor.extract.mock.calls[0]![0].messages.map((item) => item.pairId)),
    ).toEqual(new Set(Array.from({ length: 8 }, (_, index) => `pair-${index + 1}`)))
  })

  it('已覆盖的旧轮次不应重提炼，窗口内对话也不能被捞入凑数', async () => {
    const { service, repo, extractor, threads } = fixture([])
    const messages = rounds(14)
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )
    repo.coveredPairIds.mockResolvedValue(new Set(['pair-1']))

    await service.ensureContextWindowCoverage({
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      contextPairs: 5,
    })

    expect(extractor.extract).toHaveBeenCalledTimes(1)
    const extractedMessages = extractor.extract.mock.calls[0]?.[0]?.messages ?? []
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-1')).toBe(
      false,
    )
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-9')).toBe(
      true,
    )
    expect(extractedMessages.some((item: { pairId: string }) => item.pairId === 'pair-10')).toBe(
      false,
    )
  })

  it('有效运行静默达到阈值后应审阅连续未覆盖区间，并用reviewed_no_event推进Coverage', async () => {
    const { service, extractor, saveCoverage, create, advanceTime } = fixture([])
    await service.tick(['pero'])
    advanceTime()
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
    const { service, create, saveCoverage, advanceTime } = fixture([draft])
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        narrative: draft.narrative,
        origin: expect.objectContaining({ mode: 'background', pairIds: ['pair-1'] }),
      }),
      expect.stringContaining('background:'),
      { deferCoverage: true, signal: expect.any(AbortSignal) },
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
    const { service, repo, extractor, advanceTime } = fixture([])
    repo.claimCoverageRange.mockResolvedValue(false)
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])

    expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('被已覆盖Pair分隔的未覆盖区间不得拼接', async () => {
    const { service, repo, extractor, threads, advanceTime } = fixture([])
    const messages = rounds(3)
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )
    repo.coveredPairIds.mockResolvedValue(new Set(['pair-2']))

    await service.tick(['pero'])
    advanceTime()
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

  it('按公开模型容量分批且保持每个 Pair 完整和所有正文不丢失', async () => {
    // 此处验证容量分批，Tokenizer 本身由独立用例覆盖。
    vi.spyOn(tokenCounter, 'countTokens').mockImplementation((text) => text.length)
    const { service, threads, extractor } = fixture([], {
      safeInputTokens: 0,
      getModelConfig: async () => ({
        provider: 'openai',
        modelId: 'test',
        apiKey: '',
        contextWindowTokens: 320,
        maxTokens: 30,
      }),
      reservedPromptTokens: 40,
      reservedOutputTokens: 20,
      capacityRatio: 0.8,
    })
    const messages = Array.from({ length: 6 }, (_, index) =>
      message(index + 1, 'pair-' + Math.floor(index / 2), `记录${index + 1}：${'记忆'.repeat(30)}`),
    )
    threads.queryActiveMessagePairs.mockResolvedValue(messages)
    threads.findMessagesByPairIds.mockImplementation(async (_threadId: string, pairIds: string[]) =>
      messages.filter((item) => pairIds.includes(item.pairId)),
    )
    await service.tick(['pero'])
    const batches = extractor.extract.mock.calls.map(([input]) => input.messages)
    expect(batches.length).toBeGreaterThan(1)
    expect(batches.flat().map((item) => item.content)).toEqual(messages.map((item) => item.content))
    for (let pair = 0; pair < 3; pair++) {
      const containing = batches.filter((batch) =>
        batch.some((item) => item.pairId === 'pair-' + pair),
      )
      expect(containing).toHaveLength(1)
      expect(containing[0]!.filter((item) => item.pairId === 'pair-' + pair)).toHaveLength(2)
    }
    // (320 - 40 - max(20, 30)) × 0.8 = 200。
    for (const batch of batches)
      expect(
        batch.reduce((sum, item) => sum + tokenCounter.countTokens(item.content), 0),
      ).toBeLessThanOrEqual(200)
  })

  it('主动写记忆重置计时后，下一轮累加不能恢复旧的静默时间', async () => {
    const { service, repo, extractor, advanceTime } = fixture([], {
      agentSilenceSeconds: 120,
      threadIdleSeconds: 10_000,
    })
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    await repo.resetTimer('agent-silence:pero')
    advanceTime()
    await service.tick(['pero'])
    expect(await repo.readTimer('agent-silence:pero')).toBe(60)
    expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('无事件审阅也进入冷却，重启服务后新的一轮对话不会立即再炼化', async () => {
    const { service, restart, extractor, threads, advanceTime } = fixture([])
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(2))
    advanceTime()
    const restarted = restart()
    await restarted.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    advanceTime(60 * 60_000)
    await restarted.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(2)
  })

  it('失败退避跨服务重启保留，冷却期间新对话不能绕过它', async () => {
    const { service, restart, extractor, threads, advanceTime, saveCoverage } = fixture([])
    extractor.extract.mockRejectedValueOnce(new Error('模型暂不可用'))
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    expect(saveCoverage).not.toHaveBeenCalled()
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(2))
    advanceTime()
    const restarted = restart()
    await restarted.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    advanceTime(5 * 60_000)
    await restarted.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(2)
    expect(saveCoverage).toHaveBeenCalled()
  })

  it('尚未收到助手回复的轮次不能提炼或标记覆盖', async () => {
    const { service, extractor, saveCoverage, threads, advanceTime } = fixture([])
    threads.queryActiveMessagePairs.mockResolvedValue([message(1, 'pair-1', '还在等待回复')])
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    expect(extractor.extract).not.toHaveBeenCalled()
    expect(saveCoverage).not.toHaveBeenCalled()
  })

  it('提炼期间消息被编辑时必须放弃旧结果并释放占用', async () => {
    const { service, extractor, create, saveCoverage, repo, threads, advanceTime } = fixture([])
    extractor.extract.mockImplementationOnce(async () => {
      const edited = rounds(1)
      edited[0]!.content = '用户刚刚修改的问题'
      edited[0]!.revision++
      threads.queryActiveMessagePairs.mockResolvedValue(edited)
      return [{ narrative: '不应写入的旧事件' }]
    })
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    expect(create).not.toHaveBeenCalled()
    expect(saveCoverage).not.toHaveBeenCalled()
    expect(repo.releaseCoverageClaim).toHaveBeenCalled()
  })

  it('当天日界补记完成后，重启不能把下一轮对话再次当作日界任务', async () => {
    const { service, restart, extractor, threads, advanceTime } = fixture([], {
      agentSilenceSeconds: 100_000,
      threadIdleSeconds: 100_000,
    })
    advanceTime(9 * 60 * 60_000)
    await service.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(2))
    advanceTime(2 * 60 * 60_000)
    await restart().tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
  })

  it('补记模型配置不完整不能阻止当前对话继续', async () => {
    const { service, threads, extractor } = fixture([], {
      safeInputTokens: 0,
      getModelConfig: async () => null,
    })
    threads.queryActiveMessagePairs.mockResolvedValue(rounds(13))
    await expect(
      service.ensureContextWindowCoverage({
        agentId: 'pero',
        threadId: 'thread-1',
        channel: 'desktop',
        contextPairs: 5,
      }),
    ).resolves.toBeUndefined()
    expect(extractor.extract).not.toHaveBeenCalled()
  })

  it('提炼成功但记忆写入失败后应沿用原结果，不能重复调用模型', async () => {
    const { service, create, extractor, saveCoverage, advanceTime } = fixture([
      {
        narrative: '用户确认了一个需要长期保存的决定。',
        importance: 8,
        affect: { tones: [], valence: 5, arousal: 5 },
      },
    ])
    create.mockRejectedValueOnce(new Error('存储暂不可用'))
    await service.tick(['pero'])
    advanceTime()
    await service.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(saveCoverage).not.toHaveBeenCalled()
    advanceTime(5 * 60_000)
    await service.tick(['pero'])
    expect(extractor.extract).toHaveBeenCalledTimes(1)
    expect(saveCoverage).toHaveBeenCalled()
  })
})
