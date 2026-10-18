import type { ArcaModelRepository } from './modelRepository'

/** 自治模型执行只依赖本地配置和取消信号。 */
export async function testModel(models: ArcaModelRepository, id: string, signal: AbortSignal) {
  const model = models.resolve(id)
  const started = Date.now()
  const apiKey = model.credentialRef ? models.secrets.resolve(model.credentialRef) : ''
  const base = model.apiBase?.replace(/\/$/, '') ?? defaultBase(model.provider)
  let response: Response
  if (model.provider === 'anthropic') {
    response = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    })
  } else if (model.provider === 'gemini') {
    response = await fetch(`${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    })
  } else {
    response = await fetch(`${base}/models`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    return {
      success: false,
      durationMs: Date.now() - started,
      error: `HTTP ${response.status}: ${detail}`,
    }
  }
  return { success: true, durationMs: Date.now() - started }
}

export async function completeModel(
  models: ArcaModelRepository,
  id: string | undefined,
  prompt: string,
  signal: AbortSignal,
  configured?: ReturnType<ArcaModelRepository['resolve']>,
) {
  const model = configured ?? models.resolve(id)
  const apiKey = model.credentialRef ? models.secrets.resolve(model.credentialRef) : ''
  const base = model.apiBase?.replace(/\/$/, '') ?? defaultBase(model.provider)
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
  let response: Response
  if (model.provider === 'anthropic') {
    response = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.modelId,
        max_tokens: model.maxTokens ?? 4096,
        temperature: model.temperature ?? 0.7,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } else if (model.provider === 'gemini') {
    response = await fetch(
      `${base}/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        signal: requestSignal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: model.temperature ?? 0.7,
            maxOutputTokens: model.maxTokens ?? 4096,
          },
        }),
      },
    )
  } else {
    response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model.modelId,
        temperature: model.temperature ?? 0.7,
        max_tokens: model.maxTokens ?? 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  }
  const raw = await response.text()
  if (!response.ok)
    throw new Error(`ARCA_MODEL_REQUEST_FAILED: HTTP ${response.status} ${raw.slice(0, 300)}`)
  const body = JSON.parse(raw) as Record<string, unknown>
  return {
    modelConfigId: model.id,
    source: 'local',
    text: extractText(model.provider, body),
    usage: body.usage ?? body.usageMetadata,
  }
}

function extractText(provider: string, body: Record<string, unknown>): string {
  if (provider === 'anthropic') {
    const content = body.content as Array<{ text?: string }> | undefined
    return content?.map((part) => part.text ?? '').join('') ?? ''
  }
  if (provider === 'gemini') {
    const candidates = body.candidates as
      | Array<{ content?: { parts?: Array<{ text?: string }> } }>
      | undefined
    return candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
  }
  const choices = body.choices as Array<{ message?: { content?: string } }> | undefined
  return choices?.[0]?.message?.content ?? ''
}

function defaultBase(provider: string): string {
  if (provider === 'anthropic') return 'https://api.anthropic.com'
  if (provider === 'gemini') return 'https://generativelanguage.googleapis.com'
  if (provider === 'ollama') return 'http://127.0.0.1:11434/v1'
  return 'https://api.openai.com/v1'
}
