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

export type {
  InboundMessage,
  OutboundMessage,
  Attachment,
  InboundEvent,
  AdapterStatus,
  SocialBinding,
} from './types'
