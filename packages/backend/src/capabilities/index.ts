/**
 * Capability Gate 模块导出
 *
 * 能力门控、Skill加载与统一 Node Capability Transport。
 *
 * @module packages/backend/src/capabilities
 */
export { CapabilityGate } from './capabilityGate'
export { SkillLoader } from './skillLoader'
export { CapabilityBridge } from './capabilityBridge'
export type {
  AgentCapabilityConfig,
  ChannelCapability,
  ResolvedCapability,
  SkillManifest,
} from './types'
