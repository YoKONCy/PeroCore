import type { aiModelConfigs } from '../../database/schema'
import type {
  ProviderConnection,
  ProviderProtocol,
  ProviderAuthMode,
} from '../../repositories/providerConnection.repo'
import { AppError } from '../../lib/appError'

/** 品牌决定默认地址，协议决定请求格式，两者独立。 */
export const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  claude: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  siliconflow: 'https://api.siliconflow.cn/v1',
  deepseek: 'https://api.deepseek.com/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  groq: 'https://api.groq.com/openai/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  mistral: 'https://api.mistral.ai/v1',
  yi: 'https://api.lingyiwanwu.com/v1',
  xai: 'https://api.x.ai/v1',
  stepfun: 'https://api.stepfun.com/v1',
  hunyuan: 'https://api.hunyuan.cloud.tencent.com/v1',
  ollama: 'http://localhost:11434/v1',
}

function defaultProtocol(brand: string): ProviderProtocol {
  if (brand === 'gemini') return 'gemini'
  return ['anthropic', 'claude'].includes(brand) ? 'anthropic' : 'openai'
}

/** 主调用、角色/任务调用、回退及测试共用；仅无连接的旧卡片保留旧版全局回退。 */
export async function resolveModelConnection(
  row: typeof aiModelConfigs.$inferSelect,
  readConnection: (id: string) => Promise<ProviderConnection | undefined>,
  readConfig: (key: string) => Promise<string | undefined>,
) {
  const connection = row.providerConnectionId
    ? await readConnection(row.providerConnectionId)
    : undefined
  if (row.providerConnectionId && !connection) {
    throw new AppError('CONFIG_ERROR', {
      message: `模型「${row.name}」引用的服务商连接不存在，请重新选择`,
    })
  }
  if (connection && !row.connectionOverride) {
    return {
      provider: connection.brand,
      protocol: connection.protocol as ProviderProtocol,
      authMode: connection.authMode as ProviderAuthMode,
      apiBase: connection.apiBase || PROVIDER_DEFAULTS[connection.brand] || undefined,
      apiKey: connection.authMode === 'none' ? '' : connection.apiKey,
    }
  }
  const provider = row.provider ?? 'openai'
  const protocol =
    row.connectionProtocol ||
    (provider === 'custom' && ['anthropic', 'gemini'].includes(row.providerType ?? '')
      ? row.providerType!
      : defaultProtocol(provider))
  const authMode = row.connectionAuthMode ?? (provider === 'ollama' ? 'none' : 'api_key')
  // 独立卡片与显式覆盖使用完整配置；只有旧卡片保留全局回填兼容。
  const explicit = !!connection || row.connectionOverride
  const apiBase = explicit
    ? row.apiBase
    : row.apiBase || (await readConfig(`global.${provider}.apiBase`))
  const apiKey = explicit
    ? row.apiKey
    : row.apiKey || (await readConfig(`global.${provider}.apiKey`))
  return {
    provider,
    protocol: protocol as ProviderProtocol,
    authMode: authMode as ProviderAuthMode,
    apiBase: apiBase || PROVIDER_DEFAULTS[provider] || undefined,
    apiKey: authMode === 'none' ? '' : (apiKey ?? ''),
  }
}
