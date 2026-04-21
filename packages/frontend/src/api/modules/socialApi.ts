/**
 * Social API 模块 — 社交适配器
 *
 * 对接后端 /api/social/* 路由。
 * 通过 ApiClient 统一信封，禁止直接 fetch。
 *
 * @module packages/frontend/src/api/modules/socialApi
 */

import { apiClient } from '../client'

/** 适配器状态 */
export interface AdapterStatus {
  platform: string
  connected: boolean
  displayName?: string
  error?: string
}

/** 社交状态响应 */
export interface SocialStatusData {
  adapters: AdapterStatus[]
}

export const socialApi = {
  /** 获取所有适配器连接状态 */
  getStatus: () => apiClient.get<SocialStatusData>('/social/status'),

  /** 发送调试消息 */
  send: (content: string) => apiClient.post('/social/send', { content }),
}
