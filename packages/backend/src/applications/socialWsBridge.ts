/**
 * SocialWsBridge — 社交 WebSocket 适配器全局注册表
 *
 * 社交应用独立化后，WS 升级处理器（wsUpgrade.ts）无法通过 AppContext
 * 获取 NapcatAdapter。此模块提供全局注册机制：
 * - SocialAppRuntime 在 initialize 后调用 setSocialNapcatAdapter 注册适配器
 * - wsUpgrade.ts 通过 getSocialNapcatAdapter 获取适配器
 *
 * @module packages/backend/src/applications/socialWsBridge
 */

import type { NapcatAdapter } from '../../../apps/social/adapters/napcat'

/** 当前注册的 NapCat 适配器（由 SocialAppRuntime 注入） */
let _napcatAdapter: NapcatAdapter | null = null

/** 注册社交 NapCat 适配器（SocialAppRuntime 初始化后调用） */
export function setSocialNapcatAdapter(adapter: NapcatAdapter | null): void {
  _napcatAdapter = adapter
}

/** 获取当前注册的社交 NapCat 适配器 */
export function getSocialNapcatAdapter(): NapcatAdapter | null {
  return _napcatAdapter
}

/**
 * 创建 WsSender 包装器
 *
 * 将运行时特定的 WebSocket 实例包装为统一的 WsSender 接口。
 */
export function createWsSender(ws: {
  send: (data: string) => void
  close: () => void
}) {
  return {
    send: (data: string) => ws.send(data),
    close: () => ws.close(),
  }
}
