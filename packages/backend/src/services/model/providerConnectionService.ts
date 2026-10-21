import { t as __t } from '../../lib/i18n'
import { randomUUID } from 'node:crypto'
import { AppError } from '../../lib/appError'
import type { ModelRepository } from '../../repositories/model.repo'
import type { ProviderConnectionInput } from '../../repositories/providerConnection.repo'
import { PROVIDER_DEFAULTS } from '../llm/modelConnection'
import type { LlmService } from '../llm/llmService'
import type { ModelRegistry } from '../llm/modelRegistry'

export class ProviderConnectionService {
  constructor(
    private models: ModelRepository,
    private llm: LlmService,
    private registry: ModelRegistry,
  ) {}

  private get repo() {
    return this.models.connections
  }

  async get(id: string) {
    const connection = await this.repo.findById(id)
    if (!connection) throw new AppError('CONFIG_ERROR', { message: '连接不存在，请刷新' })
    return {
      ...connection,
      apiBase: connection.apiBase || PROVIDER_DEFAULTS[connection.brand] || '',
    }
  }

  async list() {
    const models = await this.models.findAll()
    return (await this.repo.findAll()).map(({ apiKey, ...connection }) => ({
      ...connection,
      apiBase: connection.apiBase || PROVIDER_DEFAULTS[connection.brand] || '',
      hasApiKey: !!apiKey,
      models: models
        .filter((model) => model.providerConnectionId === connection.id)
        .map((model) => ({ id: model.id, name: model.name, override: model.connectionOverride })),
    }))
  }

  private validate(input: ProviderConnectionInput): ProviderConnectionInput {
    const name = input.name.trim()
    const apiBase = input.apiBase.trim() || PROVIDER_DEFAULTS[input.brand] || ''
    let url: URL
    try {
      url = new URL(apiBase)
    } catch {
      throw new AppError('VALIDATION_ERROR', { message: '请填写完整的 HTTP 或 HTTPS API 地址' })
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new AppError('VALIDATION_ERROR', {
        message: '请输入不含认证信息、查询参数或片段的 HTTP/HTTPS 地址',
      })
    }
    if (!name) throw new AppError('VALIDATION_ERROR', { message: '请填写连接名称' })
    return {
      ...input,
      name,
      apiBase: apiBase.replace(/\/+$/, ''),
      apiKey: input.authMode === 'none' ? '' : input.apiKey.trim(),
    }
  }

  async create(input: ProviderConnectionInput) {
    const id = randomUUID()
    await this.repo.create(id, this.validate(input))
    this.registry.invalidateCache()
    return { id }
  }

  async update(id: string, input: Partial<ProviderConnectionInput>) {
    const existing = await this.get(id)
    await this.repo.update(id, this.validate({ ...existing, ...input }))
    this.registry.invalidateCache()
    return { id }
  }

  async remove(id: string, replacementId?: string) {
    await this.get(id)
    await this.repo.remove(id, replacementId)
    this.registry.invalidateCache()
  }

  async listModels(id: string) {
    const connection = await this.get(id)
    return this.llm.listModels({
      provider: connection.brand,
      protocol: connection.protocol as 'openai' | 'anthropic' | 'gemini',
      apiBase: connection.apiBase || PROVIDER_DEFAULTS[connection.brand],
      apiKey: connection.authMode === 'none' ? '' : connection.apiKey,
      modelId: '',
    })
  }

  /** 网络可达、列表权限和模型推理是三项独立结果。 */
  async probe(id: string) {
    const connection = await this.get(id)
    const start = Date.now()
    try {
      const response = await fetch(
        connection.apiBase || PROVIDER_DEFAULTS[connection.brand] || '',
        {
          method: 'GET',
          signal: AbortSignal.timeout(10_000),
        },
      )
      await response.body?.cancel()
      return {
        reachable: true,
        status: response.status,
        durationMs: Date.now() - start,
        message: __t('server.model', '地址可达 · HTTP {0}', [response.status]),
      }
    } catch (error) {
      return {
        reachable: false,
        durationMs: Date.now() - start,
        message: error instanceof Error ? error.message : __t('server.model', '连接失败'),
      }
    }
  }
}
