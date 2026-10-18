import type { TokenUsagePeriod, TokenUsageStatistics } from '@infos/shared'
import { apiClient } from '../client'

export const tokenUsageApi = {
  statistics(period: TokenUsagePeriod, timeZone: string, agentId?: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ period, timeZone })
    if (agentId) query.set('agentId', agentId)
    return apiClient.request<TokenUsageStatistics>(`/system/token-usage?${query}`, { signal })
  },
}
