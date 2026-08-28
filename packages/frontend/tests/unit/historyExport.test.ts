import { describe, expect, it } from 'vitest'
import type { ConversationMessageProjection } from '@infos/shared'
import { buildConversationMarkdown } from '../../src/utils/historyExport'

function message(): ConversationMessageProjection {
  return {
    messageId: '1',
    threadId: 'thread-1',
    role: 'assistant',
    content: '最终回答',
    rawContent: '<think>原始思考</think>最终回答',
    revision: 1,
    imageTranscription: false,
    status: 'completed',
    timestamp: '2026-08-26T12:00:00.000Z',
    contentBlocks: [
      {
        blockId: 'thinking-1',
        sequence: 1,
        kind: 'thinking',
        turn: 1,
        content: '结构化思考',
      },
      {
        blockId: 'tool-1',
        sequence: 2,
        kind: 'tool',
        turn: 1,
        callId: 'call-1',
        name: 'read_file',
        args: '{"path":"demo.md"}',
        result: '内容',
        isError: false,
      },
    ],
    toolCalls: [
      {
        callId: 'call-1',
        name: 'read_file',
        args: '{"path":"demo.md"}',
        result: '内容',
        isError: false,
      },
    ],
    attachments: [],
  }
}

describe('历史记录 Markdown 导出', () => {
  it('按选项保留 think 标签和工具调用', () => {
    const markdown = buildConversationMarkdown(
      { title: '测试会话', channelLabel: '私聊', messages: [message()] },
      { includeThinking: true, includeTools: true },
    )

    expect(markdown).toContain('<think>\n结构化思考\n</think>')
    expect(markdown).toContain('### 工具调用：read_file')
    expect(markdown).toContain('最终回答')
  })

  it('关闭选项时移除思考和工具内容', () => {
    const markdown = buildConversationMarkdown(
      { title: '测试会话', channelLabel: '私聊', messages: [message()] },
      { includeThinking: false, includeTools: false },
    )

    expect(markdown).not.toContain('<think>')
    expect(markdown).not.toContain('read_file')
    expect(markdown).not.toContain('demo.md')
    expect(markdown).toContain('最终回答')
  })
})
