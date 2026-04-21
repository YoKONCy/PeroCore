/**
 * MDP 模板引擎 v2 — Nunjucks 渲染 + SillyTavern 风格提示词拼接
 *
 * 核心功能：
 * 1. Nunjucks 模板渲染 (兼容 Jinja2 的 {{ variable }} 语法)
 * 2. YAML Frontmatter 解析 (元数据: role, position, enabled 等)
 * 3. Agent 模板覆盖 (pero/system → 回退 system)
 * 4. **提示词槽位系统 (PromptSlot)** — 类似 SillyTavern 的有序拼接
 *
 * 设计思想 (SillyTavern 式提示词编排)：
 * ───────────────────────────────────────────
 * 每个提示词片段 = 一个 PromptSlot，有唯一 ID、角色、排序位置。
 * 用户可在前端：
 *   - 拖拽排序各 Slot 的 position
 *   - 启用/禁用某个 Slot
 *   - 编辑 Slot 内容 (覆盖默认模板)
 *   - 在任意位置插入自定义 Slot
 *
 * 后端按 position 升序排列所有 enabled 的 Slot，
 * 渲染每个 Slot 的 Nunjucks 模板，然后生成最终的消息列表。
 *
 * @module packages/backend/src/services/prompt/mdpEngine
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import nunjucks from 'nunjucks'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MdpEngine')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 解析后的 MDP 模板 (磁盘表示) */
export interface MdPrompt {
  /** 模板键 (如 "tasks/scorer_summary") */
  key: string
  /** 模板内容 (原始 Nunjucks 模板) */
  content: string
  /** YAML Frontmatter 元数据 */
  meta: PromptMeta
}

/** 模板元数据 (YAML Frontmatter) */
export interface PromptMeta {
  /** 消息角色 */
  role?: 'system' | 'user' | 'assistant'
  /** 排序位置 (越小越靠前) */
  position?: number
  /** 是否默认启用 */
  enabled?: boolean
  /** 槽位 ID (用于前端标识，默认 = key) */
  slotId?: string
  /** 显示名称 (前端用) */
  label?: string
  /** 分组 (前端分组显示) */
  group?: string
  /** 是否允许用户编辑 */
  editable?: boolean
  /** 是否系统内置 (不可删除) */
  builtin?: boolean
  /** 其他自定义字段 */
  [key: string]: unknown
}

/**
 * 提示词槽位 (SillyTavern 风格)
 *
 * 运行时的一个提示词片段。支持用户覆盖和排序。
 */
export interface PromptSlot {
  /** 唯一标识 (对应模板的 slotId 或 key) */
  id: string
  /** 显示名称 */
  label: string
  /** 消息角色 */
  role: 'system' | 'user' | 'assistant'
  /** 排序位置 (升序) */
  position: number
  /** 是否启用 */
  enabled: boolean
  /** 原始模板内容 (Nunjucks) */
  template: string
  /** 用户覆盖的内容 (优先于 template) */
  userOverride?: string
  /** 分组标识 */
  group: string
  /** 是否允许编辑 */
  editable: boolean
  /** 是否系统内置 */
  builtin: boolean
  /** 渲染后的内容 (调用 render 后填充) */
  rendered?: string
}

/** 提示词拼接预设 (用户可保存/加载的排列方案) */
export interface PromptPreset {
  /** 预设名称 */
  name: string
  /** 预设描述 */
  description?: string
  /** 槽位排列 (override 现有槽位 + 可新增自定义槽位) */
  slots: Array<{
    id: string
    position: number
    enabled: boolean
    userOverride?: string
    /** 以下字段仅用于用户新增的自定义槽位 (builtin 槽位无需填写) */
    label?: string
    role?: 'system' | 'user' | 'assistant'
    template?: string
  }>
}

/** 渲染后的消息 */
export interface RenderedMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  /** 来源 Slot ID (调试用) */
  slotId: string
}

// ─────────────────────────────────────────────
// 预定义槽位位置 (默认排序)
// ─────────────────────────────────────────────

/** 默认位置常量 (间隔 100 方便用户插入) */
export const DEFAULT_POSITIONS = {
  /** 系统核心人设 */
  SYSTEM_PERSONA: 100,
  /** COT 思维链引导 */
  COT_GUIDANCE: 150,
  /** 能力描述 */
  ABILITIES: 200,
  /** 草稿心流 (预留) */
  DRAFT_FLOW: 250,
  /** 工具描述 */
  TOOLS: 300,
  /** 规则约束 */
  RULES: 400,
  /** 知识/技能片段 */
  KNOWLEDGE: 500,
  /** 社交/工作模式补丁 */
  MODE_PATCH: 600,
  /** 记忆上下文 (RAG) */
  MEMORY_CONTEXT: 700,
  /** 宠物状态 */
  PET_STATE: 800,
  /** 用户画像 */
  USER_PERSONA: 900,
  /** 对话历史 (预留, 由 Pipeline 注入) */
  HISTORY: 5000,
  /** 当前用户消息 (预留) */
  USER_MESSAGE: 9000,
  /** 尾部注入 (jailbreak/remind) */
  FOOTER: 9500,
} as const

