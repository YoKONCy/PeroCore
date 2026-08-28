import type { FactArchiveResult } from '@infos/shared'
import { apiClient } from '../client'

export const knowledgeApi = {
  facts: (query = '') => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())
    const suffix = params.toString()
    return apiClient.get<FactArchiveResult>(`/knowledge/facts${suffix ? `?${suffix}` : ''}`)
  },
}
