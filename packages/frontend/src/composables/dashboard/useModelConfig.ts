/**
 * useModelConfig — 模型配置 composable
 *
 * 管理 LLM 模型列表的 CRUD + 角色分配 (主/秘书/反思/辅助)
 * 以及向量模型 (Embedding / Reranker) 配置。
 *
 * F3: 已对接 modelApi + configApi 真实后端。
 *
 * @module packages/frontend/src/composables/dashboard/useModelConfig
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { modelApi } from '../../api/modules/modelApi'
import type { ModelConfigItem } from '../../api/modules/modelApi'
import { configApi } from '../../api/modules/configApi'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { logger } from '../../lib/logger'

// ── 类型 ──

export interface LlmModel {
  id: string
  name: string
  provider: string
  modelId: string
  maxTokens: number | null
  enableVision: boolean
  temperature: number
  topP: number
  apiBase?: string
  apiKey?: string
  /** 自定义 provider 的协议格式 (openai/anthropic/gemini) */
  providerType: string
}

export interface ModelRoles {
  main: string | null
  secretary: string | null
  reflection: string | null
  aux: string | null
}

export type ModelTab = 'llm' | 'vector'

// ── 辅助函数 ──

/** 后端 DTO → 前端 LlmModel */
function toLlmModel(item: ModelConfigItem): LlmModel {
  return {
    id: String(item.id),
    name: item.name,
    provider: item.provider,
    modelId: item.modelId,
    maxTokens: null,
    enableVision: false,
    temperature: 0.7,
    topP: 1,
    apiBase: item.apiBase,
    apiKey: item.apiKey, // 后端已遮蔽
    providerType: ('providerType' in item ? String(item.providerType) : undefined) ?? 'openai',
  }
}

// ── Composable ──

