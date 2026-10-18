import { apiClient } from '../api/client'
import { getApiBaseUrl } from '../api/transport'
import { invoke, isElectron } from '../utils/ipcAdapter'

interface PictoriaEntry {
  ownership: string
  managedRuntimeAvailable: boolean
  managedRuntimeReason?: string
  lastError?: string
  federation: { state: string }
  uiUrl: string
}
export async function resolvePictoriaUiUrl(agentId?: string): Promise<string> {
  const desktop = isElectron()
  let status = desktop
    ? ((await invoke('pictoria:host-start')) as PictoriaEntry)
    : (await apiClient.get<PictoriaEntry>('/applications/pictoria/status')).data
  if (!desktop && status?.ownership === 'offline' && status.managedRuntimeAvailable) {
    status = (await apiClient.post<PictoriaEntry>('/applications/pictoria/start')).data
  }
  if (!status?.uiUrl) throw new Error('Pictoria 画布入口尚未配置')
  if (status.federation.state !== 'connected') {
    throw new Error(
      status.lastError || status.managedRuntimeReason || 'Pictoria 后台尚未连接，请稍后重试',
    )
  }
  const origin = new URL(getApiBaseUrl(), window.location.href).origin
  const url = new URL(status.uiUrl, origin)
  url.searchParams.set('kernelOrigin', origin)
  if (agentId) url.searchParams.set('agentId', agentId)
  return url.toString()
}
