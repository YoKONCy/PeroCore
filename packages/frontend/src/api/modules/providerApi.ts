import { apiClient } from '../client'

export type ProviderProtocol = 'openai' | 'anthropic' | 'gemini'
export type ProviderAuthMode = 'api_key' | 'none'
export interface ProviderConnectionInput {
  name: string
  brand: string
  protocol: ProviderProtocol
  apiBase: string
  authMode: ProviderAuthMode
  apiKey: string
}
export interface ProviderConnectionItem extends Omit<ProviderConnectionInput, 'apiKey'> {
  id: string
  hasApiKey: boolean
  models: Array<{ id: number; name: string; override: boolean }>
}
export const providerApi = {
  list: () => apiClient.get<ProviderConnectionItem[]>('/models/providers'),
  get: (id: string) =>
    apiClient.get<ProviderConnectionInput & { id: string }>(
      `/models/providers/${encodeURIComponent(id)}`,
    ),
  create: (input: ProviderConnectionInput) =>
    apiClient.post<{ id: string }>('/models/providers', input),
  update: (id: string, input: Partial<ProviderConnectionInput>) =>
    apiClient.put<{ id: string }>(`/models/providers/${encodeURIComponent(id)}`, input),
  remove: (id: string, replacementId?: string) =>
    apiClient.delete(
      `/models/providers/${encodeURIComponent(id)}${replacementId ? `?replacementId=${encodeURIComponent(replacementId)}` : ''}`,
    ),
  probe: (id: string) =>
    apiClient.post<{ reachable: boolean; status?: number; durationMs: number; message: string }>(
      `/models/providers/${encodeURIComponent(id)}/probe`,
    ),
  listModels: (id: string) =>
    apiClient.post<string[]>(`/models/providers/${encodeURIComponent(id)}/models`),
}
