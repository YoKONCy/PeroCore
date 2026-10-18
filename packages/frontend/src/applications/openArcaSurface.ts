import { arcaApi } from '../api/modules/arcaApi'
import { getApiBaseUrl } from '../api/transport'
import { invoke, isElectron } from '../utils/ipcAdapter'
import { useThreadStore } from '../stores/useThreadStore'

/** 从应用控制面取得连接信息，页面入口不自行猜测 Host 端口。 */
export async function resolveArcaUiUrl(startIfOffline = false): Promise<string> {
  let status =
    startIfOffline && isElectron()
      ? ((await invoke('arca:host-start')) as NonNullable<
          Awaited<ReturnType<typeof arcaApi.getStatus>>['data']
        >)
      : (await arcaApi.getStatus()).data
  if (startIfOffline && status?.ownership === 'offline' && status.managedRuntimeAvailable) {
    try {
      status = (await arcaApi.start()).data
    } catch {
      // 启动失败仍允许进入应用内的连接设置，查看诊断并重新启动。
      status = (await arcaApi.getStatus()).data
    }
  }
  const endpoint = status?.federation.discovery?.endpoint
  if (!status) throw new Error('无法取得 Arca 应用入口')
  const kernelOrigin = new URL(getApiBaseUrl(), window.location.href).origin
  const url = new URL(status.uiUrl, kernelOrigin)
  if (endpoint) {
    const browserEndpoint = new URL('/api/applications/arca/transport', kernelOrigin)
    browserEndpoint.protocol = browserEndpoint.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('endpoint', isElectron() ? endpoint : browserEndpoint.toString())
  }
  url.searchParams.set('kernelOrigin', kernelOrigin)
  const thread = useThreadStore()
  if (thread.threadId) {
    url.searchParams.set('originThreadId', thread.threadId)
    url.searchParams.set('originAgentId', thread.agentId)
  }
  if (!endpoint || status.federation.state !== 'connected')
    url.hash = '/settings?section=integration'
  return url.toString()
}
