/**
 * Capability Gate — 能力门控 (D51)
 *
 * 单一权威来源：(Agent, Mode) → ResolvedCapability
 *
 * 取代 v1 散布在 3 处的 if-else 工具过滤：
 * - PromptService._enrich_variables() 400+ 行
 * - NITDispatcher.dispatch() 白名单
 * - NITDispatcher._execute_plugin() 轻量模式检查
 *
 * 见 16_CAPABILITY_GATE.md §2
 *
 * @module packages/backend/src/capabilities/capabilityGate
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentCapabilityConfig, ResolvedCapability, SkillManifest } from './types'
import type { SkillLoader } from './skillLoader'
import type { ToolRegistry } from '../services/agent/toolRegistry'
import { createLogger } from '../lib/logger'

const logger = createLogger('CapabilityGate')

/** 空能力 (所有字段为空) */
const EMPTY_CAPABILITY: ResolvedCapability = {
  allowedTools: new Set(),
  enabledSkills: [],
  promptFragments: [],
  toolsDescription: '',
  skillMenuText: '',
}

export class CapabilityGate {
  /** Agent 能力配置 (agentId → config) */
  private configs = new Map<string, AgentCapabilityConfig>()

  /** 会话级临时解锁工具 (sessionId → Set<toolName>) */
  private sessionOverrides = new Map<string, Set<string>>()

  constructor(
    private agentsDirs: string[],
    private skillLoader: SkillLoader,
    private toolRegistry: ToolRegistry,
  ) {
    this.reloadAll()
  }

