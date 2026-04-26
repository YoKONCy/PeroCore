/**
 * 社交模式 — 桶导出
 * @module packages/backend/src/services/social
 */

export { SocialBridge } from './socialBridge'
export type { SocialBridgeDeps } from './socialBridge'

export { SocialSessionManager } from './socialSessionManager'
export type {
  SocialSession,
  SessionState,
  FlushReason,
  FlushCallback,
  SessionManagerConfig,
} from './socialSessionManager'

export { SocialScheduler } from './socialScheduler'
export type { SocialSchedulerConfig, SocialSchedulerDeps } from './socialScheduler'

export { ImageCacheManager } from './imageCacheManager'
export type { ImageCacheConfig } from './imageCacheManager'

export { StickerService } from './stickerService'

export type {
  InboundMessage,
  OutboundMessage,
  Attachment,
  InboundEvent,
  AdapterStatus,
  SocialBinding,
} from './types'
