import { z } from 'zod'
import { identifier, type ServiceProfile } from './domain'
import type { Store } from './store'
import { atlasSettings, configureAtlas } from './atlascloud'
import { apiModelsSettings, configureApiModels } from './apimodels'
import { bounded } from './assets'
import { pause, retryAfter } from './requestSafety'

export const providerSchema = z
  .object({
    id: identifier,
    name: z.string().trim().min(1).max(100),
    enabled: z.boolean().default(true),
    baseUrl: z.string().url(),
    protocol: z.enum(['http', 'openai']).default('http'),
    defaultModel: z.string().trim().max(200).default(''),
    requiresCredential: z.boolean().default(true),
    modelsPath: z.string().trim().min(1).max(500).default('models'),
    authHeader: z
      .string()
      .regex(/^[\w-]+$/)
      .default('Authorization'),
    authPrefix: z
      .string()
      .max(100)
      .regex(/^[^\r\n]*$/)
      .default('Bearer '),
    credential: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .regex(/^[^\r\n]*$/)
      .optional(),
    clearCredential: z.boolean().optional(),
  })
  .strict()
export type ProviderProfile = Omit<
  z.infer<typeof providerSchema>,
  'credential' | 'clearCredential'
> & { revision: number; hasCredential: boolean }
export const providerCredential = (id: string) => `model-provider:${id}`

