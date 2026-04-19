/**
 * 扩展系统导出
 *
 * @module packages/backend/src/extensions
 */

export { ExtensionManager, type ExtensionManagerConfig } from './extensionManager'
export { ExtensionLoader, type LoadResult } from './extensionLoader'
export { HookRegistry } from './hookRegistry'
export { ServiceRunner, type ServiceStatus } from './serviceRunner'
export type { ServiceTransport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from './transports/transport'
export { StdioTransport } from './transports/stdioTransport'
export type {
  ExtensionType,
  ExtensionManifest,
  ToolExtension,
  ToolDefinition,
  ToolContext,
  ToolResult,
  HookExtension,
  HookEvent,
  HookHandler,
  HookContext,
  ServiceExtension,
  ExtensionInfo,
  LoadedExtension,
  ExtensionStatus,
} from './types'
