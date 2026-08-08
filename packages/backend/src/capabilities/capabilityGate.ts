/**
 * Capability Gate — 能力门控 (AIOS)
 *
 * 单一权威来源：(Agent, Channel) → ResolvedCapability
 *
 * AIOS 改造说明：
 * - Mode 概念已废弃，改为 Channel（Thread 持久属性）
 * - resolve(agentId, mode) → resolve(agentId, channel)
 * - 配置文件 modes: → channels:
 *
 * 统一工具过滤逻辑：
 * - ContextCompiler 通过此获取工具白名单/skills/prompt_fragments
 * - ToolExecutor 通过此进行运行时权限校验
 *
 * @module packages/backend/src/capabilities/capabilityGate
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type {
  AgentCapabilityConfig,
  ResolvedCapability,
  SkillManifest,
  ToolPermission,
} from './types'
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
  toolPermissions: new Map(),
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

    // 第七阶段修复（E1）：启动时校验 channel 配置覆盖情况
    // 缺失 channel 会导致 fail-closed（该通道下 Agent 无任何工具可用），
    // 提前 warn 提醒开发者补齐配置，避免运行时才发现。
    this.validateChannelConfig()
  }

  /**
   * 校验所有 Agent 的 channel 配置覆盖情况（第七阶段修复 E1）
   *
   * 检查每个已加载的 Agent 是否在 capabilities.yaml 中显式配置了
   * 所有期望的 channel。缺失的 channel 会在运行时 fail-closed
   * （返回空能力集），导致该通道下 Agent 无法使用任何工具。
   *
   * 此方法仅打印 warn 提示，不阻断启动。
   */
  validateChannelConfig(): void {
    /** 期望所有 Agent 都配置的 channel 列表（见 00-overview.md §4） */
    const EXPECTED_CHANNELS = ['desktop', 'companion', 'social', 'group'] as const

    for (const [agentId, config] of this.configs) {
      const missing: string[] = []
      for (const expected of EXPECTED_CHANNELS) {
        if (!config.channels[expected]) {
          missing.push(expected)
        }
      }
      if (missing.length > 0) {
        logger.warn(
          `Agent "${agentId}" 缺少 channel 配置: [${missing.join(', ')}]。` +
            `未配置的 channel 将 fail-closed（无工具可用），请在 capabilities.yaml 中补齐。`,
        )
      }
    }
  }

  /**
   * 核心方法：解析 (agent, channel) → 完整能力上下文
   *
   * 这是整个 CapabilityGate 的唯一入口点。
   * ContextCompiler 和 ToolExecutor 都通过此方法获取能力。
   *
   * @param agentId    Agent ID
   * @param channel    Thread channel（desktop/companion 等）
   * @param sessionId  可选，会话级临时解锁工具（如 load_skill 解锁）
   */
  resolve(agentId: string, channel: string, sessionId?: string): ResolvedCapability {
    const config = this.configs.get(agentId)
    // 第七阶段修复（批次 B3）：fail-closed
    // 原实现 `config?.channels[channel] ?? config?.channels['desktop']` 会回退到 desktop，
    // 导致未配置的 channel（如 social/group）意外继承 desktop 的完整工具集（含 terminal_execute 等危险工具）。
    // 现在未显式配置的 channel 一律返回空能力集 —— 忘记配置 = 最小权限，而非最大权限。
    // 这要求每个新增 channel 必须在 capabilities.yaml 中显式声明可用工具。
    const channelConfig = config?.channels[channel] ?? null

    if (!channelConfig) {
      logger.warn(
        `Agent ${agentId} 未配置 channel "${channel}" 的能力，fail-closed 返回空集。` +
          `请在 capabilities.yaml 中显式声明该 channel 的工具白名单。`,
      )
      return { ...EMPTY_CAPABILITY, allowedTools: new Set() }
    }

    // 1. 工具白名单 (基础 + 会话临时解锁)
    const allowedTools = new Set(channelConfig.tools)

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
    for (const skillId of channelConfig.skills) {
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
      promptFragments: channelConfig.prompt_fragments,
      toolsDescription,
      skillMenuText,
      // 第六阶段 #6: 透传 tool_permissions 配置（Resource Scope）
      toolPermissions: new Map(Object.entries(channelConfig.tool_permissions ?? {})),
    }
  }

  /**
   * 运行时单点校验
   *
   * ToolExecutor 在执行工具前调用此方法检查权限。
   *
   * @param agentId    Agent ID
   * @param channel    Thread channel
   * @param toolName   待校验的工具名
   * @param sessionId  可选，会话级临时解锁
   */
  isToolAllowed(agentId: string, channel: string, toolName: string, sessionId?: string): boolean {
    // finish_task 和 load_skill 永远允许
    if (toolName === 'finish_task' || toolName === 'load_skill') {
      return true
    }

    const resolved = this.resolve(agentId, channel, sessionId)
    return resolved.allowedTools.has(toolName)
  }

  // ── Resource Scope（第六阶段 #6）──

  /**
   * 获取指定工具在 (Agent, Channel) 下的权限配置
   *
   * @returns ToolPermission 或 undefined（无配置表示无资源范围限制）
   */
  getToolPermission(
    agentId: string,
    channel: string,
    toolName: string,
  ): ToolPermission | undefined {
    const resolved = this.resolve(agentId, channel)
    return resolved.toolPermissions.get(toolName)
  }

  /**
   * 校验路径是否在工具的 ResourceScope 允许范围内
   *
   * 校验规则（按优先级）：
   * 1. 工具未配置 ToolPermission → 允许（无资源范围限制）
   * 2. ResourceScope.scope === 'system' → 允许（系统级，不限制路径）
   * 3. 路径命中 deniedPaths → 拒绝
   * 4. allowedRoots 为空数组 → 允许（未配置白名单，仅靠 deniedPaths 黑名单）
   * 5. 路径落在 allowedRoots 任一根目录下 → 允许；否则拒绝
   *
   * 路径规范化：解析为绝对路径后再做前缀匹配，避免 ../ 等逃逸。
   *
   * @param agentId   Agent ID
   * @param channel   Thread channel
   * @param toolName  工具名
   * @param inputPath 待校验的路径参数（可能是相对路径或绝对路径）
   */
  isPathAllowed(
    agentId: string,
    channel: string,
    toolName: string,
    inputPath: string,
  ): boolean {
    const perm = this.getToolPermission(agentId, channel, toolName)
    // 未配置权限 → 默认允许（仍受 CapabilityGate 白名单约束）
    if (!perm) return true

    const scope = perm.resourceScope
    // system 级别不限制路径
    if (scope.scope === 'system') return true

    // 路径规范化为绝对路径（小写化用于 Windows 大小写不敏感比较）
    const normalized = path.resolve(inputPath).toLowerCase()

    // 黑名单：命中即拒绝
    for (const denied of scope.deniedPaths) {
      const deniedNorm = path.resolve(denied).toLowerCase()
      if (normalized === deniedNorm || normalized.startsWith(deniedNorm + path.sep)) {
        return false
      }
    }

    // 白名单为空 → 仅靠黑名单约束，未命中黑名单即允许
    if (scope.allowedRoots.length === 0) return true

    // 白名单：路径必须落在任一 allowedRoot 下
    for (const root of scope.allowedRoots) {
      const rootNorm = path.resolve(root).toLowerCase()
      if (normalized === rootNorm || normalized.startsWith(rootNorm + path.sep)) {
        return true
      }
    }
    return false
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

  /**
   * 获取 Agent 的所有 channel 及其工具列表 (供 API 查询)
   *
   * AIOS: 方法名保留 getAgentModes 以保持 API 兼容，但语义已改为 channel
   */
  getAgentModes(agentId: string): Record<string, { tools: string[]; skills: string[] }> {
    const config = this.configs.get(agentId)
    if (!config) return {}
    const result: Record<string, { tools: string[]; skills: string[] }> = {}
    for (const [channel, channelConfig] of Object.entries(config.channels)) {
      result[channel] = {
        tools: channelConfig.tools,
        skills: channelConfig.skills,
      }
    }
    return result
  }

  /** 获取 Agent 在所有 channel 中可用的 Skill 列表 */
  getAgentSkills(agentId: string): Array<{ id: string; name: string; description: string }> {
    const config = this.configs.get(agentId)
    if (!config) return []
    const skillIds = new Set<string>()
    for (const channelConfig of Object.values(config.channels)) {
      for (const skillId of channelConfig.skills) {
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
      channels: {},
    }

    let currentChannel = ''
    let currentField = ''
    let currentList: string[] = []
    // tool_permissions 块的累积行（6+ 空格缩进），交给独立解析器处理
    let inToolPermissions = false
    let toolPermLines: string[] = []

    const flushToolPermissions = () => {
      if (!currentChannel || toolPermLines.length === 0) {
        inToolPermissions = false
        toolPermLines = []
        return
      }
      const channelConfig = config.channels[currentChannel]
      if (channelConfig) {
        const parsed = this.parseToolPermissionsBlock(toolPermLines)
        if (Object.keys(parsed).length > 0) {
          channelConfig.tool_permissions = {
            ...(channelConfig.tool_permissions ?? {}),
            ...parsed,
          }
        }
      }
      inToolPermissions = false
      toolPermLines = []
    }

    for (const line of raw.split('\n')) {
      const trimmed = line.trimEnd()
      if (!trimmed || trimmed.startsWith('#')) continue

      // 顶级字段: agent: xxx
      if (trimmed.startsWith('agent:')) {
        config.agent = trimmed.slice(6).trim()
        continue
      }

      // channels: 块开始
      if (trimmed === 'channels:') continue

      // channel 名: 2空格缩进
      const channelMatch = trimmed.match(/^ {2}(\w+):$/)
      if (channelMatch?.[1]) {
        // 退出 tool_permissions 块（如有）
        if (inToolPermissions) flushToolPermissions()
        // 保存上一个字段
        this.flushField(config, currentChannel, currentField, currentList)
        currentChannel = channelMatch[1]
        currentField = ''
        currentList = []
        config.channels[currentChannel] = {
          tools: [],
          skills: [],
          prompt_fragments: [],
        }
        continue
      }

      // 字段名: 4空格缩进
      const fieldMatch = trimmed.match(/^ {4}(\w+):(.*)$/)
      if (fieldMatch?.[1] && currentChannel) {
        // 退出上一个 tool_permissions 块（如有），开始新字段
        if (inToolPermissions) flushToolPermissions()
        // 保存上一个列表字段
        this.flushField(config, currentChannel, currentField, currentList)
        currentField = fieldMatch[1]
        currentList = []

        // 检查内联值 (如 skills: [])
        const inlineValue = (fieldMatch[2] ?? '').trim()
        if (inlineValue === '[]') {
          currentField = ''
          currentList = []
        } else if (currentField === 'tool_permissions') {
          // 进入 tool_permissions 块：后续 6+ 空格缩进的行都属于此块
          inToolPermissions = true
          toolPermLines = []
          currentField = '' // tool_permissions 不是列表字段，清空避免被 flushField 处理
        }
        continue
      }

      // tool_permissions 块内的行（6+ 空格缩进）
      if (inToolPermissions) {
        // 仅收集 6 空格及以上缩进的行；遇到 4 空格或更小缩进的非空行（已在上文处理）会退出
        if (/^ {6,}\S/.test(trimmed)) {
          toolPermLines.push(trimmed)
          continue
        }
      }

      // 列表项: 6空格缩进 + "- "（tools/skills/prompt_fragments）
      const itemMatch = trimmed.match(/^ {6}- (.+)$/)
      if (itemMatch?.[1] && currentField) {
        currentList.push(itemMatch[1].trim())
      }
    }

    // 保存尾部字段
    if (inToolPermissions) flushToolPermissions()
    this.flushField(config, currentChannel, currentField, currentList)

    return config
  }

  /**
   * 解析 tool_permissions 块（第六阶段 #6）
   *
   * 输入是 YAML 中 tool_permissions: 之下、6+ 空格缩进的行集合，形如：
   *   "      read_file:"
   *   "        resource_scope:"
   *   "          scope: system"
   *   "          allowed_roots: []"
   *   "          denied_paths: []"
   *   "        requires_approval: false"
   *
   * 输出为 Record<toolName, ToolPermission>。
   *
   * 极简状态机：按缩进识别工具名 / resource_scope / 标量字段 / 列表字段。
   */
  private parseToolPermissionsBlock(lines: string[]): Record<string, ToolPermission> {
    const result: Record<string, ToolPermission> = {}
    let currentTool: ToolPermission | null = null
    let currentToolName = ''
    // 当前正在收集的列表字段（在 resource_scope 下）：'allowed_roots' | 'denied_paths' | null
    let listField: 'allowed_roots' | 'denied_paths' | null = null

    const finalizeTool = () => {
      if (currentToolName && currentTool) {
        result[currentToolName] = currentTool
      }
      currentTool = null
      currentToolName = ''
      listField = null
    }

    for (const line of lines) {
      const trimmed = line.trimEnd()
      if (!trimmed || trimmed.trim().startsWith('#')) continue

      // 工具名: 6 空格缩进 + "name:"
      const toolMatch = trimmed.match(/^ {6}([\w.]+):$/)
      if (toolMatch?.[1]) {
        finalizeTool()
        currentToolName = toolMatch[1]
        currentTool = {
          toolName: currentToolName,
          resourceScope: {
            allowedRoots: [],
            deniedPaths: [],
            scope: 'system',
          },
          requiresApproval: false,
        }
        listField = null
        continue
      }

      if (!currentTool) continue

      // resource_scope: 8 空格缩进
      if (/^ {8}resource_scope:\s*$/.test(trimmed)) {
        listField = null
        continue
      }

      // resource_scope 下的标量字段: 10 空格缩进 + "key: value"
      const scopeScalarMatch = trimmed.match(/^ {10}(\w+):\s*(.*)$/)
      if (scopeScalarMatch?.[1]) {
        const key = scopeScalarMatch[1]
        const value = (scopeScalarMatch[2] ?? '').trim()
        if (key === 'scope') {
          // 仅接受合法枚举值，否则回退 system
          const v = value.replace(/['"]/g, '')
          currentTool.resourceScope.scope =
            v === 'principal_workspace' || v === 'user_authorized' || v === 'system'
              ? v
              : 'system'
          listField = null
        } else if (key === 'allowed_roots' || key === 'denied_paths') {
          // 内联空数组
          if (value === '[]') {
            if (key === 'allowed_roots') currentTool.resourceScope.allowedRoots = []
            else currentTool.resourceScope.deniedPaths = []
            listField = null
          } else {
            // 后续行可能是列表项
            listField = key as 'allowed_roots' | 'denied_paths'
          }
          continue
        }
        // 其他未知字段忽略
        continue
      }

      // resource_scope 下的列表项: 12 空格缩进 + "- value"
      const scopeListItemMatch = trimmed.match(/^ {12}- (.+)$/)
      if (scopeListItemMatch?.[1] && listField) {
        const item = scopeListItemMatch[1].trim().replace(/['"]/g, '')
        if (listField === 'allowed_roots') {
          currentTool.resourceScope.allowedRoots.push(item)
        } else {
          currentTool.resourceScope.deniedPaths.push(item)
        }
        continue
      }

      // 工具级标量字段: 8 空格缩进 + "key: value"
      const toolScalarMatch = trimmed.match(/^ {8}(\w+):\s*(.*)$/)
      if (toolScalarMatch?.[1]) {
        const key = toolScalarMatch[1]
        const value = (toolScalarMatch[2] ?? '').trim()
        if (key === 'requires_approval') {
          currentTool.requiresApproval = value === 'true'
        }
        listField = null
        continue
      }
    }

    finalizeTool()
    return result
  }

  /** 将收集的列表写入配置 */
  private flushField(
    config: AgentCapabilityConfig,
    channel: string,
    field: string,
    list: string[],
  ): void {
    if (!channel || !field || list.length === 0) return

    const channelConfig = config.channels[channel]
    if (!channelConfig) return

    switch (field) {
      case 'tools':
        channelConfig.tools = [...list]
        break
      case 'skills':
        channelConfig.skills = [...list]
        break
      case 'prompt_fragments':
        channelConfig.prompt_fragments = [...list]
        break
    }
  }
}
