/**
 * Preset Loader — 内置模式 Preset 加载器
 *
 * 从 presets/ 目录加载 YAML 格式的 Preset 文件，
 * 提供按 source 查询的接口供 PromptService 调用。
 *
 * 独立模块，不污染 MdpEngine 的单一职责。
 *
 * @module packages/backend/src/services/prompt/presetLoader
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import type { PromptPreset } from './mdpEngine'
import { createLogger } from '../../lib/logger'

const logger = createLogger('PresetLoader')

/** source → preset name 映射 */
const SOURCE_PRESET_MAP: Record<string, string> = {
  social: 'social',
  group_chat: 'group',
  group: 'group',
  work: 'work',
  ide: 'work',
  lightweight: 'lightweight',
}

export class PresetLoader {
  /** 已加载的 Preset 缓存 (name → PromptPreset) */
  private presets = new Map<string, PromptPreset>()

  constructor(private presetsDir: string) {
    this.loadAll()
  }

  /**
   * 根据对话来源获取内置 Preset
   *
   * 桌面模式返回 undefined，使用默认全槽位。
   */
  getPresetForSource(source: string): PromptPreset | undefined {
    const presetName = SOURCE_PRESET_MAP[source]
    return presetName ? this.presets.get(presetName) : undefined
  }

  /** 重新加载所有 Preset */
  loadAll(): void {
    this.presets.clear()

    if (!existsSync(this.presetsDir)) {
      logger.debug('presets/ 目录不存在，跳过加载')
      return
    }

    const files = readdirSync(this.presetsDir).filter(
      (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
    )

    for (const file of files) {
      try {
        const filePath = path.join(this.presetsDir, file)
        const raw = readFileSync(filePath, 'utf-8')
        const preset = this.parsePresetYaml(raw, file)
        if (preset) {
          this.presets.set(preset.name, preset)
          logger.debug(`已加载 Preset: ${preset.name} (${preset.slots.length} 个槽位覆盖)`)
        }
      } catch (err) {
        logger.warn(`加载 Preset ${file} 失败: ${err}`)
      }
    }

    logger.info(`已加载 ${this.presets.size} 个内置 Preset`)
  }

  // ─────────────────────────────────────────
  // 内部解析
  // ─────────────────────────────────────────

  /**
   * 解析 Preset YAML
   *
   * 格式约定 (简易解析，不引入完整 yaml 库):
   * - Frontmatter (---) 中含 name, description
   * - 主体按 "- id:" 分割，每块包含 enabled, userOverride (可选)
   */
  private parsePresetYaml(raw: string, filename: string): PromptPreset | null {
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
    if (!fmMatch) {
      logger.warn(`Preset ${filename} 缺少 frontmatter`)
      return null
    }

    const fmSection = fmMatch[1] ?? ''
    const body = fmMatch[2] ?? ''

    // 解析 frontmatter
    const nameMatch = fmSection.match(/^name:\s*(.+)$/m)
    const descMatch = fmSection.match(/^description:\s*(.+)$/m)
    const name = nameMatch?.[1]?.trim() ?? path.basename(filename, path.extname(filename))
    const description = descMatch?.[1]?.trim()

    // 按 "- id:" 分割成块
    const slotBlocks = body.split(/\n(?=- id:)/).filter((b) => b.trim())
    const slots: PromptPreset['slots'] = []

    for (const block of slotBlocks) {
      if (block.trim().startsWith('#')) continue

      const idMatch = block.match(/- id:\s*"?([^"\n]+)"?/)
      if (!idMatch) continue

      const id = idMatch[1]!.trim()
      const enabledMatch = block.match(/enabled:\s*(true|false)/)
      const enabled = enabledMatch ? enabledMatch[1] === 'true' : true

      // userOverride: 多行 YAML "| " 块
      let userOverride: string | undefined
      const overrideMatch = block.match(/userOverride:\s*\|\n([\s\S]*)$/)
      if (overrideMatch?.[1]) {
        const lines = overrideMatch[1].split('\n')
        const indent = lines[0]?.match(/^(\s*)/)?.[1]?.length ?? 0
        userOverride = lines
          .map((l) => (indent > 0 ? l.slice(indent) : l))
          .join('\n')
          .trimEnd()
      }

      const slotDef: PromptPreset['slots'][number] = {
        id,
        position: 0, // 保持原位
        enabled,
      }
      if (userOverride) {
        slotDef.userOverride = userOverride
      }

      slots.push(slotDef)
    }

    return { name, description, slots }
  }
}
