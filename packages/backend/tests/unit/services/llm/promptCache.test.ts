import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ToolDefinition } from '../../../../src/services/llm/types'
import {
  canonicalTools,
  appendPromptSnapshot,
  historyKey,
  invalidatePromptReplay,
  preparePromptReplay,
  promptFingerprint,
  stableHistoryWindow,
  trimOldestPromptRound,
} from '../../../../src/services/llm/promptCache'
import { OpenAiProvider } from '../../../../src/services/llm/providers/openaiProvider'
import { desktopCheckpointMessages } from '../../../../src/services/agent/reactLoop'

afterEach(() => {
  invalidatePromptReplay()
  vi.useRealTimers()
})

const system: ChatMessage = { role: 'system', content: '固定人格与协议' }
function current(content: string): ChatMessage {
  const message: ChatMessage = { role: 'user', content }
  message.cacheControl = { kind: 'current', currentKeys: [historyKey(message)] }
  return message
}
function history(message: ChatMessage): ChatMessage {
  return { ...message, cacheControl: { kind: 'history', key: historyKey(message) } }
}
function snapshot(content: string): ChatMessage {
  return { role: 'user', content }
}

describe('跨轮提示词前缀', () => {
  it('动态状态相同不重复注入，变化时只在尾部追加', () => {
    const messages: ChatMessage[] = [system, current('处理任务')]
    expect(appendPromptSnapshot(messages, 'infos.work.execution-state', '终端一')).toBe(true)
    const prefix = structuredClone(messages)
    expect(appendPromptSnapshot(messages, 'infos.work.execution-state', '终端一')).toBe(false)
    expect(messages).toEqual(prefix)
    expect(appendPromptSnapshot(messages, 'infos.work.execution-state', '终端二')).toBe(true)
    expect(messages.slice(0, prefix.length)).toEqual(prefix)
    expect(messages.at(-1)?.content).toBe('终端二')
  })

  it('落盘轨迹展开成多条工具消息后仍按来源续接真实前缀及媒体', () => {
    const user = current('读取文件')
    const first = preparePromptReplay('desktop:pero:expanded', [system, user], '模型')
    const image: ChatMessage = {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
    }
    const trace: ChatMessage[] = [...first.messages, image, { role: 'assistant', content: '完成' }]
    first.commit(trace, '完成')
    const key = historyKey({ role: 'assistant', content: '完成' })
    const source = (index: number): ChatMessage['cacheControl'] => ({
      kind: 'history',
      historySourceKey: key,
      key: `${key}:work:${index}`,
    })
    const next = preparePromptReplay(
      'desktop:pero:expanded',
      [
        system,
        {
          ...history(user),
          cacheControl: {
            kind: 'history',
            historySourceKey: historyKey(user),
            key: `${historyKey(user)}:work:input`,
          },
        },
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            { id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
          cacheControl: source(0),
        },
        { role: 'tool', toolCallId: 'old', content: '已保存正文', cacheControl: source(1) },
        { role: 'assistant', content: '完成', cacheControl: source(2) },
        snapshot('新状态'),
        current('继续'),
      ],
      '模型',
    )
    expect(next.reused).toBe(true)
    expect(next.messages.slice(0, trace.length)).toEqual(trace)
    expect(next.messages.at(-1)?.content).toBe('继续')
    expect(next.messages.filter((message) => message.toolCallId === 'old')).toHaveLength(0)
    expect(JSON.stringify(next.messages)).toContain('base64,AAAA')
  })

  it('追加快照时保留真实工具调用、结果和原生思考，并校验原始历史', () => {
    const user = current('读取文件')
    const first = preparePromptReplay(
      'desktop:pero:t1',
      [system, snapshot('时间一'), user],
      '模型一',
    )
    const trace: ChatMessage[] = [
      ...first.messages,
      {
        role: 'assistant',
        content: null,
        reasoningContent: '读取所需片段',
        nativeReasoning: [{ format: 'reasoning_details', opaque: { signature: '签名' } }],
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'call-1', content: '运行期读取正文' },
      { role: 'assistant', content: '已读取' },
    ]
    first.commit(trace, '已读取')
    const second = preparePromptReplay(
      'desktop:pero:t1',
      [
        system,
        history(user),
        history({ role: 'assistant', content: '已读取' }),
        snapshot('时间二'),
        current('继续'),
      ],
      '模型一',
    )
    expect(second.reused).toBe(true)
    expect(second.messages.slice(0, trace.length)).toEqual(trace)
    expect(second.messages.at(-1)?.content).toBe('继续')
    expect(second.messages.filter((message) => message.content === '时间二')).toHaveLength(1)
    expect(second.messages.find((message) => message.toolCalls)?.nativeReasoning).toEqual(
      trace[3]?.nativeReasoning,
    )
  })

  it.each(['编辑', '模型', '权限', '删除', '过期'])('%s 后重新编译', (change) => {
    vi.useFakeTimers()
    const user = current('原消息')
    const first = preparePromptReplay('desktop:pero:t2', [system, snapshot('旧快照'), user], {
      model: '一',
      tools: ['read'],
    })
    first.commit([...first.messages, { role: 'assistant', content: '完成' }], '完成')
    if (change === '删除') invalidatePromptReplay('t2')
    if (change === '过期') vi.advanceTimersByTime(31 * 60_000)
    const next = preparePromptReplay(
      'desktop:pero:t2',
      [
        system,
        history(change === '编辑' ? { role: 'user', content: '新消息' } : user),
        history({ role: 'assistant', content: '完成' }),
        snapshot('新快照'),
        current('下一轮'),
      ],
      {
        model: change === '模型' ? '二' : '一',
        tools: change === '权限' ? [] : ['read'],
      },
    )
    expect(next.reused).toBe(false)
    expect(next.messages.some((message) => message.content === '旧快照')).toBe(false)
  })

  it('永久删除后，在飞的旧运行也不能重新提交热轨迹', () => {
    const user = current('原消息')
    const first = preparePromptReplay('desktop:pero:t3', [system, user], '一')
    invalidatePromptReplay()
    first.commit([...first.messages, { role: 'assistant', content: '完成' }], '完成')
    expect(
      preparePromptReplay(
        'desktop:pero:t3',
        [system, history(user), history({ role: 'assistant', content: '完成' }), current('继续')],
        '一',
      ).reused,
    ).toBe(false)
  })

  it('账号和应用作用域不共享轨迹，本地标记不会发往 Provider', () => {
    const user = current('读取')
    const first = preparePromptReplay('social:账号甲:群', [system, user], '一')
    first.commit([...first.messages, { role: 'assistant', content: '完成' }], '完成')
    const input = [
      system,
      history(user),
      history({ role: 'assistant', content: '完成' }),
      current('继续'),
    ]
    expect(preparePromptReplay('social:账号乙:群', input, '一').reused).toBe(false)
    const provider = new OpenAiProvider({
      apiKey: '',
      apiBase: 'https://example.invalid',
      modelId: 'test',
    })
    expect(JSON.stringify(provider.getInputTokenPayload(input, {}))).not.toContain('cacheControl')
  })
})

