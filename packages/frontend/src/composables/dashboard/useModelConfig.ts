/**
 * useModelConfig — 模型配置 composable
 *
 * 管理 LLM 模型列表的 CRUD + 角色分配 (主/秘书/反思/辅助)
 * 以及向量模型 (Embedding / Reranker) 配置。
 *
 * F1 阶段: 使用 mock 数据，F3 阶段替换为 modelApi 调用。
 */
import { ref, computed } from 'vue'

// ── 类型 ──

export interface LlmModel {
  id: string
  name: string
  provider: 'openai' | 'gemini' | 'anthropic' | 'custom'
  modelId: string
  maxTokens: number | null
  enableVision: boolean
  temperature: number
  topP: number
  apiBase?: string
  apiKey?: string
}

export interface ModelRoles {
  main: string | null
  secretary: string | null
  reflection: string | null
  aux: string | null
}

export type ModelTab = 'llm' | 'vector'

// ── Mock 数据 (F1 占位，F3 替换) ──

const MOCK_MODELS: LlmModel[] = [
  {
    id: 'gpt4o',
    name: 'GPT-4o',
    provider: 'openai',
    modelId: 'gpt-4o',
    maxTokens: 128000,
    enableVision: true,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'claude-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    modelId: 'claude-3-5-sonnet-20241022',
    maxTokens: 200000,
    enableVision: true,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    modelId: 'gemini-2.0-flash',
    maxTokens: 1000000,
    enableVision: true,
    temperature: 0.7,
    topP: 1,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek V3',
    provider: 'custom',
    modelId: 'deepseek-chat',
    maxTokens: 64000,
    enableVision: false,
    temperature: 0.7,
    topP: 1,
    apiBase: 'https://api.deepseek.com/v1',
  },
]

// ── Composable ──

export function useModelConfig() {
  // ── LLM 模型列表 ──
  const models = ref<LlmModel[]>([...MOCK_MODELS])
  const currentTab = ref<ModelTab>('llm')
  const isLoading = ref(false)

  // ── 模型角色 ──
  const roles = ref<ModelRoles>({
    main: 'gpt4o',
    secretary: 'claude-sonnet',
    reflection: 'gemini-pro',
    aux: 'deepseek',
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
  })

  // ── 全局配置弹窗 ──
  const isGlobalOpen = ref(false)
  const globalConfig = ref({
    openai: { apiBase: 'https://api.openai.com/v1', apiKey: '' },
    anthropic: { apiBase: 'https://api.anthropic.com', apiKey: '' },
    gemini: { apiBase: 'https://generativelanguage.googleapis.com', apiKey: '' },
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
    { label: 'OpenAI', value: 'openai' },
    { label: 'Anthropic (Claude)', value: 'anthropic' },
    { label: 'Google (Gemini)', value: 'gemini' },
    { label: '自定义 (兼容 OpenAI)', value: 'custom' },
  ])

  // ── 操作方法 ──

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
      }
    }
    isEditorOpen.value = true
  }

  function saveModel() {
    if (editingModel.value) {
      // 编辑模式
      const idx = models.value.findIndex((m) => m.id === editingModel.value!.id)
      if (idx !== -1) models.value[idx] = { ...editorForm.value }
    } else {
      // 新增模式
      const newId = editorForm.value.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
      models.value.push({ ...editorForm.value, id: newId })
    }
    isEditorOpen.value = false
  }

  function deleteModel(id: string) {
    models.value = models.value.filter((m) => m.id !== id)
    // 清理角色引用
    for (const key of Object.keys(roles.value) as Array<keyof ModelRoles>) {
      if (roles.value[key] === id) roles.value[key] = null
    }
  }

  function setRole(role: keyof ModelRoles, modelId: string) {
    // 如果该模型已被分配为同一角色，则取消
    if (roles.value[role] === modelId) {
      roles.value[role] = null
    } else {
      roles.value[role] = modelId
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

  function saveVectorConfig() {
    isSavingVector.value = true
    // TODO: F3 阶段替换为 configApi.setBatch(...)
    setTimeout(() => { isSavingVector.value = false }, 800)
  }

  return {
    // LLM
    models,
    currentTab,
    isLoading,
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
    // 全局配置
    isGlobalOpen,
    globalConfig,
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
  }
}
