/**
 * Agent 应用层模块导出
 *
 * 统一导出应用层的所有类型、接口和实现。
 *
 * @module packages/backend/src/applications
 */

// 类型定义
export type {
  AgentAppManifest,
  AppToolDeclaration,
  AppPermission,
  AppContextRequirement,
  AppCheckpointSchema,
  AppCheckpointField,
  AppSessionPolicy,
  ResourceRef,
  MemoryResourceRef,
  MessageRangeResourceRef,
  WorkspaceResourceRef,
  PersonaResourceRef,
  TaskResourceRef,
  GrantPermission,
  Grant,
  AppInstallStatus,
  AppInstance,
  AppTaskContext,
  LaunchAppParams,
  AppCheckpoint,
  AppEvent,
} from './types'

// GrantRegistry
export { SqliteGrantRegistry, type GrantRegistry } from './grantRegistry'

// AppRuntime
export type {
  AppRuntimeContext,
  AppLogger,
  AgentAppRuntime,
  AppRuntimeFactory,
} from './appRuntime'

// AppManager
export { AppManagerImpl, type AppManager } from './appManager'
