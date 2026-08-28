import type { KernelEnvelope, KernelNodeId } from '@infos/shared'
import type { NodeProvider, NodeProviderContext } from '@infos/node-sdk'
import type { ArcaModelRepository, SaveArcaModelInput } from './modelRepository'
import type { SurfaceSessionManager } from './surfaceSession'

const OPERATIONS = [
  'model.list',
  'model.save',
  'model.select',
  'model.remove',
  'model.test',
  'model.complete',
] as const

/** Arca本地Model Authority；所有操作均通过已认证Surface Session执行。 */
export function createModelCapabilityProvider(input: {
  nodeId: KernelNodeId
  models: ArcaModelRepository
  sessions: SurfaceSessionManager
}): NodeProvider {
  return {
    manifest: {
      manifestVersion: 1,
      providerId: 'infos.arca.model-authority',
      name: 'Arca Model Authority',
      version: '1.0.0',
      definition: {
        capabilityType: 'model.settings',
        contractVersion: '1.0',
        operations: Object.fromEntries(
          OPERATIONS.map((operation) => [
            operation,
            { risk: operation === 'model.list' ? 'read' : 'interact', idempotency: 'safe' },
          ]),
        ),
      },
      offer: {
        offerId: `arca-model-authority:${input.nodeId}`,
        capabilityType: 'model.settings',
        contractVersion: '1.0',
        operations: [...OPERATIONS],
        resourceKinds: ['model.config', 'credential.reference'],
      },
    },
    health: () => 'available',
    async invoke(
      envelope: KernelEnvelope<{ operation: string; input: unknown }>,
      context: NodeProviderContext,
    ) {
      if (context.signal.aborted) throw new Error('ARCA_MODEL_INVOCATION_CANCELLED')
      const value = objectInput(envelope.payload.input)
      input.sessions.require(
        value.surfaceSessionToken,
        envelope.payload.operation === 'model.list' ? 'read' : 'edit',
        envelope.sourceNodeId,
      )
      switch (envelope.payload.operation) {
        case 'model.list':
          return { models: input.models.list(), selectedModelId: input.models.selected() }
        case 'model.save':
          return input.models.save(value as unknown as SaveArcaModelInput)
        case 'model.select':
          input.models.select(requireString(value.modelId, 'modelId'))
          return { selectedModelId: input.models.selected() }
        case 'model.remove':
          return { removed: input.models.remove(requireString(value.modelId, 'modelId')) }
        case 'model.test':
          return testModel(input.models, requireString(value.modelId, 'modelId'), context.signal)
        case 'model.complete':
          return completeModel(
            input.models,
            typeof value.modelId === 'string' ? value.modelId : undefined,
            requireString(value.prompt, 'prompt'),
            context.signal,
          )
        default:
          throw new Error(`ARCA_MODEL_OPERATION_UNSUPPORTED: ${envelope.payload.operation}`)
      }
    },
  }
}

async function testModel(models: ArcaModelRepository, id: string, signal: AbortSignal) {
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

async function completeModel(
  models: ArcaModelRepository,
  id: string | undefined,
  prompt: string,
  signal: AbortSignal,
) {
  const model = models.resolve(id)
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

function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ARCA_MODEL_INPUT_INVALID: 输入必须是对象')
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name}必须是非空字符串`)
  return value.trim()
}
