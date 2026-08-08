/**
 * Agent Manager — 多 Agent 配置管理
 *
 * 职责：
 * 1. 扫描 agents/ 目录加载 config.json + system_prompt.md
 * 2. 管理活跃 Agent 切换
 * 3. 提供 AgentProfile 数据给 PromptService / ToolPolicy
 *
 * 核心特性：
 * - 移除全局单例，通过 DI 注入
 * - 移除 DB 访问和 Gateway 广播 (拆到 Router 层)
 * - 支持内置 + 用户自定义双目录
 *
 * @module packages/backend/src/services/agent/agentManager
 */

import path from 'node:path'
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs'
import type { PathResolver } from '../../core/pathResolver'
import type { ConfigRepository } from '../../repositories/config.repo'
import type { PetStateService } from './petStateService'
import { createLogger } from '../../lib/logger'

const logger = createLogger('AgentManager')

/** 安全解析 JSON，失败时返回兜底值 */
function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** Agent 配置 (从 config.json 加载) */
export interface AgentProfile {
  id: string
  name: string
  description: string
  // AIOS: workPersona 已移除（work 模式废弃），Social 由子 Agent 处理
  /** 社交模式特征标签 */
  socialTraits: string[]
  /** 社交绑定 (QQ ID 等) */
  socialBinding: Record<string, unknown>
  /** 工具策略覆写 */
  toolPolicies: Record<string, unknown>
  /**
   * 各 channel 的人格补丁（第六阶段 #1）
   *
   * key 为 channel 名（desktop/companion/social/group），
   * value 为注入到 slots/600_channel_patch.md 槽位的补丁文本。
   * 空字符串表示无补丁（槽位会被 skipEmpty 过滤掉）。
   */
  channelPatches: Record<string, string>
  /** 头像文件路径 */
  avatarPath: string | null
  /** config.json 文件路径 */
  configPath: string
  /** system_prompt.md 文件路径 */
  promptPath: string
  /** 是否使用表情包 */
  useStickers: boolean
  /** 看板娘动态文案 (合并自 waifu_texts.json) */
  waifuTexts: Record<string, unknown> | null
}

// ─────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────

export class AgentManager {
  /** 所有已加载的 Agent */
  private agents = new Map<string, AgentProfile>()

  /**
   * 默认 Agent ID
   *
   * AIOS 架构下不再有"全局活跃 Agent"的概念，前端窗口级状态由 RuntimeStateService 管理。
   * 此字段仅作为"默认 Agent"用于无 Thread 上下场的场景（Scheduler/Cron/Startup），
   * 不再允许运行时切换（setActiveAgent 已移除）。
   */
  defaultAgentId = 'pero'

  /** 已启用的 Agent ID 集合 */
  enabledAgents = new Set<string>()

  /** 角色状态服务 (pet_states 表)，用于把 finish_task 写入的动态台词合并进看板娘台词 */
  private petStateService?: PetStateService

  constructor(
    private pathResolver: PathResolver,
    private configRepo?: ConfigRepository,
  ) {
    this.reloadAgents()
  }

  /** 注入 PetStateService (容器装配阶段调用) */
  setPetStateService(service: PetStateService): void {
    this.petStateService = service
  }

  /** 扫描并加载所有 Agent 配置 */
  reloadAgents(): void {
    this.agents.clear()

    // 1. 内置 Agent 目录 (@app/agents 或 mdp/agents)
    const builtinDir = this.pathResolver.resolve('@app/backend/src/services/mdp/agents')
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
    if (!this.agents.has(this.defaultAgentId) && this.agents.size > 0) {
      this.defaultAgentId = this.agents.keys().next().value!
    }

    logger.info(`已加载 ${this.agents.size} 个 Agent`)
  }

