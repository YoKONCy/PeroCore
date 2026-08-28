/**
 * Agent 系统类型定义
 *
 * @module packages/shared/src/types/agent.types
 */

/** Agent 角色 */
export type AgentRole = 'user' | 'assistant' | 'system'

/** 单个模式的能力配置 */
export interface ModeCapability {
  tools: string[]
  skills: string[]
  prompt_fragments: string[]
}

/** Skill 清单摘要 */
export interface SkillManifest {
  id: string
  name: string
  description: string
  requiredTools: string[]
}

/** 解析后的能力上下文 */
export interface ResolvedCapability {
  allowedTools: Set<string>
  enabledSkills: SkillManifest[]
  promptFragments: string[]
  toolsDescription: string
  skillMenuText: string
}

/** 允许其他 Agent 在据点等多人场景读取的稳定公开档案。 */
export interface AgentPublicProfile {
  gender?: string
  identity?: string
  appearance?: string
  personality?: string
}

/** Agent 配置数据传输对象 */
export interface AgentProfileDto {
  id: number
  role: AgentRole
  name: string
  avatar: string | null
  description: string | null
  systemPrompt: string | null
  voiceConfigId: number | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** 宠物状态数据传输对象 */
export interface PetStateDto {
  id: number
  agentId: string
  mood: string
  vibe: string
  mind: string
  updatedAt: string
}

/** 更新宠物状态请求 */
export interface UpdatePetStateDto {
  mood?: string
  vibe?: string
  mind?: string
}
