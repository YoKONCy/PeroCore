/**
 * useModelConfig — 模型配置 composable
 *
 * 管理 LLM 模型列表的 CRUD + 任务指派 (主模型 + 任务槽)
 * 以及向量模型 (Embedding / Reranker) 配置。
 *
 * F3: 已对接 modelApi + configApi 真实后端。
 *
 * @module packages/frontend/src/composables/dashboard/useModelConfig
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { modelApi } from '../../api/modules/modelApi'
import type { ModelConfigItem, ReasoningEffort } from '../../api/modules/modelApi'
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
  contextWindowTokens: number | null
  reasoningEffort: ReasoningEffort | null
  returnNativeReasoning: boolean
  wireApi: 'chat_completions' | 'responses'
  reasoningDialect: 'auto' | 'openai' | 'deepseek' | 'openrouter' | 'generic'
  stream: boolean
  enableVision: boolean
  enableAudioInput: boolean
  temperature: number | null
  topP: number | null
  apiBase?: string
  apiKey?: string
  /** 自定义 provider 的协议格式 (openai/anthropic/gemini) */
  providerType: string
}

export type ModelTab = 'llm' | 'vector' | 'multimodal'

/** 任务槽元数据（供前端 UI 使用） */
export const TASK_SLOTS = [
  {
    key: 'scorer',
    label: '整理长期记忆',
    description: '从对话中找出以后仍值得记住的内容',
    icon: 'brain',
  },
  {
    key: 'reflection',
    label: '整理记忆关系',
    description: '关联相近经历、修正内容并减少重复记忆',
    icon: 'link',
  },
  {
    key: 'social_scorer',
    label: '整理社交记忆',
    description: '从社交互动中保留重要的人物印象与经历',
    icon: 'chat',
  },
  {
    key: 'butler',
    label: '据点管家',
    description: '理解房间管理请求，并协助安排角色与环境',
    icon: 'home',
  },
] as const

// ── 辅助函数 ──