export function useModelConfig() {
  const notify = useNotificationStore()
  // ── LLM 模型列表 ──
  const models = shallowRef<LlmModel[]>([])
  const currentTab = ref<ModelTab>('llm')
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // ── 模型角色 ──
  const roles = ref<ModelRoles>({
    main: null,
    secretary: null,
    reflection: null,
    aux: null,
  })

  // ── 编辑弹窗 ──
  const isEditorOpen = ref(false)
  const editingModel = ref<LlmModel | null>(null)
  const editorForm = ref<LlmModel>({
    id: '',
    name: '',
    provider: 'openai',
    modelId: '',
    maxTokens: null,
    enableVision: false,
    temperature: 0.7,
    topP: 1,
    apiBase: '',
    apiKey: '',
    providerType: 'openai',
  })

  // ── 全局配置弹窗 ──
  const isGlobalOpen = ref(false)
  // 每个主流供应商的全局 apiBase/apiKey
  const globalConfig = ref({
    openai: { apiBase: 'https://api.openai.com/v1', apiKey: '' },
    anthropic: { apiBase: 'https://api.anthropic.com', apiKey: '' },
    gemini: { apiBase: 'https://generativelanguage.googleapis.com', apiKey: '' },
    siliconflow: { apiBase: 'https://api.siliconflow.cn/v1', apiKey: '' },
    deepseek: { apiBase: 'https://api.deepseek.com', apiKey: '' },
    moonshot: { apiBase: 'https://api.moonshot.cn/v1', apiKey: '' },
    dashscope: { apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '' },
    volcengine: { apiBase: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '' },
    groq: { apiBase: 'https://api.groq.com/openai/v1', apiKey: '' },
    zhipu: { apiBase: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '' },
    minimax: { apiBase: 'https://api.minimax.chat/v1', apiKey: '' },
    mistral: { apiBase: 'https://api.mistral.ai/v1', apiKey: '' },
    yi: { apiBase: 'https://api.lingyiwanwu.com/v1', apiKey: '' },
    xai: { apiBase: 'https://api.x.ai/v1', apiKey: '' },
    stepfun: { apiBase: 'https://api.stepfun.com/v1', apiKey: '' },
    hunyuan: { apiBase: 'https://api.hunyuan.cloud.tencent.com/v1', apiKey: '' },
    ollama: { apiBase: 'http://localhost:11434/v1', apiKey: '' },
  })

  // ── 向量配置 ──
  const embeddingProvider = ref<'local' | 'api'>('api')
  const embeddingModelId = ref('text-embedding-3-small')
  const embeddingDimension = ref(1536)
  const embeddingApiBase = ref('')
  const embeddingApiKey = ref('')
  const rerankerEnabled = ref(false)
  const rerankerModelId = ref('')
  const rerankerApiBase = ref('')
  const rerankerApiKey = ref('')
  const isSavingVector = ref(false)

  // ── 计算属性 ──
  const providerOptions = computed(() => [
    // 国际主流
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic (Claude)', value: 'anthropic' },
    { label: 'Google (Gemini)', value: 'gemini' },
    { label: 'xAI (Grok)', value: 'xai' },
    { label: 'Mistral', value: 'mistral' },
    { label: 'Groq', value: 'groq' },
    // 国内服务商
    { label: 'SiliconFlow (硅基流动)', value: 'siliconflow' },
    { label: 'DeepSeek (深度求索)', value: 'deepseek' },
    { label: 'Moonshot (Kimi)', value: 'moonshot' },
    { label: 'DashScope (阿里百炼)', value: 'dashscope' },
    { label: 'Volcengine (火山引擎)', value: 'volcengine' },
    { label: 'Zhipu (智谱GLM)', value: 'zhipu' },
    { label: 'MiniMax', value: 'minimax' },
    { label: '01.AI (零一万物)', value: 'yi' },
    { label: 'StepFun (阶跃星辰)', value: 'stepfun' },
    { label: 'Hunyuan (腾讯混元)', value: 'hunyuan' },
    // 本地
    { label: 'Ollama (本地部署)', value: 'ollama' },
    // 自定义
    { label: '自定义', value: 'custom' },
  ])

  /**
   * 供应商默认 API Base 表
   *
   * 在用户切换 provider 时自动填充，减少配置成本。
   * 对齐后端 LlmService.DEFAULT_API_BASES。
   */
  const providerDefaults: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com',
    gemini: 'https://generativelanguage.googleapis.com',
    siliconflow: 'https://api.siliconflow.cn/v1',
    deepseek: 'https://api.deepseek.com',
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

  /** 自定义 provider 的协议格式选项 */
  const customProviderTypeOptions = computed(() => [
    { label: 'OpenAI 兼容', value: 'openai' },
    { label: 'Anthropic 兼容', value: 'anthropic' },
    { label: 'Gemini 兼容', value: 'gemini' },
  ])

  // ── 远程模型列表 ──
  const remoteModels = ref<string[]>([])
  const isFetchingRemote = ref(false)
  const remoteEmbeddingModels = ref<string[]>([])
  const isFetchingEmbedding = ref(false)
  const remoteRerankerModels = ref<string[]>([])
  const isFetchingReranker = ref(false)

  /**
   * 切换 Provider 时自动填充 API Base
   *
   * 如果用户还没填过自定义地址，起到引导所用的作用。
   */
  function handleProviderChange(provider: string) {
    if (providerDefaults[provider] && !editorForm.value.apiBase) {
      editorForm.value.apiBase = providerDefaults[provider]
    }
    // 切换非 custom 供应商时清空 providerType（设回默认）
    if (provider !== 'custom') {
      editorForm.value.providerType = 'openai'
    }
  }

  // ── API 操作 ──

  /** 从后端加载模型列表 */
  async function fetchModels(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const res = await modelApi.list()
      models.value = (res.data ?? []).map(toLlmModel)
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('加载模型列表失败: ' + (e as Error).message, 'error')
      logger.error('ModelConfig', '加载模型列表失败', e)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 获取远程服务商可用模型列表
   *
   * 根据当前编辑表单的 provider/apiKey/apiBase 调用后端查询。
   * 对于 custom provider，使用 providerType 作为实际协议类型。
   */
  async function fetchRemoteModels(): Promise<void> {
    const form = editorForm.value
    const actualProvider =
      form.provider === 'custom' ? form.providerType || 'openai' : form.provider
    const apiKey =
      form.apiKey ||
      globalConfig.value[form.provider as keyof typeof globalConfig.value]?.apiKey ||
      ''
    const apiBase =
      form.apiBase ||
      globalConfig.value[form.provider as keyof typeof globalConfig.value]?.apiBase ||
      undefined

    if (!apiKey) {
      error.value = '请先填写 API Key 或在全局服务商中配置'
      notify.toast('请先填写 API Key 或在全局服务商中配置', 'warning')
      return
    }

    isFetchingRemote.value = true
    error.value = null
    try {
      const res = await modelApi.listRemote({ provider: actualProvider, apiKey, apiBase })
      remoteModels.value = res.data ?? []
      if (remoteModels.value.length > 0) {
        notify.toast(`已获取 ${remoteModels.value.length} 个可用模型`, 'success')
      } else {
        notify.toast('未获取到可用模型，请检查 API Key 或服务商配置', 'warning')
      }
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('获取远程模型列表失败: ' + (e as Error).message, 'error')
      logger.error('ModelConfig', '获取远程模型列表失败', e)
    } finally {
      isFetchingRemote.value = false
    }
  }

  /** 从后端加载角色配置 */
  async function fetchRoles(): Promise<void> {
    try {
      const res = await configApi.batch([
        'model.role.main',
        'model.role.secretary',
        'model.role.reflection',
        'model.role.aux',
      ])
      const data = res.data ?? {}
      roles.value = {
        main: (data['model.role.main'] as string) || null,
        secretary: (data['model.role.secretary'] as string) || null,
        reflection: (data['model.role.reflection'] as string) || null,
        aux: (data['model.role.aux'] as string) || null,
      }
    } catch {
      // 首次使用可能不存在配置，保持默认
    }
  }

  function openEditor(model: LlmModel | null) {
    if (model) {
      editingModel.value = model
      editorForm.value = { ...model }
    } else {
      editingModel.value = null
      editorForm.value = {
        id: '',
        name: '',
        provider: 'openai',
        modelId: '',
        maxTokens: null,
        enableVision: false,
        temperature: 0.7,
        topP: 1,
        apiBase: '',
        apiKey: '',
        providerType: 'openai',
      }
    }
    remoteModels.value = []
    isEditorOpen.value = true
  }

  /** 保存模型（创建或更新） */
  async function saveModel(): Promise<void> {
    isLoading.value = true
    try {
      const form = editorForm.value
      if (editingModel.value) {
        // 更新
        await modelApi.update(editingModel.value.id, {
          name: form.name,
          provider: form.provider,
          modelId: form.modelId,
          apiKey: form.apiKey || undefined,
          apiBase: form.apiBase || undefined,
        })
        notify.toast(`模型 "${form.name}" 已更新`, 'success')
      } else {
        // 创建
        await modelApi.create({
          name: form.name,
          provider: form.provider,
          modelId: form.modelId,
          apiKey: form.apiKey || '',
          apiBase: form.apiBase || undefined,
        })
        notify.toast(`模型 "${form.name}" 已添加`, 'success')
      }
      isEditorOpen.value = false
      await fetchModels()
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('保存模型失败: ' + (e as Error).message, 'error')
    } finally {
      isLoading.value = false
    }
  }

  /** 删除模型 */
  async function deleteModel(id: string): Promise<void> {
    try {
      await modelApi.remove(id)
      await fetchModels()
      // 清理角色引用
      for (const key of Object.keys(roles.value) as Array<keyof ModelRoles>) {
        if (roles.value[key] === id) {
          roles.value[key] = null
          await configApi.set(`model.role.${key}`, '')
        }
      }
      notify.toast('模型已删除', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('删除模型失败: ' + (e as Error).message, 'error')
    }
  }

  /** 设置角色 */
  async function setRole(role: keyof ModelRoles, modelId: string): Promise<void> {
    try {
      if (roles.value[role] === modelId) {
        roles.value[role] = null
        await configApi.set(`model.role.${role}`, '')
        notify.toast(`已取消 ${role} 角色分配`, 'info')
      } else {
        roles.value[role] = modelId
        await configApi.set(`model.role.${role}`, modelId)
        notify.toast(`已设置 ${role} 角色`, 'success')
      }
    } catch (e) {
      notify.toast('角色设置失败: ' + (e as Error).message, 'error')
    }
  }

  function getModelRoles(modelId: string): string[] {
    const result: string[] = []
    if (roles.value.main === modelId) result.push('main')
    if (roles.value.secretary === modelId) result.push('secretary')
    if (roles.value.reflection === modelId) result.push('reflection')
    if (roles.value.aux === modelId) result.push('aux')
    return result
  }

  /** 获取 Embedding 远程模型列表 */
  async function fetchRemoteEmbeddingModels(): Promise<void> {
    // 优先使用 Embedding 专用配置，fallback 到全局 openai / siliconflow
    const apiKey =
      embeddingApiKey.value ||
      globalConfig.value.openai?.apiKey ||
      globalConfig.value.siliconflow?.apiKey ||
      ''
    const apiBase =
      embeddingApiBase.value ||
      globalConfig.value.openai?.apiBase ||
      globalConfig.value.siliconflow?.apiBase ||
      undefined
    if (!apiKey) {
      error.value = '请先填写 Embedding API Key 或在全局服务商中配置'
      notify.toast('请先填写 Embedding API Key 或在全局服务商中配置', 'warning')
      return
    }
    isFetchingEmbedding.value = true
    error.value = null
    try {
      const res = await modelApi.listRemote({ provider: 'openai', apiKey, apiBase })
      remoteEmbeddingModels.value = res.data ?? []
      notify.toast(`已获取 ${remoteEmbeddingModels.value.length} 个 Embedding 模型`, 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('获取 Embedding 模型列表失败: ' + (e as Error).message, 'error')
    } finally {
      isFetchingEmbedding.value = false
    }
  }

  /** 获取 Reranker 远程模型列表 */
  async function fetchRemoteRerankerModels(): Promise<void> {
    const apiKey =
      rerankerApiKey.value ||
      globalConfig.value.openai?.apiKey ||
      globalConfig.value.siliconflow?.apiKey ||
      ''
    const apiBase =
      rerankerApiBase.value ||
      globalConfig.value.openai?.apiBase ||
      globalConfig.value.siliconflow?.apiBase ||
      undefined
    if (!apiKey) {
      error.value = '请先填写 Reranker API Key 或在全局服务商中配置'
      notify.toast('请先填写 Reranker API Key 或在全局服务商中配置', 'warning')
      return
    }
    isFetchingReranker.value = true
    error.value = null
    try {
      const res = await modelApi.listRemote({ provider: 'openai', apiKey, apiBase })
      remoteRerankerModels.value = res.data ?? []
      notify.toast(`已获取 ${remoteRerankerModels.value.length} 个 Reranker 模型`, 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('获取 Reranker 模型列表失败: ' + (e as Error).message, 'error')
    } finally {
      isFetchingReranker.value = false
    }
  }

  /** 保存向量配置 */
  async function saveVectorConfig(): Promise<void> {
    isSavingVector.value = true
    try {
      // 批量写入向量相关配置
      await configApi.set('embedding.provider', embeddingProvider.value)
      await configApi.set('embedding.model', embeddingModelId.value)
      await configApi.set('embedding.dimension', String(embeddingDimension.value))
      if (embeddingApiBase.value) await configApi.set('embedding.apiBase', embeddingApiBase.value)
      if (embeddingApiKey.value) await configApi.set('embedding.apiKey', embeddingApiKey.value)
      await configApi.set('reranker.enabled', String(rerankerEnabled.value))
      if (rerankerModelId.value) await configApi.set('reranker.model', rerankerModelId.value)
      notify.toast('向量模型配置已保存', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('向量配置保存失败: ' + (e as Error).message, 'error')
    } finally {
      isSavingVector.value = false
    }
  }

  /** 从后端加载全局服务商配置 */
  async function loadGlobalConfig(): Promise<void> {
    try {
      // 收集所有供应商的 key
      const providers = Object.keys(globalConfig.value) as Array<keyof typeof globalConfig.value>
      const keys = providers.flatMap((p) => [`global.${p}.apiBase`, `global.${p}.apiKey`])
      const res = await configApi.batch(keys)
      const d = res.data ?? {}
      for (const p of providers) {
        if (d[`global.${p}.apiBase`])
          globalConfig.value[p].apiBase = d[`global.${p}.apiBase`] as string
        if (d[`global.${p}.apiKey`])
          globalConfig.value[p].apiKey = d[`global.${p}.apiKey`] as string
      }
    } catch {
      // 首次使用，保持默认值
    }
  }

  /** 保存全局服务商配置到后端 */
  async function saveGlobalConfig(): Promise<void> {
    try {
      const providers = Object.keys(globalConfig.value) as Array<keyof typeof globalConfig.value>
      const pairs: Array<[string, string]> = []
      for (const p of providers) {
        const cfg = globalConfig.value[p]
        if (cfg.apiKey) pairs.push([`global.${p}.apiKey`, cfg.apiKey])
        if (cfg.apiBase) pairs.push([`global.${p}.apiBase`, cfg.apiBase])
      }
      // 逐个保存避免并发问题
      for (const [k, v] of pairs) {
        await configApi.set(k, v)
      }
      const keyCount = pairs.filter(([k]) => k.endsWith('.apiKey')).length
      notify.toast(`全局服务商配置已保存 (${keyCount} 个 API Key)`, 'success')
      logger.info('ModelConfig', `全局配置已保存: ${pairs.length} 项`)
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('全局服务商配置保存失败: ' + (e as Error).message, 'error')
      logger.error('ModelConfig', '全局配置保存失败', e)
    }
  }

  /** 从后端加载向量配置 */
  async function loadVectorConfig(): Promise<void> {
    try {
      const res = await configApi.batch([
        'embedding.provider',
        'embedding.model',
        'embedding.dimension',
        'embedding.apiBase',
        'embedding.apiKey',
        'reranker.enabled',
        'reranker.model',
        'reranker.apiBase',
        'reranker.apiKey',
      ])
      const d = res.data ?? {}
      if (d['embedding.provider'])
        embeddingProvider.value = d['embedding.provider'] as 'local' | 'api'
      if (d['embedding.model']) embeddingModelId.value = d['embedding.model'] as string
      if (d['embedding.dimension']) embeddingDimension.value = Number(d['embedding.dimension'])
      if (d['embedding.apiBase']) embeddingApiBase.value = d['embedding.apiBase'] as string
      if (d['embedding.apiKey']) embeddingApiKey.value = d['embedding.apiKey'] as string
      if (d['reranker.enabled'] !== undefined)
        rerankerEnabled.value = d['reranker.enabled'] === 'true'
      if (d['reranker.model']) rerankerModelId.value = d['reranker.model'] as string
      if (d['reranker.apiBase']) rerankerApiBase.value = d['reranker.apiBase'] as string
      if (d['reranker.apiKey']) rerankerApiKey.value = d['reranker.apiKey'] as string
    } catch {
      // 首次使用，保持默认值
    }
  }

  // ── 初始化 ──
  onMounted(async () => {
    await Promise.all([fetchModels(), fetchRoles(), loadGlobalConfig(), loadVectorConfig()])
  })

  return {
    // LLM
    models,
    currentTab,
    isLoading,
    error,
    roles,
    providerOptions,
    // 编辑器
    isEditorOpen,
    editingModel,
    editorForm,
    openEditor,
    saveModel,
    deleteModel,
    setRole,
    getModelRoles,
    fetchModels,
    // 远程模型列表
    remoteModels,
    isFetchingRemote,
    fetchRemoteModels,
    customProviderTypeOptions,
    handleProviderChange,
    providerDefaults,
    // 全局配置
    isGlobalOpen,
    globalConfig,
    saveGlobalConfig,
    // 向量
    embeddingProvider,
    embeddingModelId,
    embeddingDimension,
    embeddingApiBase,
    embeddingApiKey,
    rerankerEnabled,
    rerankerModelId,
    rerankerApiBase,
    rerankerApiKey,
    isSavingVector,
    saveVectorConfig,
    // 向量远程模型列表
    remoteEmbeddingModels,
    isFetchingEmbedding,
    fetchRemoteEmbeddingModels,
    remoteRerankerModels,
    isFetchingReranker,
    fetchRemoteRerankerModels,
  }
}
