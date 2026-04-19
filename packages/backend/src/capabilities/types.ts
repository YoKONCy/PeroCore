/**
 * Capability Gate 类型定义
 *
 * (Agent, Mode) → ResolvedCapability 的类型体系。
 * 见 16_CAPABILITY_GATE.md §2.4
 *
 * @module packages/backend/src/capabilities/types
 */

/** 单个模式的能力配置 (YAML 中的一个 mode 块) */
export interface ModeCapability {
  /** 该模式下可用的工具 ID 列表 */
  tools: string[]
  /** 该模式下可用的 Skill ID 列表 */
  skills: string[]
  /** 需要注入的 prompt 片段路径 */
  prompt_fragments: string[]
}

/** 单个 Agent 的完整能力配置 (capabilities.yaml) */
export interface AgentCapabilityConfig {
  /** Agent ID */
  agent: string
  /** 各模式的能力配置 */
  modes: Record<string, ModeCapability>
}

/** Skill 清单 (SKILL.md 的 frontmatter) */
export interface SkillManifest {
  /** Skill ID (目录名) */
  id: string
  /** Skill 名称 */
  name: string
  /** Skill 描述 (L1 菜单用) */
  description: string
  /** 依赖的工具 ID 列表 (load_skill 时临时解锁) */
  requiredTools: string[]
}

/** 解析后的完整能力上下文 (Gate 输出) */
export interface ResolvedCapability {
  /** Dispatcher 白名单 */
  allowedTools: Set<string>
  /** Skill 菜单清单 */
  enabledSkills: SkillManifest[]
  /** 需要渲染的 prompt 片段路径 */
  promptFragments: string[]
  /** 已过滤的工具描述文本 */
  toolsDescription: string
  /** Skill 菜单文本 (L1, ~50 tokens) */
  skillMenuText: string
}