// ─────────────────────────────────────────────
// 正则
// ─────────────────────────────────────────────

/** YAML Frontmatter 匹配 */
const RE_FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/

/** HTML 注释 */
const RE_COMMENT = /<!--[\s\S]*?-->/g

// ─────────────────────────────────────────────
// 引擎
// ─────────────────────────────────────────────

export class MdpEngine {
  /** 所有已加载的模板 (key → MdPrompt) */
  private prompts = new Map<string, MdPrompt>()

  /** Nunjucks 环境 */
  private nj: nunjucks.Environment

  /** Agent 模板根目录 (用于覆盖查找) */
  private agentsDir: string

  constructor(private promptDir: string) {
    this.agentsDir = path.join(path.dirname(promptDir), 'agents')

    // 创建 Nunjucks 环境 (不自动转义, 允许未定义变量)
    this.nj = new nunjucks.Environment(null, {
      autoescape: false,
      throwOnUndefined: false,
      trimBlocks: true,
      lstripBlocks: true,
    })

    // 注册自定义过滤器
    this.registerFilters()

    this.reloadAll()
  }

  // ─────────────────────────────────────────
  // 公开 API: 模板管理
  // ─────────────────────────────────────────

  /** 从磁盘重新加载所有模板 */
  reloadAll(): void {
    this.prompts.clear()

    // 1. 加载 prompts/ 下所有 .md
    if (existsSync(this.promptDir)) {
      this.scanDir(this.promptDir, this.promptDir)
    }

    // 2. 加载 agents/ 下所有 .md
    if (existsSync(this.agentsDir)) {
      this.scanDir(this.agentsDir, this.agentsDir)
    }

    logger.info(`已加载 ${this.prompts.size} 个 MDP 模板`)
  }

  /** 获取模板对象 */
  getPrompt(key: string): MdPrompt | undefined {
    return this.prompts.get(key)
  }

  /** 列出所有模板键 */
  listKeys(): string[] {
    return [...this.prompts.keys()]
  }

  // ─────────────────────────────────────────
  // 公开 API: 渲染 (单模板)
  // ─────────────────────────────────────────

  /**
   * 渲染单个模板
   *
   * 适用于 Scorer / Reflection 等后台任务直接渲染提示词。
   *
   * @param templateKey - 模板键或 Agent 覆盖键
   * @param vars - 变量字典
   */
  render(templateKey: string, vars: Record<string, unknown> = {}): string {
    const resolved = this.resolveKey(templateKey, vars)
    const prompt = this.prompts.get(resolved)
    if (!prompt) {
      logger.warn(`模板未找到: ${templateKey}`)
      return `{{Missing: ${templateKey}}}`
    }
    return this.renderTemplate(prompt.content, vars)
  }

  /**
   * 渲染 Nunjucks 模板字符串
   *
   * 暴露给外部直接渲染任意模板文本。
   */
  renderString(template: string, vars: Record<string, unknown> = {}): string {
    try {
      return this.nj.renderString(template, vars).trim()
    } catch (err) {
      logger.warn(`Nunjucks 渲染失败`, { error: err })
      return template
    }
  }

  // ─────────────────────────────────────────
  // 公开 API: 提示词拼接系统 (SillyTavern 风格)
  // ─────────────────────────────────────────

  /**
   * 从模板构建默认槽位列表
   *
   * 加载所有 `slots/` 子目录下的模板，
   * 按 frontmatter 中的 role/position/enabled 构建 PromptSlot[]。
   *
   * @param agentId - Agent ID (用于模板覆盖)
   */
  buildDefaultSlots(agentId?: string): PromptSlot[] {
    const slots: PromptSlot[] = []

    for (const [key, prompt] of this.prompts) {
      const meta = prompt.meta

      // 只有带 role 元数据的模板才参与槽位系统
      if (!meta.role) continue

      // Agent 覆盖: 如果有 agentId/key, 优先使用
      let finalPrompt = prompt
      if (agentId) {
        const override = this.prompts.get(`${agentId}/${key}`)
        if (override) finalPrompt = override
      }

      slots.push({
        id: meta.slotId ?? key,
        label: (meta.label as string) ?? key,
        role: meta.role,
        position: meta.position ?? DEFAULT_POSITIONS.KNOWLEDGE,
        enabled: meta.enabled !== false,
        template: finalPrompt.content,
        group: (meta.group as string) ?? 'default',
        editable: meta.editable !== false,
        builtin: meta.builtin === true,
      })
    }

    // 按 position 排序
    return slots.sort((a, b) => a.position - b.position)
  }

