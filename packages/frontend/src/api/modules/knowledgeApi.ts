import type { FactArchiveResult } from '@infos/shared'
import { apiClient } from '../client'

export const knowledgeApi = {
  facts: (query = '') => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('query', query.trim())
    const suffix = params.toString()
    return apiClient.get<FactArchiveResult>(`/knowledge/facts${suffix ? `?${suffix}` : ''}`)
  },

  /** 撤回事实，保留节点和历史关系边 */
  retractFact: (id: string) =>
    apiClient.delete<void>(`/knowledge/facts/${encodeURIComponent(id)}`),
}
