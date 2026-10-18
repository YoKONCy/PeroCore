interface BrandDefinition {
  label: string
  asset: string
  mono?: boolean
}

/** 图形来自固定版本的本地资产，不能将用户填写的地址用作图片来源。 */
export const MODEL_BRANDS = {
  openai: { label: 'OpenAI', asset: 'openai.svg', mono: true },
  anthropic: { label: 'Anthropic', asset: 'anthropic.svg', mono: true },
  google: { label: 'Google', asset: 'google-color.svg' },
  claude: { label: 'Claude', asset: 'claude-color.svg' },
  gemini: { label: 'Gemini', asset: 'gemini-color.svg' },
  deepseek: { label: 'DeepSeek', asset: 'deepseek-color.svg' },
  glm: { label: 'GLM', asset: 'zai.svg', mono: true },
  zai: { label: 'Z.ai', asset: 'zai.svg', mono: true },
  zhipu: { label: '智谱', asset: 'zhipu-color.svg' },
  kimi: { label: 'Kimi', asset: 'kimi.svg', mono: true },
  moonshot: { label: 'Moonshot', asset: 'moonshot.svg', mono: true },
  minimax: { label: 'MiniMax', asset: 'minimax-color.svg' },
  grok: { label: 'Grok', asset: 'grok.svg', mono: true },
  xai: { label: 'xAI', asset: 'xai.svg', mono: true },
  agnes: { label: 'Agnes', asset: 'agnesai.svg', mono: true },
  qwen: { label: 'Qwen', asset: 'qwen-color.svg' },
  doubao: { label: '豆包', asset: 'doubao-color.svg' },
  hunyuan: { label: '腾讯混元', asset: 'hunyuan-color.svg' },
  mistral: { label: 'Mistral', asset: 'mistral-color.svg' },
  groq: { label: 'Groq', asset: 'groq.svg', mono: true },
  siliconflow: { label: '硅基流动', asset: 'siliconcloud-color.svg' },
  bailian: { label: '阿里百炼', asset: 'bailian-color.svg' },
  volcengine: { label: '火山引擎', asset: 'volcengine-color.svg' },
  ollama: { label: 'Ollama', asset: 'ollama.svg', mono: true },
  yi: { label: '零一万物', asset: 'yi.svg', mono: true },
  stepfun: { label: '阶跃星辰', asset: 'stepfun-color.svg' },
  llama: { label: 'Meta / Llama', asset: 'meta-color.svg' },
  gemma: { label: 'Gemma', asset: 'gemma-color.svg' },
  cohere: { label: 'Cohere', asset: 'cohere-color.svg' },
  openrouter: { label: 'OpenRouter', asset: 'openrouter.svg', mono: true },
  baai: { label: '智源 / BGE', asset: 'baai.svg', mono: true },
  jina: { label: 'Jina', asset: 'jina.svg', mono: true },
  nvidia: { label: 'NVIDIA', asset: 'nvidia-color.svg' },
  longcat: { label: 'LongCat', asset: 'longcat.svg', mono: true },
  baichuan: { label: '百川', asset: 'baichuan-color.svg' },
  internlm: { label: '书生 / InternLM', asset: 'internlm-color.svg' },
  wenxin: { label: '文心 / ERNIE', asset: 'wenxin-color.svg' },
  spark: { label: '讯飞星火', asset: 'spark-color.svg' },
} as const satisfies Record<string, BrandDefinition>

export type ModelBrandId = keyof typeof MODEL_BRANDS

export function modelBrandDefinition(brand?: ModelBrandId): BrandDefinition | undefined {
  return brand && Object.hasOwn(MODEL_BRANDS, brand) ? MODEL_BRANDS[brand] : undefined
}

