/**
 * modelRepository — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ArcaSecretStore } from './secretStore'

export type ArcaModelSource = 'local' | 'kernel'

export interface ArcaModelConfig {
  id: string
  source: ArcaModelSource
  name: string
  provider: string
  modelId: string
  apiBase?: string
  credentialRef?: string
  temperature?: number
  maxTokens?: number
  reasoningEffort?: string
  createdAt: string
  updatedAt: string
}

export interface ArcaModelView extends Omit<ArcaModelConfig, 'credentialRef'> {
  credentialConfigured: boolean
}

interface ModelFile {
  version: 1
  selectedModelId: string
  models: ArcaModelConfig[]
}

export interface SaveArcaModelInput {
  id?: string
  name: string
  provider: string
  modelId: string
  apiBase?: string
  apiKey?: string
  temperature?: number | null
  maxTokens?: number | null
  reasoningEffort?: string | null
}

/** Arca独立模型配置Authority；非敏感配置与Secret Store严格分离。 */
export class ArcaModelRepository {
  private readonly filePath: string
  readonly secrets: ArcaSecretStore

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true })
    this.filePath = path.join(directory, 'models.json')
    this.secrets = new ArcaSecretStore(path.join(directory, 'secrets'))
  }

  list(): ArcaModelView[] {
    return this.read().models.map((model) => this.view(model))
  }

  selected(): string {
    return this.read().selectedModelId
  }

  select(modelId: string): void {
    const file = this.read()
    if (modelId && !file.models.some((model) => model.id === modelId)) {
      throw new Error('ARCA_MODEL_NOT_FOUND: 不能选择不存在的模型')
    }
    file.selectedModelId = modelId
    this.write(file)
  }

  save(input: SaveArcaModelInput): ArcaModelView {
    if (!input.name.trim()) throw new Error('ARCA_MODEL_NAME_REQUIRED: 配置名称不能为空')
    if (!input.provider.trim()) throw new Error('ARCA_MODEL_PROVIDER_REQUIRED: 供应商不能为空')
    if (!input.modelId.trim()) throw new Error('ARCA_MODEL_ID_REQUIRED: 模型ID不能为空')
    const file = this.read()
    const existing = input.id ? file.models.find((model) => model.id === input.id) : undefined
    if (input.id && !existing) throw new Error('ARCA_MODEL_NOT_FOUND: 模型配置不存在')
    const now = new Date().toISOString()
    let credentialRef = existing?.credentialRef
    if (input.apiKey?.trim()) credentialRef = this.secrets.put(input.apiKey.trim(), credentialRef)
    const model: ArcaModelConfig = {
      id: existing?.id ?? randomUUID(),
      source: 'local',
      name: input.name.trim(),
      provider: input.provider.trim(),
      modelId: input.modelId.trim(),
      ...(input.apiBase?.trim() ? { apiBase: input.apiBase.trim() } : {}),
      ...(credentialRef ? { credentialRef } : {}),
      ...(input.temperature !== null && input.temperature !== undefined
        ? { temperature: input.temperature }
        : {}),
      ...(input.maxTokens !== null && input.maxTokens !== undefined
        ? { maxTokens: input.maxTokens }
        : {}),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    file.models = file.models.filter((item) => item.id !== model.id)
    file.models.push(model)
    if (!file.selectedModelId) file.selectedModelId = model.id
    this.write(file)
    return this.view(model)
  }

  remove(id: string): boolean {
    const file = this.read()
    const existing = file.models.find((model) => model.id === id)
    if (!existing) return false
    file.models = file.models.filter((model) => model.id !== id)
    if (file.selectedModelId === id) file.selectedModelId = file.models[0]?.id ?? ''
    this.write(file)
    if (existing.credentialRef) this.secrets.remove(existing.credentialRef)
    return true
  }

  resolve(id?: string): ArcaModelConfig {
    const file = this.read()
    const target = id || file.selectedModelId
    const model = file.models.find((item) => item.id === target)
    if (!model) throw new Error('ARCA_MODEL_NOT_CONFIGURED: 尚未配置Arca本地模型')
    return structuredClone(model)
  }

  private view(model: ArcaModelConfig): ArcaModelView {
    const { credentialRef, ...safe } = model
    return { ...safe, credentialConfigured: this.secrets.has(credentialRef) }
  }

  private read(): ModelFile {
    if (!existsSync(this.filePath)) return { version: 1, selectedModelId: '', models: [] }
    const value = JSON.parse(readFileSync(this.filePath, 'utf8')) as ModelFile
    if (value.version !== 1 || !Array.isArray(value.models)) {
      throw new Error('ARCA_MODEL_STORE_INVALID: 模型配置仓库格式不受支持')
    }
    return value
  }

  private write(value: ModelFile): void {
    const temporary = `${this.filePath}.tmp`
    writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8')
    renameSync(temporary, this.filePath)
  }
}
