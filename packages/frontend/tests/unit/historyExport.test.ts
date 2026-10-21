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
  it('碎碎念导出使用 selfMinding 标签并保留工具调用', () => {
    const markdown = buildConversationMarkdown(
      { title: '测试会话', channelLabel: '私聊', messages: [message()] },
      { includeThinking: true, includeTools: true },
    )

    expect(markdown).toContain('<selfMinding>\n结构化思考\n</selfMinding>')
    expect(markdown).toContain('read_file')
    expect(markdown).toContain('demo.md')
    expect(markdown).toContain('最终回答')
  })

  it('关闭选项时移除思考和工具内容', () => {
    const markdown = buildConversationMarkdown(
      { title: '测试会话', channelLabel: '私聊', messages: [message()] },
      { includeThinking: false, includeTools: false },
    )

    expect(markdown).not.toContain('<think>')
    expect(markdown).not.toContain('<selfMinding>')
    expect(markdown).not.toContain('read_file')
    expect(markdown).not.toContain('demo.md')
    expect(markdown).toContain('最终回答')
  })

  it('无结构化块时兼容新旧原始标签', () => {
    const raw = {
      ...message(),
      contentBlocks: [],
      rawContent: '<think>旧记录</think><selfMinding>新记录</selfMinding>最终回答',
    }
    const markdown = buildConversationMarkdown(
      { title: '测试', channelLabel: '私聊', messages: [raw] },
      { includeThinking: true, includeTools: false },
    )
    expect(markdown).toContain('<think>旧记录</think>')
    expect(markdown).toContain('<selfMinding>新记录</selfMinding>')
  })

  it('原生思考与碎碎念使用各自的导出标签', () => {
    const mixed = message()
    mixed.contentBlocks.push({
      blockId: 'native-1',
      sequence: 3,
      kind: 'native_reasoning',
      turn: 1,
      content: '原生思考摘要',
      mode: 'stream',
    })
    const markdown = buildConversationMarkdown(
      { title: '测试', channelLabel: '私聊', messages: [mixed] },
      { includeThinking: true, includeTools: false },
    )
    expect(markdown).toContain('<selfMinding>\n结构化思考\n</selfMinding>')
    expect(markdown).toContain('<think>\n原生思考摘要\n</think>')
  })
})
