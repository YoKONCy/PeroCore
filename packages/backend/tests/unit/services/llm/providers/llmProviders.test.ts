import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiProvider } from '@infos/backend/services/llm/providers/openaiProvider'
import { OpenAiResponsesProvider } from '@infos/backend/services/llm/providers/openaiResponsesProvider'
import { GeminiProvider } from '@infos/backend/services/llm/providers/geminiProvider'
import { AnthropicProvider } from '@infos/backend/services/llm/providers/anthropicProvider'
import type { ChatMessage, ChatOptions, ProviderConfig } from '@infos/backend/services/llm/types'

const baseConfig: ProviderConfig = {
  apiKey: 'test-key',
  apiBase: 'https://api.test',
  modelId: 'test-model',
}

function jsonResponse(data: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
    ...init,
  } as unknown as Response
}

function errorResponse(status: number, text: string, headers = new Headers()) {
  return {
    ok: false,
    status,
    headers,
    json: vi.fn(),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response
}

function streamResponse(text: string) {
  const encoder = new TextEncoder()
  const chunks = [encoder.encode(text)]
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: vi
          .fn()
          .mockResolvedValueOnce({ done: false, value: chunks[0] })
          .mockResolvedValueOnce({ done: true, value: undefined }),
        releaseLock: vi.fn(),
      }),
    },
  } as unknown as Response
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

