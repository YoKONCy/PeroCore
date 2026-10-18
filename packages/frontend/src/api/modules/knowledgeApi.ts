import type {
  FactArchiveResult,
  KnowledgeDocumentInfo,
  KnowledgeDocumentDetail,
  KnowledgeDocumentList,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
} from '@infos/shared'
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
    apiClient.post<void>(`/knowledge/facts/${encodeURIComponent(id)}/retract`),
  deleteFact: (id: string) => apiClient.delete<void>(`/knowledge/facts/${encodeURIComponent(id)}`),

  documents: (query = '', page = 1) =>
    apiClient.get<KnowledgeDocumentList>(
      `/knowledge/documents?${new URLSearchParams({ query, page: String(page), pageSize: '30' })}`,
    ),
  document: (id: string) =>
    apiClient.get<KnowledgeDocumentDetail>(`/knowledge/documents/${encodeURIComponent(id)}`),
  importDocument: (input: {
    kind: 'text' | 'url'
    title?: string
    content?: string
    url?: string
    replaceId?: string
  }) => apiClient.post<KnowledgeDocumentInfo>('/knowledge/documents', input),
  uploadDocument: (file: File, title: string, replaceId?: string) => {
    const form = new FormData()
    form.set('file', file)
    form.set('title', title)
    if (replaceId) form.set('replaceId', replaceId)
    return apiClient.post<KnowledgeDocumentInfo>('/knowledge/documents/upload', form)
  },
  retryDocument: (id: string) =>
    apiClient.post<KnowledgeDocumentInfo>(`/knowledge/documents/${encodeURIComponent(id)}/retry`),
  deleteDocument: (id: string) =>
    apiClient.delete<void>(`/knowledge/documents/${encodeURIComponent(id)}`),
  reindex: () => apiClient.post<void>('/knowledge/reindex'),
  search: (input: KnowledgeSearchInput) =>
    apiClient.post<KnowledgeSearchResult>('/knowledge/search', input),
}
