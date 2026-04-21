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
  providerType?: string
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
  }
}

// ── Composable ──

export function useModelConfig() {
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
      console.error('[ModelConfig] 加载模型列表失败:', e)
    } finally {
      isLoading.value = false
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
      }
    }
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
      } else {
        // 创建
        await modelApi.create({
          name: form.name,
          provider: form.provider,
          modelId: form.modelId,
          apiKey: form.apiKey || '',
          apiBase: form.apiBase || undefined,
        })
      }
      isEditorOpen.value = false
      await fetchModels()
    } catch (e) {
      error.value = (e as Error).message
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
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 设置角色 */
  async function setRole(role: keyof ModelRoles, modelId: string): Promise<void> {
    if (roles.value[role] === modelId) {
      roles.value[role] = null
      await configApi.set(`model.role.${role}`, '')
    } else {
      roles.value[role] = modelId
      await configApi.set(`model.role.${role}`, modelId)
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
    } catch (e) {
      error.value = (e as Error).message
    } finally {
      isSavingVector.value = false
    }
  }

  // ── 初始化 ──
  onMounted(async () => {
    await Promise.all([fetchModels(), fetchRoles()])
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
