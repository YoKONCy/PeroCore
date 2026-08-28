import { describe, expect, it, vi } from 'vitest'
import { ConversationTurnService } from '@infos/backend/services/conversation/conversationTurnService'

describe('ConversationTurnService 初始提示词快照', () => {
  it('在 assistant 元数据中保存进入 ReAct 前的完整消息，且不包含执行期工具消息', async () => {
    const appendAssistantMessage = vi.fn().mockResolvedValue({ id: 2 })
    const initialMessages = [
      { role: 'system' as const, content: '<system>完整系统提示词</system>' },
      { role: 'user' as const, content: '当前问题' },
    ]
    const deps = {
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'nana',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage,
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: initialMessages,
          manifest: { disabledTools: [] },
        }),
      },
      agentService: {
        chatWithCompiledMessages: vi.fn().mockImplementation(async (params) => {
          params.onRawText?.('原始回复')
          params.onToolCalls?.([
            {
              name: 'update_flow_state',
              args: {},
              result: '成功',
              durationMs: 1,
              isError: false,
              callId: 'call-1',
            },
          ])
          // 模拟 ReAct 内部产生额外上下文，但不得污染持久化的初始快照。
          params.messages.push({ role: 'tool', content: '运行期工具结果' })
          return '可见回复'
        }),
      },
      attachmentService: {
        validateForBinding: vi.fn().mockResolvedValue([]),
        bind: vi.fn(),
      },
      imageUnderstandingService: { transcribe: vi.fn() },
    }
    const service = new ConversationTurnService(deps as never)

    await service.executeTurn({ threadId: 'thread-1', content: '当前问题' })

    const saved = appendAssistantMessage.mock.calls[0]![0]
    const metadata = JSON.parse(saved.metadataJson) as {
      initialPromptMessages: typeof initialMessages
      tokenUsage: { inputTokens: number; outputTokens: number }
    }
    expect(metadata.initialPromptMessages).toEqual(initialMessages)
    expect(metadata.initialPromptMessages.some((message) => message.role === 'tool')).toBe(false)
    expect(metadata.tokenUsage.inputTokens).toBeGreaterThan(0)
    expect(metadata.tokenUsage.outputTokens).toBeGreaterThan(0)
  })

  it('应为每次 Turn 建立 Execution，并将同一因果身份传给 assistant 提交', async () => {
    const descriptor = {
      executionId: 'execution-1',
      processId: 'process-1',
      principalId: 'nana',
      threadId: 'thread-1',
      channel: 'desktop',
      class: 'interactive',
      priority: 5,
      budget: {},
    }
    const create = vi.fn().mockResolvedValue(descriptor)
    const start = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn().mockResolvedValue(undefined)
    const appendAssistantMessage = vi.fn().mockResolvedValue({ id: 2 })
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'nana',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage,
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: '执行任务' }],
          manifest: { disabledTools: [] },
        }),
      },
      agentService: { chatWithCompiledMessages: vi.fn().mockResolvedValue('完成') },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
      executionRuntime: { create, start, complete, fail: vi.fn() },
    } as never)

    const result = await service.executeTurn({ threadId: 'thread-1', content: '执行任务' })

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'nana',
        threadId: 'thread-1',
        channel: 'desktop',
        class: 'interactive',
      }),
    )
    expect(start).toHaveBeenCalledWith(descriptor)
    expect(appendAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ execution: descriptor }),
    )
    expect(complete).toHaveBeenCalledWith(descriptor)
    expect(result.execution).toBe(descriptor)
  })

  it('Realm任务使用最小上下文且不写入主应用Thread', async () => {
    const appendUserMessage = vi.fn()
    const appendAssistantMessage = vi.fn()
    const compile = vi.fn().mockResolvedValue({
      messages: [{ role: 'system', content: '最小人格上下文' }],
      manifest: { disabledTools: [] },
    })
    const chatWithCompiledMessages = vi.fn().mockResolvedValue('Realm结果')
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'task-thread',
          agentId: 'pero',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage,
        appendAssistantMessage,
      },
      contextCompiler: { compile },
      agentService: { chatWithCompiledMessages },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
    } as never)

    await service.executeTurn({
      threadId: 'task-thread',
      content: '编辑文档',
      realmId: 'infos.arca',
      inputPersistence: 'ephemeral',
      outputPersistence: 'ephemeral',
    })

    expect(compile).toHaveBeenCalledWith(
      'task-thread',
      'pero',
      expect.objectContaining({ realmExecution: true, appendThreadMessages: false }),
    )
    expect(chatWithCompiledMessages).toHaveBeenCalledWith(
      expect.objectContaining({ realmId: 'infos.arca' }),
    )
    expect(appendUserMessage).not.toHaveBeenCalled()
    expect(appendAssistantMessage).not.toHaveBeenCalled()
  })

  it('回复成功持久化后才提交事件记忆草稿', async () => {
    const order: string[] = []
    const commit = vi.fn().mockImplementation(async () => {
      order.push('commit')
    })
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'nana',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage: vi.fn().mockImplementation(async () => {
          order.push('persist')
          return { id: 2, timestamp: '2026-08-27T12:00:00.000Z' }
        }),
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: '记住这件事' }],
          manifest: { disabledTools: [] },
        }),
      },
      agentService: {
        chatWithCompiledMessages: vi.fn().mockImplementation(async (params) => {
          params.onToolCalls?.([
            {
              name: 'write_event_note',
              args: { narrative: '我记住了这件事' },
              result: '已接受',
              durationMs: 1,
              isError: false,
              callId: 'call-memory',
            },
          ])
          return '好的'
        }),
      },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
      eventNoteDraftCommitter: { commit },
    } as never)

    await service.executeTurn({ threadId: 'thread-1', content: '记住这件事' })

    expect(order).toEqual(['persist', 'commit'])
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ assistantMessageId: 2 }))
  })

  it('回复持久化失败或临时回合时不提交事件记忆草稿', async () => {
    const commit = vi.fn()
    const common = {
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'nana',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage: vi.fn().mockRejectedValue(new Error('写入失败')),
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: '内容' }],
          manifest: { disabledTools: [] },
        }),
      },
      agentService: { chatWithCompiledMessages: vi.fn().mockResolvedValue('回复') },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
      eventNoteDraftCommitter: { commit },
    }
    const failed = new ConversationTurnService(common as never)
    await expect(failed.executeTurn({ threadId: 'thread-1', content: '内容' })).rejects.toThrow(
      '写入失败',
    )
    expect(commit).not.toHaveBeenCalled()

    const ephemeral = new ConversationTurnService({
      ...common,
      threadService: { ...common.threadService, appendAssistantMessage: vi.fn() },
    } as never)
    await ephemeral.executeTurn({
      threadId: 'thread-1',
      content: '内容',
      inputPersistence: 'ephemeral',
      outputPersistence: 'ephemeral',
    })
    expect(commit).not.toHaveBeenCalled()
  })

  it('仅在持久化回复后按Pair提交反馈，且反馈失败不影响回复', async () => {
    const feedback = vi.fn().mockRejectedValue(new Error('反馈训练失败'))
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'nana',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage: vi.fn().mockResolvedValue({ id: 2 }),
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: '调用记忆' }],
          manifest: { disabledTools: [] },
        }),
      },
      agentService: { chatWithCompiledMessages: vi.fn().mockResolvedValue('已使用记忆') },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
      retrievalFeedback: { applyRetrievalFeedback: feedback },
    } as never)

    const result = await service.executeTurn({ threadId: 'thread-1', content: '调用记忆' })

    expect(result.reply).toBe('已使用记忆')
    expect(feedback).toHaveBeenCalledWith(result.pairId, '已使用记忆')
  })

  it('持久化文件正文及来源信息，但不保存 ReAct 叙述、原始参数或最终回复', async () => {
    const appendAutomaticWorkContext = vi.fn().mockResolvedValue(undefined)
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-1',
          agentId: 'pero',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage: vi.fn().mockResolvedValue({ id: 1 }),
        appendAssistantMessage: vi.fn().mockResolvedValue({ id: 2 }),
      },
      contextCompiler: {
        compile: vi.fn().mockResolvedValue({
          messages: [{ role: 'user', content: '读取代码' }],
          manifest: { disabledTools: [] },
        }),
      },
      agentService: {
        chatWithCompiledMessages: vi.fn().mockImplementation(async (params) => {
          params.onToolCalls?.([
            {
              name: 'read_file',
              args: { file_path: 'src/example.ts' },
              result:
                '{"ephemeral":true,"kind":"file_read_audit","path":"src/example.ts"}',
              durationMs: 1,
              isError: false,
              callId: 'call-read',
            },
            {
              name: 'read_file',
              args: { file_path: 'src/missing.ts' },
              result: '读取失败',
              durationMs: 1,
              isError: true,
              callId: 'call-error',
            },
          ])
          params.onContentBlocks?.([
            {
              blockId: 'tool-stale',
              sequence: 1,
              kind: 'tool',
              turn: 1,
              callId: 'call-stale',
              name: 'code_search',
              args: '{"query":"旧信息"}',
              result: '压缩前的旧工具结果',
              isError: false,
            },
            {
              blockId: 'tool-update-context',
              sequence: 2,
              kind: 'tool',
              turn: 1,
              callId: 'call-update-context',
              name: 'manage_work_context',
              args: '{"action":"update"}',
              result: '工作上下文已更新',
              isError: false,
            },
            {
              blockId: 'progress',
              sequence: 3,
              kind: 'narration',
              turn: 1,
              phase: 'progress',
              content: '我先读取代码。',
            },
            {
              blockId: 'tool-read',
              sequence: 2,
              kind: 'tool',
              turn: 1,
              callId: 'call-read',
              name: 'read_file',
              args: '{"file_path":"src/example.ts"}',
              result: 'export const value = 1\n',
              isError: false,
            },
            {
              blockId: 'tool-range',
              sequence: 5,
              kind: 'tool',
              turn: 1,
              callId: 'call-range',
              name: 'read_file_range',
              args: '{"path":"src/app.py","line_start":10,"line_end":11}',
              result: JSON.stringify({
                content: 'def run():\n  return True',
                totalLines: 80,
                totalBytes: 2048,
                lineStart: 10,
                lineEnd: 11,
              }),
              isError: false,
            },
            {
              blockId: 'tool-error',
              sequence: 3,
              kind: 'tool',
              turn: 1,
              callId: 'call-error',
              name: 'read_file',
              args: '{"file_path":"src/missing.ts"}',
              result: '读取失败',
              isError: true,
            },
            {
              blockId: 'final',
              sequence: 4,
              kind: 'narration',
              turn: 2,
              phase: 'final',
              content: '读取完成。',
            },
          ])
          return '读取完成。'
        }),
      },
      attachmentService: { validateForBinding: vi.fn().mockResolvedValue([]) },
      imageUnderstandingService: { transcribe: vi.fn() },
      flowStateService: { appendAutomaticWorkContext },
    } as never)

    const result = await service.executeTurn({ threadId: 'thread-1', content: '读取代码' })

    expect(appendAutomaticWorkContext).toHaveBeenCalledWith({
      threadId: 'thread-1',
      agentId: 'pero',
      pairId: result.pairId,
      content:
        '- 文件 src/example.ts 的内容（1 行、22 字节）：\nexport const value = 1\n\n' +
        '- 文件 src/app.py 的内容（80 行、2048 字节，本次读取第 10-11 行）：\n' +
        'def run():\n  return True',
    })
    const captured = appendAutomaticWorkContext.mock.calls[0]![0].content
    expect(captured).not.toContain('ReAct')
    expect(captured).not.toContain('我先读取代码')
    expect(captured).not.toContain('read_file')
    expect(captured).not.toContain('file_path')
    expect(captured).not.toContain('file_read_audit')
    expect(captured).not.toContain('压缩前的旧工具结果')
    expect(captured).not.toContain('工作上下文已更新')
    expect(captured).not.toContain('读取失败')
    expect(captured).not.toContain('读取完成')
  })

  it('拒绝用其他Agent身份向普通Thread写入消息', async () => {
    const appendUserMessage = vi.fn()
    const service = new ConversationTurnService({
      threadService: {
        getThread: vi.fn().mockResolvedValue({
          id: 'thread-pero',
          agentId: 'pero',
          channel: 'desktop',
          disabledTools: [],
        }),
        appendUserMessage,
      },
    } as never)

    await expect(
      service.executeTurn({
        threadId: 'thread-pero',
        agentId: 'nana',
        content: '不应写入旧角色会话',
      }),
    ).rejects.toThrow('会话归属不匹配')
    expect(appendUserMessage).not.toHaveBeenCalled()
  })
})
