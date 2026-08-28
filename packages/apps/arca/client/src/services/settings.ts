/**
 * settings — 客户端服务
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
export interface ArcaModelConfig {
  id: string
  source: 'local' | 'kernel'
  name: string
  provider: string
  modelId: string
  apiBase?: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: string
  credentialConfigured: boolean
  createdAt: string
  updatedAt: string
}

export interface ArcaPreferences {
  modelConfigId: string
  defaultAgentId: string
  editorWidth: string
  motion: string
}

const preferenceStorageKey = 'arca.preferences.v1'

/** Arca本地偏好仓库；模型秘密不进入该仓库。 */
export const arcaPreferenceStore = {
  load(): ArcaPreferences {
    const stored = localStorage.getItem(preferenceStorageKey)
    if (stored) {
      try {
        return { ...defaults(), ...(JSON.parse(stored) as Partial<ArcaPreferences>) }
      } catch {
        // 损坏的非敏感偏好回退默认值，不影响文档和模型凭据。
      }
    }
    return defaults()
  },
  save(preferences: ArcaPreferences): void {
    localStorage.setItem(preferenceStorageKey, JSON.stringify(preferences))
  },
}

function defaults(): ArcaPreferences {
  return {
    modelConfigId: '',
    defaultAgentId: localStorage.getItem('arca-default-agent') ?? '',
    editorWidth: localStorage.getItem('arca-editor-width') ?? '840',
    motion: localStorage.getItem('arca-motion') ?? 'system',
  }
}
