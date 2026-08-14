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
    }
    expect(metadata.initialPromptMessages).toEqual(initialMessages)
    expect(metadata.initialPromptMessages.some((message) => message.role === 'tool')).toBe(false)
  })

  it('拒绝用其他 Agent 身份向普通 Thread 写入消息', async () => {
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
