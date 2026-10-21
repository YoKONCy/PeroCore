import { apiClient } from '../client'

export interface ClientSession {
  authenticated: boolean
  admin: boolean
  deviceId?: string
}
export interface AccessStatus {
  enabled: boolean
  listening: boolean
  port: number
  managedByDocker: boolean
  lastError: string
  addresses: string[]
  devices: Array<{ id: string; name: string; admin: boolean; createdAt: number; expiresAt: number }>
}
export const clientAccessApi = {
  session: () =>
    apiClient.request<ClientSession>('/client-access/status', {
      signal: AbortSignal.timeout(10_000),
    }),
  status: () => apiClient.get<AccessStatus>('/client-access'),
  configure: (enabled: boolean, port: number) =>
    apiClient.put<AccessStatus>('/client-access/settings', { enabled, port }),
  pairing: () => apiClient.post<{ code: string; expiresAt: number }>('/client-access/pairings'),
  connect: (mode: 'pair' | 'login', code: string, name: string, remember: boolean) =>
    apiClient.post(`/client-access/${mode}`, { code, name, remember }),
  revoke: (id: string) => apiClient.delete(`/client-access/devices/${encodeURIComponent(id)}`),
  logout: () => apiClient.post('/client-access/logout'),
}