  /**
   * 应用用户预设
   *
   * 将预设中的排序/启用/覆盖内容合并到默认槽位。
   *
   * @param defaultSlots - buildDefaultSlots() 的输出
   * @param preset - 用户保存的预设
   */
  applyPreset(defaultSlots: PromptSlot[], preset: PromptPreset): PromptSlot[] {
    const presetMap = new Map(preset.slots.map((s) => [s.id, s]))
    const result = defaultSlots.map((slot) => {
      const override = presetMap.get(slot.id)
      if (!override) return slot
      return {
        ...slot,
        position: override.position,
        enabled: override.enabled,
        userOverride: override.userOverride,
      }
    })

    // 合并用户自定义新增槽位 (preset 中有但 defaultSlots 中没有的)
    const existingIds = new Set(result.map((s) => s.id))
    for (const ps of preset.slots) {
      if (!existingIds.has(ps.id) && ps.template) {
        result.push({
          id: ps.id,
          label: ps.label ?? ps.id,
          role: ps.role ?? 'system',
          position: ps.position,
          enabled: ps.enabled,
          template: ps.template,
          group: 'custom',
          editable: true,
          builtin: false,
        })
      }
    }

    // 按新的 position 排序
    return result.sort((a, b) => a.position - b.position)
  }

  /**
   * 渲染槽位列表 → 消息列表
   *
   * 核心方法: 将有序的 PromptSlot[] 渲染为最终的 LLM 消息。
   *
   * @param slots - 已排序的槽位列表
   * @param vars - 渲染变量
   * @param options - 渲染选项
   */
  renderSlots(
    slots: PromptSlot[],
    vars: Record<string, unknown> = {},
    options: {
      /** 是否合并相邻同角色消息 (减少消息数) */
      mergeAdjacentRoles?: boolean
      /** 是否跳过空内容 */
      skipEmpty?: boolean
    } = {},
  ): RenderedMessage[] {
    const { mergeAdjacentRoles = true, skipEmpty = true } = options

    const messages: RenderedMessage[] = []

    for (const slot of slots) {
      if (!slot.enabled) continue

      // 优先用户覆盖，否则用默认模板
      const template = slot.userOverride ?? slot.template
      const rendered = this.renderTemplate(template, vars)

      if (skipEmpty && !rendered.trim()) continue

      // 回写渲染结果
      slot.rendered = rendered

      messages.push({
        role: slot.role,
        content: rendered,
        slotId: slot.id,
      })
    }

    // 合并相邻同角色消息
    if (mergeAdjacentRoles) {
      return this.mergeMessages(messages)
    }

    return messages
  }

  /**
   * 导出预设 (从当前槽位状态)
   */
  exportPreset(name: string, slots: PromptSlot[], description?: string): PromptPreset {
    return {
      name,
      description,
      slots: slots.map((s) => ({
        id: s.id,
        position: s.position,
        enabled: s.enabled,
        userOverride: s.userOverride,
      })),
    }
  }

