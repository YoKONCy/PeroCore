import type {
  TokenUsageFilterOptions,
  TokenUsageFilters,
  TokenUsagePeriod,
  TokenUsageStatistics,
} from '@infos/shared'
import { apiClient } from '../client'

export const tokenUsageApi = {
  filters: (agentId?: string) =>
    apiClient.get<TokenUsageFilterOptions>(
      `/system/token-usage/filters${agentId ? `?${new URLSearchParams({ agentId })}` : ''}`,
    ),
  statistics(
    period: TokenUsagePeriod,
    timeZone: string,
    agentId?: string,
    signal?: AbortSignal,
    filters: TokenUsageFilters = {},
  ) {
    const query = new URLSearchParams({ period, timeZone })
    if (agentId) query.set('agentId', agentId)
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
    return apiClient.request<TokenUsageStatistics>(`/system/token-usage?${query}`, { signal })
  },
}
