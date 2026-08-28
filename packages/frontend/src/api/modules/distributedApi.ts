import { apiClient } from '../client'

export interface DistributedIdentity {
  serverId: string
  displayName: string
  appVersion: string
}

export interface SavedServer {
  serverId: string
  displayName: string
  endpoint: string
  certificateFingerprint?: string
  savedAt: string
  lastConnectedAt?: string
}

export interface ServerProbe extends DistributedIdentity {
  endpoint: string
  latencyMs: number
}

export interface FullSyncManifest {
  bundleVersion: number
  schemaVersion: number
  snapshotId: string
  sourceServerId: string
  appVersion: string
  createdAt: string
  totalBytes: number
  files: Array<{ path: string; sizeBytes: number; sha256: string }>
}

export interface CapabilityNodeStatus {
  nodes: Array<{
    nodeId: string
    displayName: string
    facets: readonly string[]
    trust: string
  }>
  sessions: Array<{
    sessionId: string
    nodeId: string
    health: string
    leaseExpiresAt: string
  }>
  offers: Array<{
    offerId: string
    capabilityType: string
    health: string
    operations: readonly string[]
  }>
}

export const distributedApi = {
  identity: () => apiClient.get<DistributedIdentity>('/distributed/identity'),
  servers: () => apiClient.get<SavedServer[]>('/distributed/servers'),
  probe: (input: { endpoint: string; token: string }) =>
    apiClient.post<ServerProbe>('/distributed/servers/probe', input),
  saveServer: (input: { endpoint: string; token: string; displayName?: string }) =>
    apiClient.post<SavedServer>('/distributed/servers', input),
  removeServer: (serverId: string) =>
    apiClient.delete<{ removed: boolean }>(`/distributed/servers/${encodeURIComponent(serverId)}`),
  syncFrom: (serverId: string) =>
    apiClient.post<{ manifest: FullSyncManifest; restartRequired: boolean }>(
      `/distributed/sync/${encodeURIComponent(serverId)}`,
    ),
  pending: () =>
    apiClient.get<{
      pending: { snapshotId: string; sourceServerId: string } | null
      lastSync: (FullSyncManifest & { backupPath: string }) | null
    }>('/distributed/pending'),
  rollback: () =>
    apiClient.post<{ staged: boolean; restartRequired: boolean }>('/distributed/rollback'),
  capabilityNodes: () => apiClient.get<CapabilityNodeStatus>('/distributed/capability-nodes'),
  createCapabilityInvite: () =>
    apiClient.post<{ endpoint: string; pairingCode: string; expiresAt: string }>(
      '/distributed/capability-invites',
    ),
}