  /**
   * 保存预设到磁盘
   */
  savePreset(preset: PromptPreset, savePath: string): void {
    const dir = path.dirname(savePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(savePath, JSON.stringify(preset, null, 2), 'utf-8')
    logger.info(`预设已保存: ${preset.name} → ${savePath}`)
  }

  /**
   * 从磁盘加载预设
   */
  loadPreset(presetPath: string): PromptPreset | null {
    try {
      const raw = readFileSync(presetPath, 'utf-8')
      return JSON.parse(raw) as PromptPreset
    } catch (err) {
      logger.warn(`加载预设失败: ${presetPath}`, { error: err })
      return null
    }
  }

  // ─────────────────────────────────────────
  // 内部方法: 渲染
  // ─────────────────────────────────────────

  /** Nunjucks 渲染 + 注释剥离 */
  private renderTemplate(template: string, vars: Record<string, unknown>): string {
    try {
      let result = this.nj.renderString(template, vars)
      // 剥离 HTML 注释
      result = result.replace(RE_COMMENT, '')
      return result.trim()
    } catch (err) {
      logger.warn(`Nunjucks 渲染失败`, { error: err })
      return template
    }
  }

  /** 合并相邻同角色消息 */
  private mergeMessages(messages: RenderedMessage[]): RenderedMessage[] {
    if (messages.length <= 1) return messages

    const merged: RenderedMessage[] = []
    for (const msg of messages) {
      const prev = merged[merged.length - 1]
      if (prev && prev.role === msg.role) {
        prev.content = prev.content + '\n\n' + msg.content
        prev.slotId = prev.slotId + '+' + msg.slotId
      } else {
        merged.push({ ...msg })
      }
    }
    return merged
  }

  // ─────────────────────────────────────────
  // 内部方法: Agent 覆盖
  // ─────────────────────────────────────────

  /** 解析 Agent 覆盖 (pero/system_prompt → 回退 system_prompt) */
  private resolveKey(key: string, vars: Record<string, unknown>): string {
    const agentName = (vars.agent_name ?? vars.agentName) as string | undefined
    if (agentName) {
      const overrideKey = `${agentName}/${key}`
      if (this.prompts.has(overrideKey)) return overrideKey
    }
    return key
  }

  // ─────────────────────────────────────────
  // 内部方法: 文件扫描
  // ─────────────────────────────────────────

  /** 递归扫描目录加载 .md 文件 */
  private scanDir(dir: string, baseDir: string): void {
    for (const entry of readdirSync(dir)) {
      const fullPath = path.join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        this.scanDir(fullPath, baseDir)
      } else if (entry.endsWith('.md') || entry.endsWith('.txt')) {
        this.loadFile(fullPath, baseDir)
      }
    }
  }

  /** 解析单个模板文件 */
  private loadFile(filePath: string, baseDir: string): void {
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/')
      const key = relPath.replace(/\.(md|txt)$/, '')

      let content = raw
      let meta: PromptMeta = {}

      // 解析 YAML Frontmatter
      const fmMatch = RE_FRONTMATTER.exec(raw)
      if (fmMatch) {
        meta = this.parseSimpleYaml(fmMatch[1] ?? '')
        content = fmMatch[2] ?? ''
      }

      // 注意: 不再剥离注释，Nunjucks 渲染后再剥离
      content = content.trim()

      this.prompts.set(key, { key, content, meta })

      // 注册基名 (兼容短名调用)
      const basename = path.basename(key)
      if (!this.prompts.has(basename)) {
        this.prompts.set(basename, { key, content, meta })
      }
    } catch (err) {
      logger.warn(`加载模板失败: ${filePath}`, { error: err })
    }
  }

  /** 简易 YAML 解析 (支持基本类型: string/number/boolean) */
  private parseSimpleYaml(yaml: string): PromptMeta {
    const result: PromptMeta = {}
    for (const line of yaml.split('\n')) {
      const match = /^(\w+)\s*:\s*(.+)$/.exec(line.trim())
      if (match && match[1] && match[2]) {
        const key = match[1]
        let val: unknown = match[2].replace(/^['"]|['"]$/g, '')

        // 类型推断
        if (val === 'true') val = true
        else if (val === 'false') val = false
        else if (/^\d+$/.test(val as string)) val = parseInt(val as string, 10)
        else if (/^\d+\.\d+$/.test(val as string)) val = parseFloat(val as string)

        result[key] = val
      }
    }
    return result
  }

  // ─────────────────────────────────────────
  // 内部方法: Nunjucks 过滤器
  // ─────────────────────────────────────────

  /** 注册自定义 Nunjucks 过滤器 */
  private registerFilters(): void {
    // 截断
    this.nj.addFilter('truncate', (str: string, length: number) => {
      if (!str) return ''
      return str.length > length ? str.slice(0, length) + '...' : str
    })

    // 默认值 (Nunjucks 内置有 default，这里补充 d 别名)
    this.nj.addFilter('d', (val: unknown, defaultVal: unknown) => {
      return val ?? defaultVal ?? ''
    })

    // 时间格式化
    this.nj.addFilter('timeago', (dateStr: string) => {
      if (!dateStr) return '未知'
      const diff = Date.now() - new Date(dateStr).getTime()
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return `${minutes} 分钟前`
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return `${hours} 小时前`
      const days = Math.floor(hours / 24)
      return `${days} 天前`
    })

    // 列表拼接
    this.nj.addFilter('joinlines', (arr: string[]) => {
      if (!Array.isArray(arr)) return ''
      return arr.filter(Boolean).join('\n')
    })

    // XML 包裹
    this.nj.addFilter('xmlwrap', (content: string, tag: string) => {
      if (!content?.trim()) return ''
      return `<${tag}>\n${content}\n</${tag}>`
    })
  }
}
