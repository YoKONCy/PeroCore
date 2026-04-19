/**
 * @perocore/shared 包入口
 *
 * 共享类型、常量和工具函数的统一导出。
 *
 * @module packages/shared/src
 */

// 类型导出 — API
export type { ApiResponse, PaginatedData, PaginationParams, SseEventType } from './types'
export type {
  SseDeltaEvent,
  SseToolCallEvent,
  SseToolResultEvent,
  SseStatusEvent,
  SseDoneEvent,
  SseErrorEvent,
  SseEvent,
} from './types'

// 类型导出 — 记忆
export type { MemoryType, MemorySource, Sentiment, MemoryDto, CreateMemoryDto } from './types'

// 类型导出 — Agent
export type {
  AgentRole,
  ModeCapability,
  SkillManifest,
  ResolvedCapability,
  AgentProfileDto,
  PetStateDto,
  UpdatePetStateDto,
} from './types'

// 类型导出 — 聊天
export type { ChatRole, ConversationLogDto, AnalysisStatus, AiModelConfigDto } from './types'

// 类型导出 — 扩展系统
export type {
  ExtensionType,
  ExtensionCategory,
  ExtensionPermission,
  ExtensionManifest,
  ToolDefinition,
  ToolParameterSchema,
  ToolContext,
  ToolResult,
  ToolExtension,
  HookEvent,
  HookContext,
  HookHandler,
  HookExtension,
  ServiceExtension,
  InboundMessage,
  InboundEvent,
  ExtensionInfo,
} from './types'

// 常量导出（值）
export {
  SUCCESS_CODES,
  CLIENT_ERROR_CODES,
  SERVER_ERROR_CODES,
  CODE_MESSAGES,
  CODE_TO_HTTP,
} from './constants'

// 常量导出（类型）
export type { ResponseCode } from './constants'
