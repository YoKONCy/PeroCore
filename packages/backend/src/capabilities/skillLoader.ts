/**
 * Skill Loader — Skill 文件加载器
 *
 * 负责:
 * 1. 扫描 skills/ 目录加载 SKILL.md 的 frontmatter (Manifest)
 * 2. 按需加载完整 Skill 指令 (L2 渐进式加载)
 * 3. 按需加载参考文件 (L3)
 *
 * 文件结构
 *
 * @module packages/backend/src/capabilities/skillLoader
 */

import { readFileSync, readdirSync, existsSync, statSync, cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { SkillManifest } from './types'
import { createLogger } from '../lib/logger'
import { AppError } from '../lib/appError'

const logger = createLogger('SkillLoader')

/** YAML frontmatter 分隔符正则 */
const RE_FRONTMATTER = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/

export class SkillLoader {
  /** 所有已加载的 Skill 清单 (id → Manifest) */
  private manifests = new Map<string, SkillManifest>()

  /** Skill 内容缓存 (id → markdown body) */
  private contentCache = new Map<string, string>()

  /** Skill 目录路径 */
  private skillDirs: string[]

  /** 用户 Skill 目录 (导入/删除操作目标) */
  private userSkillsDir: string

  constructor(skillDirs: string[], userSkillsDir: string) {
    this.skillDirs = skillDirs
    this.userSkillsDir = userSkillsDir
    this.reloadAll()
  }

  /** 扫描并加载所有 SKILL.md 的 frontmatter */
  reloadAll(): void {
    this.manifests.clear()
    this.contentCache.clear()

    for (const dir of this.skillDirs) {
      if (!existsSync(dir)) continue
      this.scanDir(dir)
    }

    logger.info(`已加载 ${this.manifests.size} 个 Skill 清单`)
  }

  /**
   * 运行时追加扫描目录 (Extension 联邦)
   *
   * ExtensionManager 加载完后调用，将发现的 Extension skills 目录注入。
   * 追加后自动扫描新目录中的 SKILL.md。
   */
  addDirs(dirs: string[]): void {
    let added = 0
    for (const dir of dirs) {
      if (this.skillDirs.includes(dir)) continue
      this.skillDirs.push(dir)
      if (existsSync(dir)) {
        this.scanDir(dir)
        added++
      }
    }
    if (added > 0) {
      logger.info(
        `追加扫描 ${added} 个 Extension skills 目录，当前共 ${this.manifests.size} 个 Skill`,
      )
    }
  }

  /** 获取 Skill 清单 (L1: 只有 name + description) */
  getManifest(skillId: string): SkillManifest | undefined {
    return this.manifests.get(skillId)
  }

  /** 获取所有清单 */
  getAllManifests(): SkillManifest[] {
    return [...this.manifests.values()]
  }

  /**
   * 加载完整 Skill 指令 (L2: 渐进式加载)
   *
   * 由 load_skill NIT 工具调用。返回 SKILL.md 的 markdown body。
   */
  loadSkillContent(skillId: string): string | null {
    // 缓存命中
    if (this.contentCache.has(skillId)) {
      return this.contentCache.get(skillId)!
    }

    // 懒加载: 在各 skillDir 中查找
    for (const dir of this.skillDirs) {
      const skillPath = path.join(dir, skillId, 'SKILL.md')
      if (!existsSync(skillPath)) continue

      try {
        const raw = readFileSync(skillPath, 'utf-8')
        const match = RE_FRONTMATTER.exec(raw)
        const body = match?.[2]?.trim() ?? raw.trim()
        this.contentCache.set(skillId, body)
        logger.debug(`Skill 内容已加载: ${skillId}`)
        return body
      } catch {
        logger.warn(`加载 Skill 内容失败: ${skillId}`)
      }
    }

    return null
  }

  /**
   * 加载参考文件 (L3: 极少使用)
   */
  loadReference(skillId: string, filename: string): string | null {
    for (const dir of this.skillDirs) {
      const refPath = path.join(dir, skillId, 'references', filename)
      if (!existsSync(refPath)) continue

      try {
        return readFileSync(refPath, 'utf-8')
      } catch {
        return null
      }
    }
    return null
  }

  // ── 导入 / 删除 (用户 Skill 管理) ──

  /**
   * 导入本地 Skill 文件夹到用户目录
   *
   * 验证来源有 SKILL.md → 检查目标不重复 → 递归复制 → 重新扫描。
   * @returns 导入后的文件夹名
   */
  importFromPath(sourcePath: string): string {
    // 验证来源路径存在
    if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
      throw new AppError('VALIDATION_ERROR', { message: `路径不存在或不是目录: ${sourcePath}` })
    }

    // 验证来源有 SKILL.md
    const skillMdPath = path.join(sourcePath, 'SKILL.md')
    if (!existsSync(skillMdPath)) {
      throw new AppError('VALIDATION_ERROR', {
        message: '该目录下没有 SKILL.md 文件，不是有效的 Skill 文件夹',
      })
    }

    // 确保用户目录存在
    if (!existsSync(this.userSkillsDir)) {
      mkdirSync(this.userSkillsDir, { recursive: true })
    }

    // 复制到 userSkillsDir/<folder-name>
    const folderName = path.basename(sourcePath)
    const destPath = path.join(this.userSkillsDir, folderName)

    // 检查目标是否已存在
    if (existsSync(destPath)) {
      throw new AppError('ALREADY_EXISTS', {
        message: `目标目录已存在: ${folderName}，请先删除或重命名`,
        data: { resource: folderName },
      })
    }

    // 递归复制
    cpSync(sourcePath, destPath, { recursive: true })
    logger.info(`Skill 已导入: ${folderName}`, { sourcePath, destPath })

    // 重新扫描
    this.reloadAll()

    return folderName
  }

  /**
   * 删除用户 Skill
   *
   * 只允许删除 userSkillsDir 下的 Skill，不允许删内置或 Extension 的。
   */
  deleteById(skillId: string): void {
    const skillPath = path.join(this.userSkillsDir, skillId)

    if (!existsSync(skillPath)) {
      throw new AppError('NOT_FOUND', {
        message: `Skill "${skillId}" 不存在或不在用户目录中`,
      })
    }

    rmSync(skillPath, { recursive: true, force: true })
    logger.info(`Skill 已删除: ${skillId}`)

    // 重新扫描
    this.reloadAll()
  }

  // ── 内部 ──

  private scanDir(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const skillDir = path.join(dir, entry)
      if (!statSync(skillDir).isDirectory()) continue

      const skillMdPath = path.join(skillDir, 'SKILL.md')
      if (!existsSync(skillMdPath)) continue

      try {
        const manifest = this.parseManifest(entry, skillMdPath)
        if (manifest) {
          this.manifests.set(manifest.id, manifest)
        }
      } catch (err) {
        logger.warn(`解析 Skill ${entry} 失败: ${err}`)
      }
    }
  }

  /** 解析 SKILL.md 的 YAML frontmatter */
  private parseManifest(skillId: string, filePath: string): SkillManifest | null {
    const raw = readFileSync(filePath, 'utf-8')
    const match = RE_FRONTMATTER.exec(raw)
    if (!match) {
      logger.warn(`Skill ${skillId} 缺少 frontmatter`)
      return null
    }

    const frontmatter = match[1] ?? ''
    // 简易 YAML 解析 (避免引入完整 yaml 库)
    const fields = this.parseSimpleYaml(frontmatter)

    return {
      id: skillId,
      name: fields.name ?? skillId,
      description: fields.description ?? '',
      requiredTools: this.parseYamlList(fields.requiredTools),
      category: fields.category ?? 'general',
      tags: this.parseYamlList(fields.tags),
      parameters: this.parseYamlMap(fields.parameters),
      dependsOnSkills: this.parseYamlList(fields.dependsOnSkills),
    }
  }

  /**
   * 加载 Skill 内容并注入参数 (L2+)
   *
   * 参数通过 `{{param_name}}` 模板变量注入到 SKILL.md body 中。
   * 未提供的参数保留原始占位符。
   */
  loadSkillContentWithParams(skillId: string, params?: Record<string, string>): string | null {
    const raw = this.loadSkillContent(skillId)
    if (!raw) return null

    // 无参数时直接返回
    if (!params || Object.keys(params).length === 0) return raw

    // 模板变量替换: {{key}} → value
    let result = raw
    for (const [key, value] of Object.entries(params)) {
      result = result.replaceAll(`{{${key}}}`, value)
    }
    return result
  }

  /** 极简 YAML 解析器 (只处理 key: value 和 key:\n  - item 两种) */
  private parseSimpleYaml(text: string): Record<string, string> {
    const result: Record<string, string> = {}
    let currentKey = ''
    let currentList: string[] | null = null

    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      // 检测列表项
      if (trimmed.startsWith('- ') && currentKey) {
        if (!currentList) currentList = []
        currentList.push(trimmed.slice(2).trim())
        continue
      }

      // 如果之前在收集列表，先保存
      if (currentList && currentKey) {
        result[currentKey] = JSON.stringify(currentList)
        currentList = null
      }

      // key: value 格式
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        currentKey = trimmed.slice(0, colonIdx).trim()
        const value = trimmed.slice(colonIdx + 1).trim()
        if (value) {
          result[currentKey] = value
          currentKey = '' // 非列表模式
        }
        // 如果 value 为空，可能是后面跟列表
      }
    }

    // 尾部列表
    if (currentList && currentKey) {
      result[currentKey] = JSON.stringify(currentList)
    }

    return result
  }

  /** 解析 YAML 列表字段 */
  private parseYamlList(value?: string): string[] {
    if (!value) return []
    try {
      return JSON.parse(value) as string[]
    } catch {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  /**
   * 解析 YAML key: value 映射字段
   *
   * 支持两种格式:
   * 1. 内联 JSON: `parameters: {"key": "desc"}`
   * 2. YAML 列表格式 (被 parseSimpleYaml 解析为逐条 "key: value"):
   *    parameters:
   *      - project_name: 项目名称
   *      - date_range: 日期范围
   */
  private parseYamlMap(value?: string): Record<string, string> {
    if (!value) return {}
    try {
      // 尝试 JSON 格式
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        // 列表格式: ["project_name: 项目名称", "date_range: 日期范围"]
        const map: Record<string, string> = {}
        for (const item of parsed) {
          const idx = String(item).indexOf(':')
          if (idx > 0) {
            map[String(item).slice(0, idx).trim()] = String(item)
              .slice(idx + 1)
              .trim()
          }
        }
        return map
      }
      // 对象格式: {"project_name": "项目名称"}
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, string>
      }
    } catch {
      // 单行 key: value 格式 无法解析
    }
    return {}
  }
}
