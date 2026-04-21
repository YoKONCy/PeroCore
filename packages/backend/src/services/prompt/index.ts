/**
 * Prompt 模块导出
 *
 * @module packages/backend/src/services/prompt
 */

export {
  MdpEngine,
  DEFAULT_POSITIONS,
  type MdPrompt,
  type PromptMeta,
  type PromptSlot,
  type PromptPreset,
  type RenderedMessage,
} from './mdpEngine'
export { PromptService, type PromptResult, type PromptMessagesResult } from './promptService'