describe('OpenAiProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当序列化消息与选项并规范化非流式响应', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: '完成',
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"q":"猫"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
    )
    const provider = new OpenAiProvider({ ...baseConfig, apiBase: 'https://api.test/v1/' })
    const messages: ChatMessage[] = [
      { role: 'user', content: '你好', name: 'master' },
      {
        role: 'assistant',
        content: null,
        reasoningContent: '我需要调用旧工具。',
        toolCalls: [
          { id: 'call-old', type: 'function', function: { name: 'old', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: '结果', toolCallId: 'call-old' },
    ]
    const opts: ChatOptions = {
      temperature: 0.2,
      topP: 0.9,
      maxTokens: 128,
      reasoningEffort: 'high',
      toolChoice: 'auto',
      responseFormat: { type: 'json_object' },
      stop: ['END'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup',
            description: '查询',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }

    const result = await provider.chat(messages, opts)

    expect(fetch).toHaveBeenCalledWith('https://api.test/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-key',
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [
          { role: 'user', content: '你好', name: 'master' },
          {
            role: 'assistant',
            content: null,
            reasoning_content: '我需要调用旧工具。',
            tool_calls: [
              { id: 'call-old', type: 'function', function: { name: 'old', arguments: '{}' } },
            ],
          },
          { role: 'tool', content: '结果', tool_call_id: 'call-old' },
        ],
        stream: false,
        temperature: 0.2,
        top_p: 0.9,
        max_tokens: 128,
        reasoning_effort: 'high',
        tools: opts.tools,
        tool_choice: 'auto',
        response_format: { type: 'json_object' },
        stop: ['END'],
      }),
      signal: expect.any(AbortSignal),
    })
    expect(result).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '完成',
            toolCalls: [
              {
                id: 'call-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"猫"}' },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
      usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    })
  })

  it('应按DeepSeek与OpenRouter方言映射思考请求并解析reasoning_details', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        choices: [
          {
            message: {
              content: '答案',
              reasoning_details: [{ type: 'reasoning.text', text: '分析' }],
            },
          },
        ],
      }),
    )
    const deepseek = new OpenAiProvider({ ...baseConfig, reasoningDialect: 'deepseek' })
    await deepseek.chat([{ role: 'user', content: '问题' }], {
      reasoningEffort: 'high',
      returnNativeReasoning: true,
    })
    let body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({ reasoning_effort: 'high', thinking: { type: 'enabled' } })

    const openrouter = new OpenAiProvider({ ...baseConfig, reasoningDialect: 'openrouter' })
    const result = await openrouter.chat([{ role: 'user', content: '问题' }], {
      reasoningEffort: 'high',
      returnNativeReasoning: true,
    })
    body = JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))
    expect(body).toMatchObject({ reasoning: { effort: 'high', exclude: false } })
    expect(result.choices[0]?.message).toMatchObject({
      reasoningContent: '分析',
      nativeReasoning: [{ format: 'reasoning_details', text: '分析' }],
    })
  })

  it('仅开启原生思考回传时不应改变DeepSeek兼容请求体', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [] }))
    const provider = new OpenAiProvider({ ...baseConfig, reasoningDialect: 'deepseek' })

    await provider.chat([{ role: 'user', content: '问题' }], {
      returnNativeReasoning: true,
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('应序列化工具续轮中的空reasoning_content', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [] }))
    const provider = new OpenAiProvider(baseConfig)

    await provider.chat(
      [
        {
          role: 'assistant',
          content: null,
          reasoningContent: '',
          toolCalls: [
            {
              id: 'call-list',
              type: 'function',
              function: { name: 'list_directory', arguments: '{"path":"."}' },
            },
          ],
        },
        { role: 'tool', content: '[]', toolCallId: 'call-list' },
      ],
      {},
    )

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      reasoning_content: '',
      tool_calls: [expect.objectContaining({ id: 'call-list' })],
    })
  })

  it('Gemini兼容端点应按调用顺序补齐并集中同轮工具响应', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [] }))
    const provider = new OpenAiProvider({ ...baseConfig, modelId: 'gemini-3-flash-preview' })

    await provider.chat(
      [
        {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              id: 'call-state',
              type: 'function',
              function: { name: 'update_state', arguments: '{}' },
            },
            {
              id: 'call-missing',
              type: 'function',
              function: { name: 'finish_task', arguments: '{}' },
            },
          ],
        },
        { role: 'user', content: '工具后的补充上下文' },
        { role: 'tool', content: '状态已更新', toolCallId: 'call-state' },
      ],
      {},
    )

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body.messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [
          expect.objectContaining({ id: 'call-state' }),
          expect.objectContaining({ id: 'call-missing' }),
        ],
      }),
      { role: 'tool', content: '状态已更新', tool_call_id: 'call-state' },
      {
        role: 'tool',
        content: '工具 finish_task 未返回结果。',
        tool_call_id: 'call-missing',
      },
      { role: 'user', content: '工具后的补充上下文' },
    ])
  })

  it('未配置生成参数时不应向 OpenAI 请求体传入', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [] }))
    const provider = new OpenAiProvider(baseConfig)

    await provider.chat([{ role: 'user', content: 'hi' }], {})

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('应当解析 SSE 文本、工具调用和 usage 增量', async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        [
          'data: {"choices":[{"delta":{"role":"assistant","reasoning_content":"先查询"},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}',
          'data: [DONE]',
          '',
        ].join('\n'),
      ),
    )
    const provider = new OpenAiProvider(baseConfig)

    const chunks = await collect(provider.chatStream([{ role: 'user', content: 'hi' }], {}))

    expect(chunks).toEqual([
      {
        choices: [
          {
            delta: {
              role: 'assistant',
              content: undefined,
              reasoningContent: '先查询',
              nativeReasoning: [{ format: 'reasoning_content', text: '先查询' }],
              toolCalls: undefined,
            },
            finishReason: null,
          },
        ],
        usage: undefined,
      },
      {
        choices: [
          { delta: { role: 'assistant', content: '你', toolCalls: undefined }, finishReason: null },
        ],
        usage: undefined,
      },
      {
        choices: [
          {
            delta: {
              role: undefined,
              content: undefined,
              toolCalls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{}' },
                },
              ],
            },
            finishReason: 'tool_calls',
          },
        ],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
    ])
  })

  it('应当在 HTTP 错误时带上 retry-after 信息', async () => {
    vi.mocked(fetch).mockResolvedValue(
      errorResponse(429, '限流', new Headers({ 'retry-after': '2' })),
    )
    const provider = new OpenAiProvider(baseConfig)

    await expect(provider.chat([{ role: 'user', content: 'hi' }], {})).rejects.toMatchObject({
      code: 'LLM_RATE_LIMITED',
      data: { retryAfter: 2000, status: 429 },
    })
  })

  it('应当列出模型并在失败时返回空数组', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'b' }, { id: 'a' }] }))
      .mockRejectedValueOnce(new Error('失败'))
    const provider = new OpenAiProvider(baseConfig)

    const models = await provider.listModels()
    const fallback = await provider.listModels()

    expect(models).toEqual(['a', 'b'])
    expect(fallback).toEqual([])
  })
})