  /** 获取 Agent */
  getAgent(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId.toLowerCase())
  }

  /**
   * 获取默认 Agent
   *
   * 返回 defaultAgentId 对应的 AgentProfile，用于无 Thread 上下文的场景
   * （Scheduler/Cron/Startup）。前端窗口级 Agent 由 RuntimeStateService 管理。
   */
  getDefaultAgent(): AgentProfile | undefined {
    return this.agents.get(this.defaultAgentId)
  }

  /**
   * 获取 Agent 看板娘台词 (静态 + 动态合并)
   *
   * 数据来源:
   * 1. agent.json → waifu_texts (静态默认台词)
   * 2. ConfigRepository → waifu_dynamic_texts_{id} (LLM 动态更新覆盖)
   *
   * @returns 合并后的台词对象，agent 不存在时返回 null
   */
  async getWaifuTexts(agentId: string): Promise<Record<string, unknown> | null> {
    const agent = this.agents.get(agentId)
    if (!agent) return null

    // 1. 静态台词
    const staticTexts = (agent.waifuTexts ?? {}) as Record<string, unknown>

    // 2. 动态台词 (由 WaifuTextUpdater 维护周期写入)
    let dynamicTexts: Record<string, unknown> = {}
    if (this.configRepo) {
      try {
        const configVal = await this.configRepo.getJson<Record<string, unknown>>(
          `waifu_dynamic_texts_${agentId}`,
        )
        if (configVal && typeof configVal === 'object') {
          dynamicTexts = configVal
        }
      } catch {
        // 动态台词不存在时使用空对象
      }
    }

    // 3. 浅合并: 动态覆盖静态
    const merged: Record<string, unknown> = { ...staticTexts, ...dynamicTexts }

    // 4. pet_states 表合并 (finish_task 写入的动态台词，优先级最高)
    //    click → texts.click (按部位深合并)；idle → texts.idleMessages；back → texts.backMessages
    if (this.petStateService) {
      try {
        const petState = await this.petStateService.get(agentId)
        if (petState) {
          const petClick = safeJsonParse<Record<string, string[]>>(petState.clickMessagesJson, {})
          if (petClick && Object.keys(petClick).length > 0) {
            const baseClick = (merged.click as Record<string, unknown>) ?? {}
            merged.click = { ...baseClick, ...petClick }
          }

          const petIdle = safeJsonParse<string[]>(petState.idleMessagesJson, [])
          if (Array.isArray(petIdle) && petIdle.length > 0) {
            merged.idleMessages = petIdle
          }

          const petBack = safeJsonParse<string[]>(petState.backMessagesJson, [])
          if (Array.isArray(petBack) && petBack.length > 0) {
            merged.backMessages = petBack
          }
        }
      } catch (err) {
        logger.warn(`合并 pet_states 台词失败: ${err}`)
      }
    }

    return merged
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
    if (id === this.defaultAgentId) {
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
      isActive: p.id === this.defaultAgentId,
      isEnabled: this.enabledAgents.has(p.id),
    }))
  }

  /**
   *   <agentId>/
   *     agent.json       ← 基本配置
   *     personas/
   *       social.md       ← 社交人设骨架
   */
  createAgent(opts: { id: string; name: string; description?: string }): AgentProfile {
    const agentId = opts.id.toLowerCase()

    // 检查重复
    if (this.agents.has(agentId)) {
      throw new Error(`Agent "${agentId}" 已存在`)
    }

    // 创建目录
    const userAgentsDir = this.pathResolver.resolve('@data/agents')
    const agentDir = path.join(userAgentsDir, agentId)
    mkdirSync(agentDir, { recursive: true })

    // 写入 agent.json
    // AIOS: work 模式已废弃（由 subagent 应用处理），Social 由子 Agent 处理
    const config = {
      name: opts.name,
      description: opts.description ?? '',
      traits: {
        social: [],
      },
      social: {},
      tool_policies: {},
    }
    const configPath = path.join(agentDir, 'agent.json')
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    // AIOS: 不再写入 personas/social.md（人设统一由 system_prompt.md 管理）

    // AIOS(Phase4): 自动创建 Principal Workspace 目录骨架
    this.ensureWorkspaceDir(agentDir)

    // 加载到内存
    const profile = this.loadAgentConfig(agentId, agentDir, configPath)
    this.agents.set(agentId, profile)
    this.enabledAgents.add(agentId)

    logger.info(`创建自定义 Agent: ${opts.name} (${agentId})`)
    return profile
  }

  /**
   * 删除自定义 Agent (B6-3)
   *
   * 删除整个 Agent 目录并从内存中移除。
   * 禁止删除内置 Agent 或当前活跃 Agent。
   */
  deleteAgent(agentId: string): void {
    const id = agentId.toLowerCase()
    const profile = this.agents.get(id)
    if (!profile) {
      throw new Error(`Agent "${id}" 不存在`)
    }

    // 禁止删除当前活跃角色
    if (id === this.defaultAgentId) {
      throw new Error(`不能删除当前活跃的 Agent: ${id}`)
    }

    // 禁止删除内置 Agent (判断路径是否在 @data/ 下)
    const userAgentsDir = this.pathResolver.resolve('@data/agents')
    const isUserAgent = profile.configPath.startsWith(userAgentsDir)
    if (!isUserAgent) {
      throw new Error(`不能删除内置 Agent: ${id}`)
    }

    // 删除目录
    const agentDir = path.dirname(profile.configPath)
    rmSync(agentDir, { recursive: true, force: true })

    // 从内存移除
    this.agents.delete(id)
    this.enabledAgents.delete(id)

    logger.info(`已删除 Agent: ${id}`)
  }

  /** 判断 Agent 是否为用户自定义 (非内置) */
  isUserAgent(agentId: string): boolean {
    const profile = this.agents.get(agentId.toLowerCase())
    if (!profile) return false
    const userAgentsDir = this.pathResolver.resolve('@data/agents')
    return profile.configPath.startsWith(userAgentsDir)
  }

  // ─────────────────────────────────────────
  // 内部
  // ─────────────────────────────────────────

  /** 扫描目录下的 Agent 子目录 */
  private scanAgents(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const agentDir = path.join(dir, entry)
      if (!statSync(agentDir).isDirectory()) continue

      // 优先 agent.json (合并格式), 回退 config.json
      let configPath = path.join(agentDir, 'agent.json')
      if (!existsSync(configPath)) {
        configPath = path.join(agentDir, 'config.json')
      }
      if (!existsSync(configPath)) continue

      try {
        const profile = this.loadAgentConfig(entry.toLowerCase(), agentDir, configPath)
        this.agents.set(profile.id, profile)
        // AIOS(Phase4): 确保 workspace 目录存在（懒创建，首次扫描时）
        this.ensureWorkspaceDir(agentDir)
        logger.debug(`已加载 Agent: ${profile.name} (${profile.id})`)
      } catch (err) {
        logger.warn(`加载 Agent ${entry} 失败`, { error: err })
      }
    }
  }

  /**
   * 从 ConfigRepository (SQLite) 应用运行时社交覆盖值
   *
   * 只覆盖 social.enabled 和 social.qq_id —— 这两个是部署/用户特定的，
   * 不应硬编码在静态 agent.json 中。
   * use_stickers 等静态元数据仍从 agent.json 读取。
   */
  async applySocialOverrides(agentId: string): Promise<void> {
    if (!this.configRepo) return
    const profile = this.agents.get(agentId)
    if (!profile) return

    const enabledStr = await this.configRepo.get(`agent.${agentId}.social.enabled`)
    if (enabledStr !== undefined) {
      const enabled = enabledStr === 'true'
      profile.socialBinding = {
        ...profile.socialBinding,
        enabled,
      }
    }

    const qqId = await this.configRepo.get(`agent.${agentId}.social.qq_id`)
    if (qqId !== undefined) {
      profile.socialBinding = {
        ...profile.socialBinding,
        qq_id: qqId,
      }
    }
  }

  /**
   * 应用所有 Agent 的运行时覆盖值
   *
   * 应在服务启动后、首次使用前调用。
   */
  async applyAllOverrides(): Promise<void> {
    for (const agentId of this.agents.keys()) {
      await this.applySocialOverrides(agentId)
    }
  }

  /**
   * AIOS(Phase4): 确保 Principal Workspace 目录骨架存在
   *
   * 在 Agent 目录下创建 workspace/ 及其标准子目录：
   *   workspace/{inbox,notes,diary,drafts,plans,documents,attachments,exports,archive}
   *
   * 幂等：目录已存在时跳过。
   */
  private ensureWorkspaceDir(agentDir: string): void {
    const workspaceRoot = path.join(agentDir, 'workspace')
    if (!existsSync(workspaceRoot)) {
      mkdirSync(workspaceRoot, { recursive: true })
    }
    // 创建标准子目录骨架
    const subdirs = [
      'inbox',
      'notes',
      'diary',
      'drafts',
      'plans',
      'documents',
      'attachments',
      'exports',
      'archive',
    ]
    for (const subdir of subdirs) {
      const dirPath = path.join(workspaceRoot, subdir)
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true })
      }
    }
  }

  /** 加载单个 Agent 配置 */
  private loadAgentConfig(agentId: string, agentDir: string, configPath: string): AgentProfile {
    const raw = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw) as Record<string, unknown>

    // AIOS: workPersona/socialPersona 加载已移除（work 模式废弃，Social 由子 Agent 处理）

    // 特征
    const traits = (config.traits ?? {}) as Record<string, string[]>
    const socialTraits = traits.social ?? (config.social_traits as string[]) ?? []

    // 社交绑定
    const socialBinding = (config.social ?? {}) as Record<string, unknown>

    // 头像
    const avatarPath = this.findAvatar(agentDir)

    return {
      id: agentId,
      name: (config.name as string) ?? agentId,
      description: (config.description as string) ?? '',
      socialTraits,
      socialBinding,
      toolPolicies: (config.tool_policies ?? {}) as Record<string, unknown>,
      // 第六阶段 #1: 各 channel 的人格补丁（注入到 slots/600_channel_patch.md）
      channelPatches: (config.channel_patches ?? {}) as Record<string, string>,
      avatarPath,
      configPath,
      promptPath: path.join(agentDir, 'system_prompt.md'),
      useStickers: (socialBinding.use_stickers as boolean) ?? false,
      waifuTexts: config.waifu_texts as Record<string, unknown>,
    }
  }

  // AIOS: loadPersonaFile 已移除（workPersona/socialPersona 废弃，人设统一由 system_prompt.md 管理）

  /** 查找头像文件 */
  private findAvatar(agentDir: string): string | null {
    for (const name of ['avatar.png', 'avatar.jpg', 'avatar.webp', 'icon.png']) {
      const filePath = path.join(agentDir, name)
      if (existsSync(filePath)) return filePath
    }
    return null
  }

  /**
   * 获取 Agent 头像二进制数据 (供 Router 层使用)
   *
   * 返回 { buffer, mime } 或 null (无头像)。
   * 文件 I/O 封装在 Service 层，Router 不直接操作文件。
   */
  getAvatarData(agentId: string): { buffer: Buffer; mime: string } | null {
    const agent = this.agents.get(agentId.toLowerCase())
    if (!agent?.avatarPath || !existsSync(agent.avatarPath)) return null

    const ext = agent.avatarPath.split('.').pop()?.toLowerCase() ?? 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    }
    return {
      buffer: readFileSync(agent.avatarPath),
      mime: mimeMap[ext] ?? 'image/png',
    }
  }
}
