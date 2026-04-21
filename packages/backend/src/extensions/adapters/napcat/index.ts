/**
 * NapCat 适配器 — 桶导出
 * @module packages/backend/src/extensions/adapters/napcat
 */

export { NapcatAdapter, type NapcatConfig, type WsSender } from './napcatAdapter'
export {
  cleanCQCodes,
  extractAttachments,
  checkIsMentioned,
  toOneBotSegments,
  buildSendParams,
  type OneBotSegment,
  type OneBotMessageEvent,
} from './napcatParser'
