/**
 * SocialWsBridge — 社交 WebSocket 适配器全局注册表
 *
 * 注册表由 Daemon 持有，Social runtime 通过 AppRuntimeContext 注入的函数注册。
 * 禁止 Social runtime 直接导入注册函数：独立打包会复制模块状态。
 * - SocialAppRuntime 在 initialize 后调用 registerSocialTransport 注册适配器
 * - wsUpgrade.ts 通过 getSocialNapcatAdapter 获取适配器
 *
 * @module packages/backend/src/applications/socialWsBridge
 */

/** WebSocket 宿主只依赖传输接口，不能依赖另一个 bundle 内的运行时单例。 */
export interface SocialWsSender {
  send(data: string): void | Promise<void>
  close(): void
}

export interface SocialWebSocketAdapterPort {
  registerConnection(selfId: string | undefined, sender: SocialWsSender): void
  unregisterConnection(selfId: string | undefined, sender?: SocialWsSender): void
  handleRawEvent(data: string): Promise<void>
}

/** 当前注册的 NapCat 适配器（由 SocialAppRuntime 注入） */
let _napcatAdapter: SocialWebSocketAdapterPort | null = null

/** 创建一次由宿主持有的适配器注册，返回只释放本次注册的函数。 */
export function registerSocialNapcatAdapter(adapter: SocialWebSocketAdapterPort): () => void {
  _napcatAdapter = adapter
  // 旧实例延迟结束时不得注销已经接管的新实例。
  return () => {
    if (_napcatAdapter === adapter) _napcatAdapter = null
  }
}

/** 获取当前注册的社交 NapCat 适配器 */
export function getSocialNapcatAdapter(): SocialWebSocketAdapterPort | null {
  return _napcatAdapter
}

/**
 * 创建 WsSender 包装器
 *
 * 将运行时特定的 WebSocket 实例包装为统一的 WsSender 接口。
 */
export function createWsSender(ws: { send: (data: string) => void; close: () => void }) {
  return {
    send: (data: string) => ws.send(data),
    close: () => ws.close(),
  }
}