const modelRules: Array<[ModelBrandId, RegExp]> = [
  // 派生模型先识别明确的发布品牌，避免 Llama-Nemotron 被当作原版 Llama。
  ['nvidia', /(?:^|[-_.])nemotron(?:[-_.]|\d|$)/],
  ['openai', /^(?:gpt|chatgpt|codex|whisper)(?:[-_.]|\d|$)|^o\d+(?:[-_.]|$)|^text-embedding-/],
  ['claude', /^claude(?:[-_.]|\d|$)/],
  ['gemini', /^gemini(?:[-_.]|\d|$)/],
  ['deepseek', /^deepseek(?:[-_.]|\d|$)/],
  ['glm', /^(?:glm|chatglm)(?:[-_.]|\d|$)/],
  ['kimi', /^kimi(?:[-_.]|\d|$)/],
  ['moonshot', /^moonshot(?:[-_.]|\d|$)/],
  ['minimax', /^(?:minimax|abab)(?:[-_.]|\d|$)/],
  ['grok', /^grok(?:[-_.]|\d|$)/],
  ['agnes', /^agnes(?:[-_.]|\d|$)/],
  ['qwen', /^(?:qwen|qwq|qvq)(?:[-_.]|\d|$)/],
  ['doubao', /^doubao(?:[-_.]|\d|$)/],
  ['hunyuan', /^hunyuan(?:[-_.]|\d|$)/],
  [
    'mistral',
    /^(?:mistral|mixtral|magistral|ministral|codestral|devstral|pixtral|voxtral)(?:[-_.]|\d|$)/,
  ],
  ['stepfun', /^step\d*(?:[-_.]|$)/],
  ['yi', /^yi(?:[-_.]|\d|$)/],
  ['llama', /^(?:meta[-_.])?llama(?:[-_.]|\d|$)/],
  ['gemma', /^(?:code)?gemma(?:[-_.]|\d|$)/],
  ['cohere', /^command(?:[-_.]|$)|^(?:embed|rerank)[-_.](?:english|multilingual|v\d)/],
  ['baai', /^bge(?:[-_.]|\d|$)/],
  ['jina', /^jina(?:[-_.]|\d|$)/],
  ['longcat', /^longcat(?:[-_.]|\d|$)/],
  ['baichuan', /^baichuan(?:[-_.]|\d|$)/],
  ['internlm', /^internlm(?:[-_.]|\d|$)/],
  ['wenxin', /^(?:ernie|wenxin)(?:[-_.]|\d|$)/],
  ['spark', /^spark(?:[-_.]|\d|$)/],
]

/** 只按模型 ID 识别，不从用户自定义昵称或兼容协议猜测模型品牌。 */
export function resolveModelBrand(modelId?: string): ModelBrandId | undefined {
  const id = (modelId?.trim().toLowerCase().split('/').at(-1) ?? '').replace(
    /^(?:(?:us|eu|apac|global)\.)?anthropic\./,
    '',
  )
  return modelRules.find(([, pattern]) => pattern.test(id))?.[0]
}

const providerBrands: Record<string, ModelBrandId> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  google: 'google',
  xai: 'xai',
  mistral: 'mistral',
  groq: 'groq',
  siliconflow: 'siliconflow',
  deepseek: 'deepseek',
  moonshot: 'moonshot',
  dashscope: 'bailian',
  volcengine: 'volcengine',
  zhipu: 'zhipu',
  minimax: 'minimax',
  yi: 'yi',
  stepfun: 'stepfun',
  hunyuan: 'hunyuan',
  ollama: 'ollama',
  openrouter: 'openrouter',
  zai: 'zai',
  cohere: 'cohere',
  jina: 'jina',
  agnes: 'agnes',
  agnesai: 'agnes',
}

const providerDomains: Array<[ModelBrandId, string[]]> = [
  ['openai', ['openai.com']],
  ['anthropic', ['anthropic.com']],
  ['google', ['generativelanguage.googleapis.com']],
  ['xai', ['x.ai']],
  ['mistral', ['mistral.ai']],
  ['groq', ['groq.com']],
  ['siliconflow', ['siliconflow.cn', 'siliconflow.com']],
  ['deepseek', ['deepseek.com']],
  ['moonshot', ['moonshot.cn', 'moonshot.ai']],
  ['bailian', ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com']],
  ['volcengine', ['volces.com']],
  ['zhipu', ['bigmodel.cn']],
  ['zai', ['z.ai']],
  ['minimax', ['minimax.chat', 'minimax.io', 'minimaxi.com']],
  ['yi', ['lingyiwanwu.com']],
  ['stepfun', ['stepfun.com']],
  ['hunyuan', ['hunyuan.cloud.tencent.com']],
  ['openrouter', ['openrouter.ai']],
  ['cohere', ['cohere.com', 'cohere.ai']],
  ['jina', ['jina.ai']],
  ['nvidia', ['integrate.api.nvidia.com']],
]

/** 有显式地址时按真实主机识别，避免把第三方 OpenAI 兼容接口标成 OpenAI。 */
export function resolveProviderBrand(
  provider?: string,
  apiBase?: string,
): ModelBrandId | undefined {
  const key = provider?.trim().toLowerCase() ?? ''
  const configured = Object.hasOwn(providerBrands, key) ? providerBrands[key] : undefined
  if (!apiBase?.trim()) return configured
  try {
    const url = new URL(apiBase)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    const known = providerDomains.find(([, domains]) =>
      domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    )
    if (known) return known[0]
    // Ollama 是用户明确选择的部署方式，也允许放在局域网或远程节点。
    if (configured === 'ollama') return 'ollama'
  } catch {
    // 未完成输入或未知服务商使用通用图标。
  }
}
