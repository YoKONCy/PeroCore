import type {
  ExtensionToolId,
  IntegrationFeature,
  IntegrationSourceInput,
  IntegrationsView,
} from '@infos/shared'
import { apiClient } from '../client'

export const integrationsApi = {
  get: () => apiClient.get<IntegrationsView>('/integrations'),
  extension: (
    id: ExtensionToolId,
    input: {
      enabled: boolean
      chatEnabled?: boolean
      endpoint: string
      apiKey?: string
      clearApiKey?: boolean
      maxResults: number
    },
  ) => apiClient.put<IntegrationsView>(`/integrations/extensions/${id}`, input),
  feature: (
    kind: IntegrationFeature,
    input: { enabled: boolean; selectedSourceId: string | null },
  ) => apiClient.put<IntegrationsView>(`/integrations/features/${kind}`, input),
  saveSource: (kind: IntegrationFeature, source: IntegrationSourceInput) =>
    apiClient.post<IntegrationsView>(`/integrations/features/${kind}/sources`, source),
  removeSource: (kind: IntegrationFeature, id: string) =>
    apiClient.delete<IntegrationsView>(
      `/integrations/features/${kind}/sources/${encodeURIComponent(id)}`,
    ),
}
