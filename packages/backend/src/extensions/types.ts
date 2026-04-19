/**
 * 扩展系统 — 运行时类型
 *
 * 补充 @perocore/shared 中的接口定义，
 * 添加后端运行时专用的类型。
 *
 * @module packages/backend/src/extensions/types
 */

// 从 shared 层导出全部扩展类型
export type {
  ExtensionType,
  ExtensionCategory,
  ExtensionPermission,
  ExtensionManifest,
  ToolParameterSchema,
  ToolDefinition,
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
} from '@perocore/shared'

/** 扩展状态 */
export type ExtensionStatus = 'loaded' | 'error' | 'disabled' | 'starting' | 'stopped'

/** 已加载扩展的运行时记录 */
export interface LoadedExtension {
  /** 清单信息 */
  manifest: import('@perocore/shared').ExtensionManifest
  /** 加载路径 */
  dirPath: string
  /** 运行时状态 */
  status: ExtensionStatus
  /** 错误信息 (status = 'error' 时) */
  error?: string
  /** 加载时间 */
  loadedAt: string
}