describe('OpenAiResponsesProvider', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('应转换Responses非流式正文、思考摘要和工具调用', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        status: 'completed',
        output: [
          { id: 'rs-1', type: 'reasoning', summary: [{ type: 'summary_text', text: '分析摘要' }] },
          { type: 'message', content: [{ type: 'output_text', text: '答案' }] },
          { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{"q":"猫"}' },
        ],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
      }),
    )
    const provider = new OpenAiResponsesProvider(baseConfig)
    const result = await provider.chat([{ role: 'user', content: '问题' }], {
      reasoningEffort: 'high',
      returnNativeReasoning: true,
    })
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body).toMatchObject({
      input: [{ role: 'user', content: '问题' }],
      reasoning: { effort: 'high', summary: 'auto' },
      stream: false,
    })
    expect(result.choices[0]?.message).toMatchObject({
      content: '答案',
      reasoningContent: '分析摘要',
      toolCalls: [{ id: 'call-1', function: { name: 'lookup', arguments: '{"q":"猫"}' } }],
    })
  })

  it('应解析Responses流式思考、正文与工具参数事件', async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        [
          'data: {"type":"response.reasoning_summary_text.delta","delta":"分析"}',
          'data: {"type":"response.output_text.delta","delta":"答案"}',
          'data: {"type":"response.output_item.added","item":{"id":"fc-1","type":"function_call","call_id":"call-1","name":"lookup","arguments":""}}',
          'data: {"type":"response.function_call_arguments.delta","item_id":"fc-1","delta":"{}"}',
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}',
          '',
        ].join('\n'),
      ),
    )
    const provider = new OpenAiResponsesProvider(baseConfig)
    const chunks = await collect(provider.chatStream([{ role: 'user', content: '问题' }], {}))
    expect(chunks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          choices: [expect.objectContaining({ delta: { reasoningContent: '分析' } })],
        }),
        expect.objectContaining({
          choices: [expect.objectContaining({ delta: { content: '答案' } })],
        }),
        expect.objectContaining({
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
        }),
      ]),
    )
  })
})