describe('确定性菜单与整轮裁剪', () => {
  it('检查点保留工具关联及完整正文，原图仍由附件引用恢复', () => {
    const messages: ChatMessage[] = [
      system,
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          {
            id: '读取',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
          },
        ],
      },
      { role: 'tool', toolCallId: '读取', content: '需要跨轮保留的正文' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '来源 a.png' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,RAW_PIXELS' } },
        ],
      },
    ]
    const saved = desktopCheckpointMessages(messages)
    expect(JSON.stringify(saved)).toContain('需要跨轮保留的正文')
    expect(JSON.stringify(saved)).not.toContain('RAW_PIXELS')
    expect(saved[2]?.toolCallId).toBe('读取')
    expect(JSON.stringify(saved)).toContain('a.txt')
    expect(messages[2]?.content).toBe('需要跨轮保留的正文')
  })
  it('工具注册顺序和参数对象键序不改变序列化，数组与调用参数不被重排', () => {
    const a: ToolDefinition = {
      type: 'function',
      function: {
        name: 'a',
        description: '甲',
        parameters: {
          type: 'object',
          properties: { z: { type: 'string' }, a: { type: 'string' } },
        },
      },
    }
    const b: ToolDefinition = {
      type: 'function',
      function: { name: 'b', description: '乙', parameters: {} },
    }
    const reordered: ToolDefinition = {
      ...a,
      function: {
        ...a.function,
        parameters: {
          properties: { a: { type: 'string' }, z: { type: 'string' } },
          type: 'object',
        },
      },
    }
    expect(JSON.stringify(canonicalTools([b, a]))).toBe(
      JSON.stringify(canonicalTools([reordered, b])),
    )
    expect(promptFingerprint([1, 2])).not.toBe(promptFingerprint([2, 1]))
  })

  it('窗口批量释放空间，之后的几轮保持起点不变', () => {
    expect(stableHistoryWindow('窗口', ['1', '2', '3', '4', '5'], 4, String)).toEqual([
      '3',
      '4',
      '5',
    ])
    expect(stableHistoryWindow('窗口', ['2', '3', '4', '5', '6'], 4, String)).toEqual([
      '3',
      '4',
      '5',
      '6',
    ])
    expect(stableHistoryWindow('窗口', ['3', '4', '5', '6', '7'], 4, String)).toEqual([
      '5',
      '6',
      '7',
    ])
  })

  it('超限移除完整工具链，保留当前快照和请求', () => {
    const messages: ChatMessage[] = [
      system,
      { ...snapshot('旧快照'), cacheControl: { kind: 'snapshot', turnStart: true } },
      current('旧请求'),
      {
        role: 'assistant',
        content: null,
        toolCalls: [
          { id: '旧调用', type: 'function', function: { name: 'read', arguments: '{}' } },
        ],
      },
      { role: 'tool', toolCallId: '旧调用', content: '旧正文' },
      { role: 'assistant', content: '旧回复' },
      { ...snapshot('新快照'), cacheControl: { kind: 'snapshot', turnStart: true } },
      current('新请求'),
    ]
    expect(trimOldestPromptRound(messages)).toBe(true)
    expect(messages.map((message) => message.content)).toEqual([
      '固定人格与协议',
      '新快照',
      '新请求',
    ])
    expect(trimOldestPromptRound(messages)).toBe(false)
  })
})
