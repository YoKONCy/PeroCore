/**
 * Agent Manager — 多 Agent 配置管理
 *
 * 职责：
 * 1. 扫描 agents/ 目录加载 config.json + system_prompt.md
 * 2. 管理活跃 Agent 切换
 * 3. 提供 AgentProfile 数据给 PromptService / ToolPolicy
 *
 * v2 变化 (对比 v1 agent_manager.py 385行)：
 * - 移除全局单例，通过 DI 注入
 * - 移除 DB 访问和 Gateway 广播 (拆到 Router 层)
 * - 支持内置 + 用户自定义双目录
 *
 * @module packages/backend/src/services/agent/agentManager
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { PathResolver } from '../../core/pathResolver'
import { createLogger } from '../../lib/logger'

const logger = createLogger('AgentManager')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** Agent 配置 (从 config.json 加载) */
export interface AgentProfile {
  id: string
  name: string
  description: string
  /** 工作模式人设 (从文件加载) */
  workPersona: string
  /** 社交模式人设 (从文件加载) */
  socialPersona: string
  /** 工作模式特征标签 */
  workTraits: string[]
  /** 社交模式特征标签 */
  socialTraits: string[]
  /** 社交绑定 (QQ ID 等) */
  socialBinding: Record<string, unknown>
  /** 工具策略覆写 */
  toolPolicies: Record<string, unknown>
  /** 头像文件路径 */
  avatarPath: string | null
  /** config.json 文件路径 */
  configPath: string
  /** system_prompt.md 文件路径 */
  promptPath: string
  /** 是否使用表情包 */
  useStickers: boolean
}

// ─────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────

export class AgentManager {
  /** 所有已加载的 Agent */
  private agents = new Map<string, AgentProfile>()

  /** 当前活跃 Agent ID */
  activeAgentId = 'pero'

  /** 已启用的 Agent ID 集合 */
  enabledAgents = new Set<string>()

  constructor(private pathResolver: PathResolver) {
    this.reloadAgents()
  }

  /** 扫描并加载所有 Agent 配置 */
  reloadAgents(): void {
    this.agents.clear()

    // 1. 内置 Agent 目录 (@app/agents 或 mdp/agents)
    const builtinDir = this.pathResolver.resolve('@app/packages/backend/src/services/mdp/agents')
    if (existsSync(builtinDir)) {
      this.scanAgents(builtinDir)
    }

    // 2. 用户自定义 Agent 目录 (@data/agents)
    const userDir = this.pathResolver.resolve('@data/agents')
    if (existsSync(userDir)) {
      this.scanAgents(userDir)
    }

    // 默认启用所有
    if (this.enabledAgents.size === 0 && this.agents.size > 0) {
      this.enabledAgents = new Set(this.agents.keys())
    }

    // 确保活跃 Agent 有效
    if (!this.agents.has(this.activeAgentId) && this.agents.size > 0) {
      this.activeAgentId = this.agents.keys().next().value!
    }

    logger.info(`已加载 ${this.agents.size} 个 Agent`)
  }

  /** 获取 Agent */
  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId.toLowerCase())
  }

  /** 获取活跃 Agent */
  getActiveAgent(): AgentProfile | undefined {
    return this.agents.get(this.activeAgentId)
  }

  /** 切换活跃 Agent */
  setActiveAgent(agentId: string): boolean {
    const id = agentId.toLowerCase()
    if (!this.agents.has(id)) {
      logger.warn(`无法切换到未知 Agent: ${agentId}`)
      return false
    }
    if (!this.enabledAgents.has(id)) {
      logger.warn(`Agent ${id} 未启用，请先调用 enableAgent()`)
      return false
    }
    this.activeAgentId = id
    logger.info(`已切换活跃 Agent: ${id}`)
    return true
  }

  /** 运行时热启用 Agent (D54) */
  enableAgent(agentId: string): boolean {
    const id = agentId.toLowerCase()
    if (!this.agents.has(id)) {
      logger.warn(`无法启用未知 Agent: ${agentId}`)
      return false
    }
    this.enabledAgents.add(id)
    logger.info(`Agent 已启用: ${id}`)
    return true
  }

  /** 运行时热禁用 Agent (D54) */
  disableAgent(agentId: string): boolean {
    const id = agentId.toLowerCase()
    if (id === this.activeAgentId) {
      logger.warn(`不能禁用主角色: ${id}`)
      return false
    }
    this.enabledAgents.delete(id)
    logger.info(`Agent 已禁用: ${id}`)
    return true
  }

  /** 列出所有 Agent (给 API 用) */
  listAgents(): Array<{
    id: string
    name: string
    description: string
    isActive: boolean
    isEnabled: boolean
  }> {
    return [...this.agents.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isActive: p.id === this.activeAgentId,
      isEnabled: this.enabledAgents.has(p.id),
    }))
  }

  // ─────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────

  /** 扫描目录下的 Agent 子目录 */
  private scanAgents(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const agentDir = path.join(dir, entry)
      if (!statSync(agentDir).isDirectory()) continue

      const configPath = path.join(agentDir, 'config.json')
      if (!existsSync(configPath)) continue

      try {
        const profile = this.loadAgentConfig(entry.toLowerCase(), agentDir, configPath)
        this.agents.set(profile.id, profile)
        logger.debug(`已加载 Agent: ${profile.name} (${profile.id})`)
      } catch (err) {
        logger.warn(`加载 Agent ${entry} 失败`, { error: err })
      }
    }
  }

  /** 加载单个 Agent 配置 */
  private loadAgentConfig(agentId: string, agentDir: string, configPath: string): AgentProfile {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as Record<string, unknown>

    // 加载人设文件
    const personas = (config.personas ?? {}) as Record<string, string>
    const workPersona =
      this.loadPersonaFile(agentDir, personas.work) ?? (config.work_custom_persona as string) ?? ''
    const socialPersona =
      this.loadPersonaFile(agentDir, personas.social) ??
      (config.social_custom_persona as string) ??
      ''

    // 特征
    const traits = (config.traits ?? {}) as Record<string, string[]>
    const workTraits = traits.work ?? (config.work_traits as string[]) ?? []
    const socialTraits = traits.social ?? (config.social_traits as string[]) ?? []

    // 社交绑定
    const socialBinding = (config.social ?? {}) as Record<string, unknown>

    // 头像
    const avatarPath = this.findAvatar(agentDir)

    return {
      id: agentId,
      name: (config.name as string) ?? agentId,
      description: (config.description as string) ?? '',
      workPersona,
      socialPersona,
      workTraits,
      socialTraits,
      socialBinding,
      toolPolicies: (config.tool_policies ?? {}) as Record<string, unknown>,
      avatarPath,
      configPath,
      promptPath: path.join(agentDir, 'system_prompt.md'),
      useStickers: (socialBinding.use_stickers as boolean) ?? false,
    }
  }

  /** 从文件加载人设内容 */
  private loadPersonaFile(agentDir: string, relPath?: string): string | null {
    if (!relPath) return null
    const absPath = path.join(agentDir, relPath)
    if (!existsSync(absPath)) return null
    try {
      return readFileSync(absPath, 'utf-8')
    } catch {
      return null
    }
  }

  /** 查找头像文件 */
  private findAvatar(agentDir: string): string | null {
    for (const name of ['avatar.png', 'avatar.jpg', 'avatar.webp', 'icon.png']) {
      const filePath = path.join(agentDir, name)
      if (existsSync(filePath)) return filePath
    }
    return null
  }
}