/** 供应商目录通过注册表扩展；不同模型协议由各自适配器实现。 */
export const providerAdapters = [
  {
    id: 'atlascloud',
    name: 'AtlasCloud',
    capabilities: ['image', 'video'],
    editor: 'atlascloud',
    settings: atlasSettings,
    configure: configureAtlas,
  },
  {
    id: 'apimodels',
    name: 'APIModels',
    capabilities: ['image', 'video'],
    editor: 'apimodels',
    settings: apiModelsSettings,
    configure: configureApiModels,
  },
]
export function providerDirectory(store: Store, owner: string) {
  return {
    adapters: providerAdapters.map(
      ({ settings: _settings, configure: _configure, ...descriptor }) => descriptor,
    ),
    providers: store.list<ProviderProfile>(owner, 'model-provider', 200).map((provider) => ({
      ...provider,
      hasCredential: Boolean(store.secret(owner, providerCredential(provider.id))),
    })),
  }
}
export function providerAdapterOperation(
  store: Store,
  owner: string,
  operation: 'settings' | 'configure',
  value: Record<string, unknown>,
) {
  const { adapterId, ...input } = value
  const adapter = providerAdapters.find((item) => item.id === (adapterId || 'atlascloud'))
  if (!adapter) throw new Error('供应商适配器不存在')
  return operation === 'settings'
    ? adapter.settings(store, owner)
    : adapter.configure(store, owner, input)
}
export function saveProvider(store: Store, owner: string, raw: unknown, expectedRevision: number) {
  const { credential, clearCredential, ...profile } = providerSchema.parse(raw)
  if (profile.id === 'new' || providerAdapters.some((adapter) => adapter.id === profile.id))
    throw new Error('供应商 ID 已保留')
  const url = new URL(profile.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('供应商地址无效')
  return store.transaction(() => {
    const previous = store.get<ProviderProfile>(owner, 'model-provider', profile.id)
    if (
      previous &&
      !sameCredentialScope(previous, profile) &&
      !credential &&
      !clearCredential &&
      store.secret(owner, providerCredential(profile.id))
    )
      throw new Error('供应商地址或认证已变化，请重新填写 API Key 或移除旧凭据')
    // 版本校验先于凭据修改，冲突时两者一起回滚。
    const saved = store.put(owner, 'model-provider', profile, expectedRevision)
    if (credential !== undefined) store.secret(owner, providerCredential(profile.id), credential)
    else if (clearCredential) store.secret(owner, providerCredential(profile.id), null)
    return { ...saved, hasCredential: Boolean(store.secret(owner, providerCredential(profile.id))) }
  })
}
/** 凭据绑定域名、适配器与认证格式，禁止仅凭相同域名跨供应商沿用。 */
export function sameCredentialScope(
  left: {
    baseUrl: string
    adapter?: string
    authHeader: string
    authPrefix: string
    protocol?: string
  },
  right: {
    baseUrl: string
    adapter?: string
    authHeader: string
    authPrefix: string
    protocol?: string
  },
) {
  return (
    new URL(left.baseUrl).origin === new URL(right.baseUrl).origin &&
    left.adapter === right.adapter &&
    left.protocol === right.protocol &&
    left.authHeader.toLowerCase() === right.authHeader.toLowerCase() &&
    left.authPrefix === right.authPrefix
  )
}
export function assertCredentialScope(
  store: Store,
  owner: string,
  service: Pick<
    ServiceProfile,
    | 'id'
    | 'baseUrl'
    | 'adapter'
    | 'authHeader'
    | 'authPrefix'
    | 'credentialId'
    | 'credentialSourceId'
    | 'providerId'
  >,
) {
  if (service.providerId) {
    const provider = store.get<ProviderProfile>(owner, 'model-provider', service.providerId)
    if (
      !provider ||
      new URL(provider.baseUrl).origin !== new URL(service.baseUrl).origin ||
      provider.authHeader.toLowerCase() !== service.authHeader.toLowerCase() ||
      provider.authPrefix !== service.authPrefix
    )
      throw new Error('供应商凭据归属已变化，请重新提交任务')
    return
  }
  const credential = service.credentialId || service.id
  const builtins: Record<string, { adapter: string; origin: string }> = {
    'provider:atlascloud': { adapter: 'atlascloud', origin: 'https://api.atlascloud.ai' },
    'provider:apimodels': { adapter: 'apimodels', origin: 'https://api.apimodels.app' },
  }
  const builtin = builtins[credential]
  if (builtin) {
    if (
      service.adapter !== builtin.adapter ||
      new URL(service.baseUrl).origin !== builtin.origin ||
      service.authHeader.toLowerCase() !== 'authorization' ||
      service.authPrefix !== 'Bearer '
    )
      throw new Error('API Key 与当前供应商不匹配，请重新配置')
    return
  }
  const scope = store.get<ServiceProfile>(owner, 'credential-scope', credential)
  if (scope && !sameCredentialScope(scope, service))
    throw new Error('API Key 与当前地址或适配器不匹配，请重新填写')
  if (credential === service.id) return
  const source = store.get<ServiceProfile>(
    owner,
    'service',
    service.credentialSourceId || credential,
  )
  if (
    !source ||
    source.providerId ||
    (source.credentialId || source.id) !== credential ||
    !sameCredentialScope(source, service)
  )
    throw new Error('原 API Key 不属于当前供应商，请重新填写')
}
export function serviceDescriptor(store: Store, owner: string, service: ServiceProfile) {
  try {
    const effective = effectiveService(store, owner, service)
    return {
      ...service,
      hasCredential: Boolean(
        effective && store.secret(owner, effective.credentialId || effective.id),
      ),
    }
  } catch (failure) {
    return {
      ...service,
      hasCredential: false,
      credentialError: failure instanceof Error ? failure.message : '凭据不匹配',
    }
  }
}
/** 只读模型目录；密钥只在后台使用，禁止跨域重定向携带认证。 */
export async function fetchProviderModels(store: Store, owner: string, raw: unknown) {
  const profile = providerSchema.parse(raw),
    base = new URL(profile.baseUrl)
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('供应商地址无效')
  const url = new URL(profile.modelsPath, `${base.href.replace(/\/$/, '')}/`)
  if (url.origin !== base.origin || url.username || url.password || url.hash)
    throw new Error('模型列表地址必须与供应商同源')
  const saved = store.get<ProviderProfile>(owner, 'model-provider', profile.id)
  const sameOrigin = saved && new URL(saved.baseUrl).origin === base.origin
  const credential =
    profile.credential ||
    (sameOrigin &&
    saved.authHeader === profile.authHeader &&
    saved.authPrefix === profile.authPrefix
      ? store.secret(owner, providerCredential(profile.id))
      : undefined)
  if (profile.requiresCredential && !credential)
    throw new Error('请填写 API Key；更换域名后需要重新填写')
  if (credential && /[\r\n]/.test(credential)) throw new Error('API Key 格式无效')
  const headers = new Headers({ Accept: 'application/json' })
  if (credential) headers.set(profile.authHeader, `${profile.authPrefix}${credential}`)
  const signal = AbortSignal.timeout(25000)
  try {
    for (let attempt = 0; ; attempt++) {
      let response: Response
      try {
        response = await fetch(url, { headers, signal, redirect: 'error' })
      } catch {
        if (signal.aborted || attempt >= 1) throw new Error('模型列表连接失败，请检查地址或网络')
        await pause(600, signal)
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        if (attempt < 1 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
          await pause(
            Math.min(4000, retryAfter(response.headers.get('retry-after')) || 600),
            signal,
          )
          continue
        }
        throw new Error(`模型列表获取失败（HTTP ${response.status}）`)
      }
      const data = JSON.parse((await bounded(response, 2 * 1024 * 1024)).toString('utf8'))
      if (!data || typeof data !== 'object') throw new Error('供应商未返回模型列表')
      const entries = Array.isArray(data) ? data : (data.data?.models ?? data.data ?? data.models)
      if (!Array.isArray(entries)) throw new Error('未识别模型列表格式，需要 data、models 或数组')
      const models = [
        ...new Map<string, { id: string; name: string }>(
          entries.slice(0, 10000).flatMap((item: unknown) => {
            const entry =
              item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined
            const id = typeof item === 'string' ? item : (entry?.id ?? entry?.model ?? entry?.name)
            if (typeof id !== 'string' || !id.trim() || id.length > 200) return []
            const name = typeof entry?.name === 'string' ? entry.name.slice(0, 200) : id
            return [[id.trim(), { id: id.trim(), name }] as const]
          }),
        ).values(),
      ]
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, 2000)
      return { models }
    }
  } catch (failure) {
    if (signal.aborted) throw new Error('模型列表获取超时，请重试')
    if (failure instanceof SyntaxError) throw new Error('供应商未返回有效的 JSON 模型列表')
    throw failure
  }
}
/** 任务提交时冻结服务连接配置；凭据仍保留在 Pictoria 加密存储中。 */
export function effectiveService(
  store: Store,
  owner: string,
  service?: ServiceProfile,
): ServiceProfile | undefined {
  if (!service) return service
  if (!service.providerId) {
    assertCredentialScope(store, owner, service)
    return service
  }
  const provider = store.get<ProviderProfile>(owner, 'model-provider', service.providerId)
  if (!provider) return undefined
  return {
    ...service,
    enabled: service.enabled && provider.enabled,
    baseUrl: provider.baseUrl,
    authHeader: provider.authHeader,
    authPrefix: provider.authPrefix,
    requiresCredential: provider.requiresCredential,
    credentialId: providerCredential(provider.id),
    hasCredential: Boolean(store.secret(owner, providerCredential(provider.id))),
  }
}