describe('GeminiProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当转换消息、工具和非流式响应', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [{ text: '你好' }, { functionCall: { name: 'lookup', args: { q: '猫' } } }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
      }),
    )
    const provider = new GeminiProvider({ ...baseConfig, apiBase: 'https://api.openai.com' })

    const result = await provider.chat(
      [
        { role: 'system', content: '系统' },
        { role: 'user', content: '问题' },
        { role: 'tool', content: '{"ok":true}', name: 'lookup' },
      ],
      {
        temperature: 0.1,
        topP: 0.8,
        maxTokens: 100,
        stop: ['END'],
        responseFormat: { type: 'json_object' },
        tools: [
          {
            type: 'function',
            function: { name: 'lookup', description: '查询', parameters: { type: 'object' } },
          },
        ],
      },
    )

    const callBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain(
      'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent?',
    )
    expect(callBody).toMatchObject({
      systemInstruction: { parts: [{ text: '系统' }] },
      contents: [
        { role: 'user', parts: [{ text: '问题' }] },
        { role: 'user', parts: [{ functionResponse: { name: 'lookup', response: { ok: true } } }] },
      ],
      generationConfig: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 100,
        stopSequences: ['END'],
        responseMimeType: 'application/json',
      },
    })
    expect(result).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '你好',
            toolCalls: [
              {
                id: 'call_100_0',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"猫"}' },
              },
            ],
          },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    })
  })

  it('应当解析流式 Gemini 增量并跳过空候选', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(200)
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        [
          'data: {"candidates":[]}',
          'data: {"candidates":[{"content":{"parts":[{"text":"喵"},{"functionCall":{"name":"lookup","args":{"q":"猫"}}}]},"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":2,"candidatesTokenCount":3,"totalTokenCount":5}}',
          '',
        ].join('\n'),
      ),
    )
    const provider = new GeminiProvider(baseConfig)

    const chunks = await collect(provider.chatStream([{ role: 'user', content: 'hi' }], {}))

    expect(chunks).toEqual([
      {
        choices: [
          {
            delta: {
              content: '喵',
              toolCalls: [
                {
                  index: 1,
                  id: 'call_200_1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '{"q":"猫"}' },
                },
              ],
            },
            finishReason: 'length',
          },
        ],
        usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      },
    ])
  })

  it('应当筛选支持生成的模型并在失败时返回回退模型', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      )
      .mockResolvedValueOnce(errorResponse(500, '失败'))
    const provider = new GeminiProvider(baseConfig)

    const models = await provider.listModels()
    const fallback = await provider.listModels()

    expect(models).toEqual(['gemini-a'])
    expect(fallback).toContain('gemini-2.5-flash')
  })
})

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('应当转换系统消息、工具调用和非流式响应', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        content: [
          { type: 'text', text: '你好' },
          { type: 'tool_use', id: 'tool-1', name: 'lookup', input: { q: '猫' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 4, output_tokens: 5 },
      }),
    )
    const provider = new AnthropicProvider({
      ...baseConfig,
      apiBase: 'https://api.openai.com',
      maxTokens: 256,
    })

    const result = await provider.chat(
      [
        { role: 'system', content: '系统' },
        { role: 'user', content: '问题一' },
        { role: 'user', content: '问题二' },
        {
          role: 'assistant',
          content: '准备',
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"q":"猫"}' },
            },
          ],
        },
        { role: 'tool', content: '工具结果', toolCallId: 'call-1' },
      ],
      {
        temperature: 0.3,
        topP: 0.7,
        maxTokens: 128,
        stop: ['END'],
        toolChoice: { type: 'function', function: { name: 'lookup' } },
        tools: [
          {
            type: 'function',
            function: { name: 'lookup', description: '查询', parameters: { type: 'object' } },
          },
        ],
      },
    )

    const request = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(request?.[1]?.body))
    expect(request?.[0]).toBe('https://api.anthropic.com/v1/messages')
    expect(request?.[1]?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
    })
    expect(body).toMatchObject({
      model: 'test-model',
      max_tokens: 128,
      temperature: 0.3,
      stream: false,
      system: '系统',
      top_p: 0.7,
      stop_sequences: ['END'],
      tools: [{ name: 'lookup', description: '查询', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'lookup' },
    })
    expect(body.messages).toEqual([
      { role: 'user', content: '问题一\n问题二' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '准备' },
          { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: '猫' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '工具结果' }],
      },
    ])
    expect(result).toEqual({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '你好',
            toolCalls: [
              {
                id: 'tool-1',
                type: 'function',
                function: { name: 'lookup', arguments: '{"q":"猫"}' },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
      ],
      usage: { promptTokens: 4, completionTokens: 5, totalTokens: 9 },
    })
  })

  it('未配置可选生成参数时 Anthropic 仅保留必填最大输出 Token', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ content: [], stop_reason: 'end_turn' }))
    const provider = new AnthropicProvider(baseConfig)

    await provider.chat([{ role: 'user', content: 'hi' }], {})

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body.max_tokens).toBe(4096)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('应当将 Anthropic 推理强度映射为思考预算', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ content: [], stop_reason: 'end_turn' }))
    const provider = new AnthropicProvider(baseConfig)

    await provider.chat([{ role: 'user', content: 'hi' }], {
      reasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 2048,
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 })
    expect(body.max_tokens).toBe(8193)
    expect(body).not.toHaveProperty('temperature')
  })

  it('应当解析 Anthropic SSE 事件', async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse(
        [
          'event: message_start',
          'data: {"message":{"usage":{"input_tokens":1,"output_tokens":0}}}',
          'event: content_block_start',
          'data: {"index":0,"content_block":{"type":"tool_use","id":"tool-1","name":"lookup"}}',
          'event: content_block_delta',
          'data: {"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"猫\\"}"}}',
          'event: content_block_delta',
          'data: {"delta":{"type":"text_delta","text":"喵"}}',
          'event: message_delta',
          'data: {"delta":{"stop_reason":"max_tokens"},"usage":{"input_tokens":1,"output_tokens":2}}',
          '',
        ].join('\n'),
      ),
    )
    const provider = new AnthropicProvider(baseConfig)

    const chunks = await collect(provider.chatStream([{ role: 'user', content: 'hi' }], {}))

    expect(chunks).toEqual([
      {
        choices: [{ delta: { role: 'assistant' }, finishReason: null }],
        usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      },
      {
        choices: [
          {
            delta: {
              toolCalls: [
                {
                  index: 0,
                  id: 'tool-1',
                  type: 'function',
                  function: { name: 'lookup', arguments: '' },
                },
              ],
            },
            finishReason: null,
          },
        ],
      },
      {
        choices: [
          {
            delta: { toolCalls: [{ index: 0, function: { arguments: '{"q":"猫"}' } }] },
            finishReason: null,
          },
        ],
      },
      { choices: [{ delta: { content: '喵' }, finishReason: null }] },
      {
        choices: [{ delta: {}, finishReason: 'length' }],
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      },
    ])
  })

  it('应当处理 HTTP 错误和模型列表回退', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(errorResponse(429, '太多请求', new Headers({ 'retry-after': '3' })))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'claude-b' }, { id: 'claude-a' }] }))
      .mockRejectedValueOnce(new Error('失败'))
    const provider = new AnthropicProvider(baseConfig)

    await expect(provider.chat([{ role: 'user', content: 'hi' }], {})).rejects.toMatchObject({
      code: 'LLM_RATE_LIMITED',
      data: { retryAfter: 3000, status: 429 },
    })
    await expect(provider.listModels()).resolves.toEqual(['claude-a', 'claude-b'])
    await expect(provider.listModels()).resolves.toContain('claude-sonnet-4-20250514')
  })
})