/** 后端 DTO → 前端 LlmModel */
function toLlmModel(item: ModelConfigItem): LlmModel {
  return {
    id: String(item.id),
    name: item.name,
    provider: item.provider,
    modelId: item.modelId,
    maxTokens: item.maxTokens,
    contextWindowTokens: item.contextWindowTokens,
    reasoningEffort: item.reasoningEffort,
    returnNativeReasoning: item.returnNativeReasoning ?? false,
    wireApi: item.wireApi ?? 'chat_completions',
    reasoningDialect: item.reasoningDialect ?? 'auto',
    stream: item.stream ?? true,
    enableVision: item.enableVision ?? false,
    enableAudioInput: item.enableAudioInput ?? false,
    temperature: item.temperature,
    topP: item.topP,
    apiBase: item.apiBase,
    apiKey: item.apiKey, // 后端已遮蔽
    providerType: item.providerType ?? 'openai',
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

  // ── 主模型 + 任务指派 ──
  const mainModelId = ref<string | null>(null)
  const taskAssignments = ref<Record<string, string | null>>({})
  const agentAssignments = ref<Record<string, string | null>>({})
  // 指派弹窗
  const isTaskAssignOpen = ref(false)
  const isAgentAssignOpen = ref(false)

  // ── 编辑弹窗 ──
  const isEditorOpen = ref(false)
  const editingModel = ref<LlmModel | null>(null)
  const editorForm = ref<LlmModel>({
    id: '',
    name: '',
    provider: 'openai',
    modelId: '',
    maxTokens: null,
    contextWindowTokens: null,
    reasoningEffort: null,
    returnNativeReasoning: false,
    wireApi: 'chat_completions',
    reasoningDialect: 'auto',
    stream: true,
    enableVision: false,
    enableAudioInput: false,
    temperature: null,
    topP: null,
    apiBase: '',
    apiKey: '',
    providerType: 'openai',
  })

  // ── 全局配置弹窗 ──
  const isGlobalOpen = ref(false)
  // 每个主流供应商的全局 apiBase/apiKey
  const globalConfig = ref({
    openai: { apiBase: 'https://api.openai.com/v1', apiKey: '' },
    anthropic: { apiBase: 'https://api.anthropic.com/v1', apiKey: '' },
    gemini: { apiBase: 'https://generativelanguage.googleapis.com/v1beta', apiKey: '' },
    siliconflow: { apiBase: 'https://api.siliconflow.cn/v1', apiKey: '' },
    deepseek: { apiBase: 'https://api.deepseek.com/v1', apiKey: '' },
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
  const embeddingActivationResult = ref<{
    status: 'success' | 'error'
    message: string
    durationMs?: number
  } | null>(null)

  // ── 多模态转述配置 ──
  const relayEnabled = ref(false)
  const relayModelConfigId = ref<string>('')
  const relayDetail = ref<'brief' | 'standard' | 'detailed'>('standard')
  const isSavingRelay = ref(false)
  const visionModels = computed(() => models.value.filter((model) => model.enableVision))

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
    anthropic: 'https://api.anthropic.com/v1',
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

  /** 从后端加载主模型配置 (config KV: model.main) */
  async function fetchMainModel(): Promise<void> {
    try {
      const res = await configApi.get('model.main')
      mainModelId.value = (res.data?.value as string) || null
    } catch {
      // 首次使用可能不存在配置，保持默认
    }
  }

  /** 从后端批量加载任务指派 (config KV: model.task.*) */
  async function fetchTaskAssignments(): Promise<void> {
    try {
      const keys = TASK_SLOTS.map((s) => `model.task.${s.key}`)
      const res = await configApi.batch(keys)
      const data = res.data ?? {}
      const next: Record<string, string | null> = {}
      for (const slot of TASK_SLOTS) {
        const v = data[`model.task.${slot.key}`]
        next[slot.key] = (v as string) || null
      }
      taskAssignments.value = next
    } catch {
      // 首次使用可能不存在配置，保持默认
    }
  }

  /** 按当前角色列表加载角色模型指派。 */
  async function fetchAgentAssignments(agentIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(agentIds.map((id) => id.trim().toLowerCase()).filter(Boolean))]
    if (uniqueIds.length === 0) {
      agentAssignments.value = {}
      return
    }
    try {
      const keys = uniqueIds.map((id) => `model.agent.${id}`)
      const res = await configApi.batch(keys)
      const data = res.data ?? {}
      agentAssignments.value = Object.fromEntries(
        uniqueIds.map((id) => [id, (data[`model.agent.${id}`] as string) || null]),
      )
    } catch {
      agentAssignments.value = Object.fromEntries(uniqueIds.map((id) => [id, null]))
    }
  }

  async function openEditor(model: LlmModel | null): Promise<void> {
    if (model) {
      editingModel.value = model
      isLoading.value = true
      try {
        const response = await modelApi.getById(model.id)
        editorForm.value = toLlmModel(response.data ?? (model as ModelConfigItem))
      } catch (e) {
        error.value = (e as Error).message
        notify.toast('加载模型完整配置失败: ' + (e as Error).message, 'error')
        return
      } finally {
        isLoading.value = false
      }
    } else {
      editingModel.value = null
      editorForm.value = {
        id: '',
        name: '',
        provider: 'openai',
        modelId: '',
        maxTokens: null,
        contextWindowTokens: null,
        reasoningEffort: null,
        returnNativeReasoning: false,
        wireApi: 'chat_completions',
        reasoningDialect: 'auto',
        stream: true,
        enableVision: false,
        enableAudioInput: false,
        temperature: null,
        topP: null,
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
          apiKey:
            form.apiKey && form.apiKey !== editingModel.value.apiKey ? form.apiKey : undefined,
          apiBase: form.apiBase || undefined,
          temperature: form.temperature,
          topP: form.topP,
          maxTokens: form.maxTokens,
          contextWindowTokens: form.contextWindowTokens,
          reasoningEffort: form.reasoningEffort,
          returnNativeReasoning: form.returnNativeReasoning,
          wireApi: form.wireApi,
          reasoningDialect: form.reasoningDialect,
          stream: form.stream,
          enableVision: form.enableVision,
          enableAudioInput: form.enableAudioInput,
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
          temperature: form.temperature,
          topP: form.topP,
          maxTokens: form.maxTokens,
          contextWindowTokens: form.contextWindowTokens,
          reasoningEffort: form.reasoningEffort,
          returnNativeReasoning: form.returnNativeReasoning,
          wireApi: form.wireApi,
          reasoningDialect: form.reasoningDialect,
          stream: form.stream,
          enableVision: form.enableVision,
          enableAudioInput: form.enableAudioInput,
        })
        notify.toast(`模型 "${form.name}" 已添加`, 'success')
      }
      isEditorOpen.value = false
      await fetchModels()
      window.dispatchEvent(new CustomEvent('infos:model-capabilities-changed'))
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
      // 清理主模型引用
      if (mainModelId.value === id) {
        mainModelId.value = null
        await configApi.set('model.main', '')
      }
      // 清理任务与角色指派引用
      for (const slot of TASK_SLOTS) {
        if (taskAssignments.value[slot.key] === id) {
          taskAssignments.value[slot.key] = null
          await configApi.set(`model.task.${slot.key}`, '')
        }
      }
      for (const [agentId, assignedModelId] of Object.entries(agentAssignments.value)) {
        if (assignedModelId === id) {
          agentAssignments.value[agentId] = null
          await configApi.set(`model.agent.${agentId}`, '')
        }
      }
      notify.toast('模型已删除', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('删除模型失败: ' + (e as Error).message, 'error')
    }
  }

  /** 从模型卡片直接切换布尔配置，失败时保持原值。 */
  async function setModelToggle(
    model: LlmModel,
    field: 'stream' | 'enableVision' | 'enableAudioInput',
    enabled: boolean,
  ): Promise<void> {
    try {
      await modelApi.update(model.id, { [field]: enabled })
      models.value = models.value.map((item) =>
        item.id === model.id ? { ...item, [field]: enabled } : item,
      )
      const label =
        field === 'stream' ? '流式输出' : field === 'enableVision' ? '图片输入' : '音频输入'
      notify.toast(`${label}已${enabled ? '启用' : '关闭'}`, enabled ? 'success' : 'info')
    } catch (e) {
      notify.toast('模型配置保存失败: ' + (e as Error).message, 'error')
    }
  }

  /** 设置主模型 (config KV: model.main) */
  async function setMainModel(modelId: string): Promise<void> {
    try {
      mainModelId.value = modelId
      await configApi.set('model.main', modelId)
      notify.toast('已设置为主模型', 'success')
    } catch (e) {
      notify.toast('主模型设置失败: ' + (e as Error).message, 'error')
    }
  }

  /** 设置任务指派 (config KV: model.task.{taskSlot}) */
  async function setTaskAssignment(taskSlot: string, modelId: string | null): Promise<void> {
    try {
      taskAssignments.value[taskSlot] = modelId
      await configApi.set(`model.task.${taskSlot}`, modelId ?? '')
      notify.toast(modelId ? '已指派任务模型' : '已取消任务指派', modelId ? 'success' : 'info')
    } catch (e) {
      notify.toast('任务指派失败: ' + (e as Error).message, 'error')
    }
  }

  /** 设置角色指派。 */
  async function setAgentAssignment(agentId: string, modelId: string | null): Promise<void> {
    const normalizedAgentId = agentId.trim().toLowerCase()
    if (!normalizedAgentId) return
    const previous = agentAssignments.value[normalizedAgentId] ?? null
    agentAssignments.value[normalizedAgentId] = modelId
    try {
      await configApi.set(`model.agent.${normalizedAgentId}`, modelId ?? '')
      notify.toast(modelId ? '已指派角色模型' : '已恢复主模型', modelId ? 'success' : 'info')
    } catch (e) {
      agentAssignments.value[normalizedAgentId] = previous
      notify.toast('角色指派失败: ' + (e as Error).message, 'error')
    }
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

  /** 真实激活候选Embedding模型，向量与配置维度一致后才由后端保存。 */
  async function saveVectorConfig(): Promise<void> {
    if (embeddingProvider.value !== 'api') {
      embeddingActivationResult.value = { status: 'error', message: '当前仅支持在线 API Embedding' }
      return
    }
    if (!embeddingModelId.value.trim()) {
      embeddingActivationResult.value = { status: 'error', message: '请填写 Embedding 模型 ID' }
      return
    }
    isSavingVector.value = true
    embeddingActivationResult.value = null
    error.value = null
    try {
      const response = await configApi.activateEmbedding({
        provider: 'api',
        model: embeddingModelId.value.trim(),
        dimension: embeddingDimension.value,
        apiBase: embeddingApiBase.value.trim() || undefined,
        apiKey: embeddingApiKey.value.trim() || undefined,
        reranker: {
          enabled: rerankerEnabled.value,
          model: rerankerModelId.value.trim() || undefined,
          apiBase: rerankerApiBase.value.trim() || undefined,
          apiKey: rerankerApiKey.value.trim() || undefined,
        },
      })
      const result = response.data
      if (!result) throw new Error('后端未返回Embedding激活结果')
      embeddingActivationResult.value = {
        status: 'success',
        durationMs: result.durationMs,
        message: `激活成功：${result.dimension} 维，调用耗时 ${result.durationMs} ms`,
      }
      notify.toast(embeddingActivationResult.value.message, 'success')
    } catch (e) {
      const message = (e as Error).message || 'Embedding 模型激活失败'
      error.value = message
      embeddingActivationResult.value = { status: 'error', message }
      notify.toast('Embedding 模型激活失败：' + message, 'error')
    } finally {
      isSavingVector.value = false
    }
  }

  /** 加载多模态转述配置。 */
  async function loadRelayConfig(): Promise<void> {
    try {
      const res = await configApi.batch([
        'multimodalRelay.enabled',
        'multimodalRelay.modelConfigId',
        'multimodalRelay.detail',
      ])
      const data = res.data ?? {}
      relayEnabled.value = data['multimodalRelay.enabled'] === 'true'
      relayModelConfigId.value = data['multimodalRelay.modelConfigId'] || ''
      const detail = data['multimodalRelay.detail']
      relayDetail.value = detail === 'brief' || detail === 'detailed' ? detail : 'standard'
    } catch {
      // 首次使用时保留默认配置。
    }
  }

  /** 保存多模态转述配置，只允许引用已声明视觉能力的模型。 */
  async function saveRelayConfig(): Promise<void> {
    if (
      relayEnabled.value &&
      !visionModels.value.some((model) => model.id === relayModelConfigId.value)
    ) {
      notify.toast('请选择已启用图片视觉能力的转述模型', 'warning')
      return
    }
    isSavingRelay.value = true
    try {
      await configApi.batchSet([
        { key: 'multimodalRelay.enabled', value: String(relayEnabled.value) },
        { key: 'multimodalRelay.modelConfigId', value: relayModelConfigId.value ?? '' },
        { key: 'multimodalRelay.detail', value: relayDetail.value },
      ])
      window.dispatchEvent(new CustomEvent('infos:model-capabilities-changed'))
      notify.toast('多模态转述配置已保存', 'success')
    } catch (e) {
      notify.toast('多模态转述配置保存失败: ' + (e as Error).message, 'error')
    } finally {
      isSavingRelay.value = false
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
    await Promise.all([
      fetchModels(),
      fetchMainModel(),
      fetchTaskAssignments(),
      loadGlobalConfig(),
      loadVectorConfig(),
      loadRelayConfig(),
    ])
  })

  return {
    // LLM
    models,
    currentTab,
    isLoading,
    error,
    mainModelId,
    taskAssignments,
    agentAssignments,
    isTaskAssignOpen,
    isAgentAssignOpen,
    providerOptions,
    // 编辑器
    isEditorOpen,
    editingModel,
    editorForm,
    openEditor,
    saveModel,
    deleteModel,
    setModelToggle,
    setMainModel,
    setTaskAssignment,
    setAgentAssignment,
    fetchMainModel,
    fetchTaskAssignments,
    fetchAgentAssignments,
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
    // 多模态转述
    relayEnabled,
    relayModelConfigId,
    relayDetail,
    isSavingRelay,
    visionModels,
    saveRelayConfig,
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
    embeddingActivationResult,
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
