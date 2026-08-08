/**
 * Social API 模块 — 社交适配器
 *
 * 对接后端 /api/social/* 路由 + /api/configs/social 配置端点。
 * 通过 ApiClient 统一信封，禁止直接 fetch。
 *
 * @module packages/frontend/src/api/modules/socialApi
 */

import { apiClient } from '../client'
import { configApi } from './configApi'

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

/** 社交配置（存储在 configs 表的 'social' key，JSON 字符串） */
export interface SocialConfig {
  /** 主人的 QQ 号（用于权限识别 + prompt 注入） */
  ownerQq?: string
  /** QQ Bot 账号 → Agent 映射 */
  bindings?: Array<{
    adapter: string
    accountId: string
    agentId: string
  }>
}

export const socialApi = {
  /** 获取所有适配器连接状态 */
  getStatus: () => apiClient.get<SocialStatusData>('/social/status'),

  /** 发送调试消息 */
  send: (content: string) => apiClient.post('/social/send', { content }),

  /**
   * 读取社交配置
   *
   * 从 /api/configs/social 获取并解析 JSON。
   * 未配置时返回空对象。
   */
  async getConfig(): Promise<SocialConfig> {
    const res = await configApi.get<{ key: string; value: string | null }>('social')
    const raw = res.data?.value
    if (!raw) return {}
    try {
      return JSON.parse(raw) as SocialConfig
    } catch {
      return {}
    }
  },

  /**
   * 保存社交配置（整体覆盖）
   *
   * 将 SocialConfig 序列化为 JSON 字符串写入 /api/configs/social。
   * 注意：后端 configRepo.set 只支持 string，所以这里手动 JSON.stringify。
   */
  async saveConfig(config: SocialConfig): Promise<void> {
    await configApi.set('social', JSON.stringify(config))
  },
}

