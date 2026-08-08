/**
 * Prompt 模块导出
 *
 * AIOS: PromptService / PresetLoader 已废弃移除（死代码，零调用方）
 * 仅保留 MdpEngine（后台任务渲染 + ContextCompiler 未来接入点）
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
