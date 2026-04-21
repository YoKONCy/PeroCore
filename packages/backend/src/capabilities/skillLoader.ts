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

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import type { SkillManifest } from './types'
import { createLogger } from '../lib/logger'

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

  constructor(skillDirs: string[]) {
    this.skillDirs = skillDirs
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
    }
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
}
