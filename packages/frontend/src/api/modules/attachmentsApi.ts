/**
 * attachmentsApi — API 契约适配层
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { apiClient } from '../client'
import { getApiBaseUrl } from '../transport'

export interface AttachmentInfo {
  id: string
  threadId: string
  messageId: number | null
  kind: 'image' | 'text'
  originalName: string
  mimeType: string
  sizeBytes: number
  contextPolicy: 'once'
  status: string
}

export const attachmentsApi = {
  upload: (file: File, threadId: string) => {
    const form = new FormData()
    form.append('file', file)
    form.append('threadId', threadId)
    return apiClient.request<AttachmentInfo>('/attachments', { method: 'POST', body: form })
  },

  contentUrl: (id: string) => `${getApiBaseUrl()}/attachments/${encodeURIComponent(id)}/content`,

  removeUnbound: (id: string) => apiClient.delete<void>(`/attachments/${encodeURIComponent(id)}`),
}
