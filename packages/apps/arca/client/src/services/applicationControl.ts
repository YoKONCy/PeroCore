import type { ApplicationDiscoveryRecord } from '@infos/shared'
import { arcaHostRequest } from './hostBridge'

export interface ArcaApplicationStatus {
  ownership: 'offline' | 'managed' | 'adopted'
  hostState: 'offline' | 'starting' | 'running' | 'stopping' | 'error'
  federation: {
    state: 'offline' | 'connecting' | 'connected' | 'error'
    discoveryPath: string
    discovery?: ApplicationDiscoveryRecord
    lastConnectedAt?: string
    lastError?: string
  }
  managedRuntimeAvailable: boolean
  managedRuntimeReason?: string
  uiUrl: string
  pid?: number
  lastError?: string
}

/** 嵌入模式通过限定操作访问自身控制面，系统凭据保留在主进程。 */
async function request(
  action: 'status' | 'start' | 'stop' | 'reconnect',
): Promise<ArcaApplicationStatus> {
  return arcaHostRequest<ArcaApplicationStatus>(action)
}

export const arcaApplicationControl = {
  status: () => request('status'),
  start: () => request('start'),
  stop: () => request('stop'),
  reconnect: () => request('reconnect'),
}
