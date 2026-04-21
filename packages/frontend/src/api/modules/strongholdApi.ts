/**
 * Stronghold API 模块 — 据点/群聊管理
 *
 * 对接后端 /api/stronghold/* 路由。
 * 遵循统一信封规范 (ApiResponse<T>)。
 *
 * @module packages/frontend/src/api/modules/strongholdApi
 */

import { apiClient } from '../client'

// ── 类型定义 ──

export interface Facility {
  id: number
  name: string
  icon?: string
  description?: string
  roomCount?: number
}

export interface Room {
  id: number
  facilityId?: number
  name: string
  description?: string
  environment_json?: string
  /** 后端附带的 Agent 列表 */
  agents?: RoomAgent[]
}

export interface RoomAgent {
  agentId: string
  role?: string
}

export interface AgentLocation {
  agentId: string
  roomId: number
  roomName?: string
}

export interface GroupMessage {
  id: number
  roomId: string
  senderId: string
  content: string
  role: 'user' | 'assistant' | 'system'
  createdAt?: string
}

export interface ButlerConfig {
  id: number
  name: string
  enabled: boolean
  persona?: string
}

// ── API ──

export const strongholdApi = {
  // ═══ 设施 ═══

  /** 获取所有设施 */
  listFacilities: () => apiClient.get<Facility[]>('/stronghold/facilities'),

  /** 创建设施 */
  createFacility: (data: { name: string; icon?: string; description?: string }) =>
    apiClient.post<Facility>('/stronghold/facilities', data),

  // ═══ 房间 ═══

  /** 获取房间列表 (可按设施过滤) */
  listRooms: (facilityId?: number) =>
    apiClient.get<Room[]>(`/stronghold/rooms${facilityId ? `?facilityId=${facilityId}` : ''}`),

  /** 创建房间 */
  createRoom: (data: { facilityId: number; name: string; description?: string }) =>
    apiClient.post<Room>('/stronghold/rooms', data),

  /** 更新房间 */
  updateRoom: (roomId: string, data: { name?: string; description?: string }) =>
    apiClient.put<Room>(`/stronghold/rooms/${roomId}`, data),

  /** 删除房间 */
  deleteRoom: (roomId: string) => apiClient.delete<void>(`/stronghold/rooms/${roomId}`),

  // ═══ Agent 位置 ═══

  /** 移动 Agent 到指定房间 */
  moveAgent: (agentId: string, roomId: number) =>
    apiClient.post<AgentLocation>('/stronghold/locations/move', { agentId, roomId }),

  /** 获取 Agent 当前位置 */
  getAgentLocation: (agentId: string) =>
    apiClient.get<Room | null>(`/stronghold/locations/${agentId}`),

  // ═══ 群聊消息 ═══

  /** 获取房间消息历史 */
  getMessages: (roomId: string, limit = 50) =>
    apiClient.get<GroupMessage[]>(`/stronghold/rooms/${roomId}/messages?limit=${limit}`),

  /** 发送消息 */
  sendMessage: (roomId: string, content: string, senderId = 'user') =>
    apiClient.post<GroupMessage>(`/stronghold/rooms/${roomId}/messages`, {
      content,
      senderId,
    }),

  /** 获取房间成员 */
  getRoomMembers: (roomId: string) =>
    apiClient.get<RoomAgent[]>(`/stronghold/rooms/${roomId}/members`),

  /** 添加成员到房间 */
  addMember: (roomId: string, agentId: string, role?: string) =>
    apiClient.post<void>(`/stronghold/rooms/${roomId}/members`, { agentId, role }),

  // ═══ 管家 ═══

  /** 获取管家配置 */
  getButlerConfig: () => apiClient.get<ButlerConfig>('/stronghold/butler'),

  /** 切换管家启用状态 */
  toggleButler: (enabled: boolean) => apiClient.put<void>('/stronghold/butler/toggle', { enabled }),
}