  /** 扫描所有 Agent 目录的 capabilities.yaml */
  reloadAll(): void {
    this.configs.clear()

    for (const dir of this.agentsDirs) {
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir)) {
        const capPath = path.join(dir, entry, 'capabilities.yaml')
        if (!existsSync(capPath)) continue

        try {
          const config = this.parseCapabilityYaml(entry, capPath)
          this.configs.set(config.agent, config)
          logger.debug(`能力配置已加载: ${config.agent}`)
        } catch (err) {
          logger.warn(`解析 ${entry}/capabilities.yaml 失败: ${err}`)
        }
      }
    }

    logger.info(`已加载 ${this.configs.size} 个 Agent 能力配置`)
  }

  /**
   * 核心方法：解析 (agent, mode) → 完整能力上下文
   *
   * 这是整个 CapabilityGate 的唯一入口点。
   * PromptService 和 ToolExecutor 都通过此方法获取能力。
   */
  resolve(agentId: string, mode: string, sessionId?: string): ResolvedCapability {
    const config = this.configs.get(agentId)
    // 回退: 指定模式 → desktop → 空
    const modeConfig = config?.modes[mode] ?? config?.modes['desktop'] ?? null

    if (!modeConfig) {
      logger.debug(`Agent ${agentId} 无模式 ${mode} 配置，返回空能力`)
      return { ...EMPTY_CAPABILITY, allowedTools: new Set() }
    }

    // 1. 工具白名单 (基础 + 会话临时解锁)
    const allowedTools = new Set(modeConfig.tools)

    // 合并 Skill 临时解锁的工具
    if (sessionId) {
      const overrides = this.sessionOverrides.get(sessionId)
      if (overrides) {
        for (const tool of overrides) {
          allowedTools.add(tool)
        }
      }
    }

    // 2. Skill 清单 (只加载 manifest，不加载完整内容)
    const enabledSkills: SkillManifest[] = []
    for (const skillId of modeConfig.skills) {
      const manifest = this.skillLoader.getManifest(skillId)
      if (manifest) {
        enabledSkills.push(manifest)
      }
    }

    // 3. 工具描述文本 (仅白名单内的工具)
    const toolsDescription = this.buildToolsDescription(allowedTools)

    // 4. Skill 菜单文本 (L1, ~50 tokens)
    const skillMenuText =
      enabledSkills.length > 0
        ? '你拥有以下技能，在需要时可以使用：\n' +
          enabledSkills.map((s) => `- ${s.name}: ${s.description}`).join('\n') +
          '\n如需使用，请先调用 load_skill 加载详情。'
        : ''

    return {
      allowedTools,
      enabledSkills,
      promptFragments: modeConfig.prompt_fragments,
      toolsDescription,
      skillMenuText,
    }
  }

  /**
   * 运行时单点校验
   *
   * ToolExecutor 在执行工具前调用此方法检查权限。
   */
  isToolAllowed(agentId: string, mode: string, toolName: string, sessionId?: string): boolean {
    // finish_task 和 load_skill 永远允许
    if (toolName === 'finish_task' || toolName === 'load_skill') {
      return true
    }

    const resolved = this.resolve(agentId, mode, sessionId)
    return resolved.allowedTools.has(toolName)
  }

  /**
   * Skill 临时解锁工具 (load_skill 时调用)
   *
   * 将 Skill 的 requiredTools 加入会话白名单。
   * 会话结束后通过 clearSession 回收。
   */
  unlockSkillTools(sessionId: string, skillId: string): void {
    const manifest = this.skillLoader.getManifest(skillId)
    if (!manifest?.requiredTools.length) return

    let overrides = this.sessionOverrides.get(sessionId)
    if (!overrides) {
      overrides = new Set()
      this.sessionOverrides.set(sessionId, overrides)
    }

    for (const tool of manifest.requiredTools) {
      overrides.add(tool)
    }

    logger.info(
      `Skill ${skillId} 临时解锁工具: [${manifest.requiredTools.join(', ')}] (session=${sessionId})`,
    )
  }

  /** 清除会话临时权限 */
  clearSession(sessionId: string): void {
    this.sessionOverrides.delete(sessionId)
  }

  /** 获取 Agent 是否有能力配置 */
  hasConfig(agentId: string): boolean {
    return this.configs.has(agentId)
  }

  /** 获取 Agent 的所有模式及其工具列表 (B6-3, 供 API 查询) */
  getAgentModes(agentId: string): Record<string, { tools: string[]; skills: string[] }> {
    const config = this.configs.get(agentId)
    if (!config) return {}
    const result: Record<string, { tools: string[]; skills: string[] }> = {}
    for (const [mode, modeConfig] of Object.entries(config.modes)) {
      result[mode] = {
        tools: modeConfig.tools,
        skills: modeConfig.skills,
      }
    }
    return result
  }

  /** 获取 Agent 在所有模式中可用的 Skill 列表 (B6-3) */
  getAgentSkills(agentId: string): Array<{ id: string; name: string; description: string }> {
    const config = this.configs.get(agentId)
    if (!config) return []
    const skillIds = new Set<string>()
    for (const modeConfig of Object.values(config.modes)) {
      for (const skillId of modeConfig.skills) {
        skillIds.add(skillId)
      }
    }
    return [...skillIds].map((id) => {
      const manifest = this.skillLoader.getManifest(id)
      return {
        id,
        name: manifest?.name ?? id,
        description: manifest?.description ?? '',
      }
    })
  }

  // ── 内部 ──

  /** 构建工具描述文本 (只包含白名单内 + 已注册的工具) */
  private buildToolsDescription(allowedTools: Set<string>): string {
    const allDefs = this.toolRegistry.getDefinitions()
    const filtered = allDefs.filter((d) => allowedTools.has(d.name))

    if (filtered.length === 0) return ''

    return filtered.map((d) => `- ${d.name}: ${d.description}`).join('\n')
  }

  /** 解析 capabilities.yaml (极简 YAML 解析) */
  private parseCapabilityYaml(agentId: string, filePath: string): AgentCapabilityConfig {
    const raw = readFileSync(filePath, 'utf-8')
    const config: AgentCapabilityConfig = {
      agent: agentId,
      modes: {},
    }

    let currentMode = ''
    let currentField = ''
    let currentList: string[] = []

    for (const line of raw.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed || trimmed.startsWith('#')) continue

      // 顶级字段: agent: xxx
      if (trimmed.startsWith('agent:')) {
        config.agent = trimmed.slice(6).trim()
        continue
      }

      // modes: 块开始
      if (trimmed === 'modes:') continue

      // 模式名: 2空格缩进
      const modeMatch = trimmed.match(/^ {2}(\w+):$/)
      if (modeMatch?.[1]) {
        // 保存上一个字段
        this.flushField(config, currentMode, currentField, currentList)
        currentMode = modeMatch[1]
        currentField = ''
        currentList = []
        config.modes[currentMode] = { tools: [], skills: [], prompt_fragments: [] }
        continue
      }

      // 字段名: 4空格缩进
      const fieldMatch = trimmed.match(/^ {4}(\w+):(.*)$/)
      if (fieldMatch?.[1] && currentMode) {
        // 保存上一个字段
        this.flushField(config, currentMode, currentField, currentList)
        currentField = fieldMatch[1]
        currentList = []

        // 检查内联值 (如 skills: [])
        const inlineValue = (fieldMatch[2] ?? '').trim()
        if (inlineValue === '[]') {
          currentField = ''
          currentList = []
        }
        continue
      }

      // 列表项: 6空格缩进 + "- "
      const itemMatch = trimmed.match(/^ {6}- (.+)$/)
      if (itemMatch?.[1] && currentField) {
        currentList.push(itemMatch[1].trim())
      }
    }

    // 保存尾部字段
    this.flushField(config, currentMode, currentField, currentList)

    return config
  }

  /** 将收集的列表写入配置 */
  private flushField(
    config: AgentCapabilityConfig,
    mode: string,
    field: string,
    list: string[],
  ): void {
    if (!mode || !field || list.length === 0) return

    const modeConfig = config.modes[mode]
    if (!modeConfig) return

    switch (field) {
      case 'tools':
        modeConfig.tools = [...list]
        break
      case 'skills':
        modeConfig.skills = [...list]
        break
      case 'prompt_fragments':
        modeConfig.prompt_fragments = [...list]
        break
    }
  }
}
