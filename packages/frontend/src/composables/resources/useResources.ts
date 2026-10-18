import { shallowRef } from 'vue'
import type { MessageResource, ResourceOrigin } from '@infos/shared'
import { apiClient } from '../../api/client'
import { attachmentsApi } from '../../api/modules/attachmentsApi'
import { getApiBaseUrl } from '../../api/transport'
import { useNotificationStore } from '../../stores/useNotificationStore'

export const resourcePreview = shallowRef<MessageResource | null>(null)
export const resourceNavigation = shallowRef<{ origin: ResourceOrigin; revision: number } | null>(
  null,
)

let openRequest = 0

export function resourceUrl(item: MessageResource, download = false): string {
  if (item.id) return `${attachmentsApi.contentUrl(item.id)}${download ? '?download=1' : ''}`
  if (item.origin?.type === 'url') return item.origin.value
  if (item.origin?.type !== 'workspace') return ''
  const query = new URLSearchParams({
    agentId: item.origin.agentId || '',
    threadId: item.origin.threadId || '',
    source: `workspace:${encodeURIComponent(item.origin.value)}`,
  })
  if (item.origin.taskId) query.set('taskId', item.origin.taskId)
  if (download) query.set('download', '1')
  return `${getApiBaseUrl()}/attachments/reference-content?${query}`
}

export function openResource(item: MessageResource, source = false): void {
  const version = ++openRequest
  const origin = item.origin
  const html =
    ['text/html', 'application/xhtml+xml'].includes(item.mimeType.split(';')[0]!) ||
    /\.html?$/i.test(item.name)
  if (html && !source && origin?.type !== 'url') {
    const input = item.id
      ? { id: item.id }
      : {
          agentId: origin?.agentId,
          threadId: origin?.threadId,
          taskId: origin?.taskId,
          source:
            origin?.type === 'workspace'
              ? `workspace:${encodeURIComponent(origin.value)}`
              : undefined,
        }
    void apiClient
      .post<{ path: string }>('/attachments/browser-preview', input)
      .then((response) => {
        if (!response.data) throw new Error('HTML 页面暂不可用')
        if (version !== openRequest) return
        resourcePreview.value = null
        resourceNavigation.value = {
          origin: { type: 'url', value: new URL(response.data.path, getApiBaseUrl()).href },
          revision: (resourceNavigation.value?.revision || 0) + 1,
        }
      })
      .catch((error) => {
        if (version === openRequest)
          useNotificationStore().toast(
            error instanceof Error ? error.message : '无法打开 HTML 页面',
            { type: 'error' },
          )
      })
    return
  }
  if (
    origin &&
    (origin.type === 'arca' ||
      (origin.type === 'url' &&
        (html ||
          item.kind === 'web' ||
          source ||
          (!item.id && ['pdf', 'text'].includes(item.kind)))) ||
      (origin.type === 'workspace' && (!item.id || source) && !origin.taskId))
  ) {
    resourceNavigation.value = { origin, revision: (resourceNavigation.value?.revision || 0) + 1 }
    return
  }
  resourcePreview.value = source && origin?.type === 'workspace' ? { ...item, id: undefined } : item
}

export async function openResourceLink(
  source: string,
  context: { agentId: string; threadId: string; taskId?: string },
) {
  const version = ++openRequest
  const response = await apiClient.post<MessageResource>('/attachments/resolve-reference', {
    ...context,
    source,
  })
  if (!response.data) throw new Error('资源暂不可用')
  if (version === openRequest) openResource(response.data)
}

export async function resourceTextPreview(
  item: MessageResource,
): Promise<{ text: string; truncated: boolean }> {
  const response = await apiClient.post<{ text: string; truncated: boolean }>(
    '/attachments/preview-text',
    {
      id: item.id,
      agentId: item.origin?.agentId,
      threadId: item.origin?.threadId,
      taskId: item.origin?.taskId,
      source:
        item.origin?.type === 'workspace'
          ? `workspace:${encodeURIComponent(item.origin.value)}`
          : item.origin?.value,
    },
  )
  if (!response.data) throw new Error('无法读取文件')
  return response.data
}

export function resourceSize(size: number): string {
  if (!size) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 ** 2).toFixed(1)} MB`
}
