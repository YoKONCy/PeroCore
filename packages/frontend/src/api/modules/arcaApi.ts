/**
 * arcaApi — API 契约适配层
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import type { ApplicationDiscoveryRecord, SurfaceProjectionSnapshot } from '@infos/shared'
import { apiClient } from '../client'

export type ArcaDiscoveryStatus = ApplicationDiscoveryRecord

export interface ArcaApplicationStatus {
  ownership: 'offline' | 'managed' | 'adopted'
  hostState: 'offline' | 'starting' | 'running' | 'stopping' | 'error'
  federation: {
    state: 'offline' | 'connecting' | 'connected' | 'error'
    discoveryPath: string
    discovery?: ArcaDiscoveryStatus
    lastConnectedAt?: string
    lastError?: string
  }
  managedRuntimeAvailable: boolean
  managedRuntimeReason?: string
  uiUrl: string
  pid?: number
  lastError?: string
}

export const arcaApi = {
  getStatus: () => apiClient.get<ArcaApplicationStatus>('/applications/arca/status'),
  getProjection: () => apiClient.get<SurfaceProjectionSnapshot>('/applications/arca/projection'),
  start: () => apiClient.post<ArcaApplicationStatus>('/applications/arca/start'),
  stop: () => apiClient.post<ArcaApplicationStatus>('/applications/arca/stop'),
  reconnect: () => apiClient.post<ArcaApplicationStatus>('/applications/arca/reconnect'),
}
