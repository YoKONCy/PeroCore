/**
 * Prompt Template Loader — 提示词模板加载器
 *
 * 支持用户覆盖提示词的 "三层查找" 策略:
 *
 *   1. @data/custom/prompts/{path}  — 用户自定义 (最高优先)
 *   2. @workshop/{path}             — Workshop 订阅 (如有)
 *   3. @app/backend/src/services/mdp/prompts/{path} — 官方内置 (兜底)
 *
 * 与 PathResolver 配合，两种部署形态自动适配。
 *
 * @module packages/backend/src/core/promptTemplateLoader
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { PathResolver } from './pathResolver'
import { createLogger } from '../lib/logger'

const logger = createLogger('PromptTemplateLoader')

export class PromptTemplateLoader {
  constructor(private pathResolver: PathResolver) {}

  /**
   * 加载提示词模板
   *
   * 按覆盖优先级查找:
   * 1. 用户自定义 (@data/custom/prompts/)
   * 2. Workshop (@workshop/prompts/) — 仅 Electron 版
   * 3. 官方内置 (@app/prompts/)
   *
   * @param templatePath 相对模板路径 (如 "scorer/summary.md")
   * @returns 模板内容
   */
  async load(templatePath: string): Promise<string> {
    // 1. 用户自定义优先
    const customPath = this.pathResolver.resolve(`@data/custom/prompts/${templatePath}`)
    if (existsSync(customPath)) {
      logger.debug(`加载自定义提示词: ${templatePath}`)
      return readFile(customPath, 'utf-8')
    }

    // 2. Workshop：按订阅顺序查找各 item 的 prompts/；后出现的 item 优先。
    const workshopRoots = this.pathResolver.getRoots('@workshop')
    for (let index = workshopRoots.length - 1; index >= 0; index -= 1) {
      const workshopPath = path.resolve(workshopRoots[index]!, 'prompts', templatePath)
      if (existsSync(workshopPath)) {
        logger.debug(`加载 Workshop 提示词: ${templatePath}`)
        return readFile(workshopPath, 'utf-8')
      }
    }

    // 3. 官方内置 (兜底)
    const officialPath = this.pathResolver.resolve(
      `@app/backend/src/services/mdp/prompts/${templatePath}`,
    )
    if (existsSync(officialPath)) {
      return readFile(officialPath, 'utf-8')
    }

    // 全部不存在 → 空字符串 + 警告
    logger.warn(`提示词模板未找到: ${templatePath}`)
    return ''
  }

  /**
   * 检测模板是否被用户覆盖
   */
  isCustomized(templatePath: string): boolean {
    const customPath = this.pathResolver.resolve(`@data/custom/prompts/${templatePath}`)
    return existsSync(customPath)
  }

  /**
   * 获取模板的实际加载来源
   */
  getSource(templatePath: string): 'custom' | 'workshop' | 'official' | 'missing' {
    const customPath = this.pathResolver.resolve(`@data/custom/prompts/${templatePath}`)
    if (existsSync(customPath)) return 'custom'

    const workshopRoots = this.pathResolver.getRoots('@workshop')
    for (let index = workshopRoots.length - 1; index >= 0; index -= 1) {
      const workshopPath = path.resolve(workshopRoots[index]!, 'prompts', templatePath)
      if (existsSync(workshopPath)) return 'workshop'
    }

    const officialPath = this.pathResolver.resolve(
      `@app/backend/src/services/mdp/prompts/${templatePath}`,
    )
    if (existsSync(officialPath)) return 'official'

    return 'missing'
  }

  /**
   * 将官方模板导出到用户自定义层
   *
   * 用户可在此基础上编辑，实现提示词个性化。
   *
   * @param templatePath 相对模板路径
   * @returns 导出后的绝对路径
   */
  async exportToCustom(templatePath: string): Promise<string> {
    const officialPath = this.pathResolver.resolve(
      `@app/backend/src/services/mdp/prompts/${templatePath}`,
    )
    const customPath = this.pathResolver.resolve(`@data/custom/prompts/${templatePath}`)

    if (!existsSync(officialPath)) {
      throw new Error(`官方模板不存在: ${templatePath}`)
    }

    // 确保目标目录存在
    const { mkdirSync } = await import('node:fs')
    const targetDir = path.dirname(customPath)
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    // 复制
    const content = await readFile(officialPath, 'utf-8')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(customPath, content, 'utf-8')

    logger.info(`提示词模板已导出到自定义层: ${templatePath}`)
    return customPath
  }

  /**
   * 恢复为官方版本 (删除用户自定义)
   */
  async restoreToOfficial(templatePath: string): Promise<boolean> {
    const customPath = this.pathResolver.resolve(`@data/custom/prompts/${templatePath}`)

    if (!existsSync(customPath)) return false

    const { unlink } = await import('node:fs/promises')
    await unlink(customPath)

    logger.info(`提示词模板已恢复为官方版本: ${templatePath}`)
    return true
  }
}
