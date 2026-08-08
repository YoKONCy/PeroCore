/**
 * Capability Gate 模块导出
 *
 * 能力门控 + Skill 加载 + 节点能力注册（第七阶段）
 *
 * @module packages/backend/src/capabilities
 */
export { CapabilityGate } from './capabilityGate'
export { SkillLoader } from './skillLoader'
export { CapabilityRegistry } from './capabilityRegistry'
export { CapabilityBridge } from './capabilityBridge'
export type { ToolCallResult } from './capabilityBridge'
export type {
  NodeCapabilityRegistration,
  NodeType,
  NodeStatus,
} from '../repositories/nodeCapability.repo'
export type {
  AgentCapabilityConfig,
  ChannelCapability,
  ResolvedCapability,
  SkillManifest,
} from './types'
