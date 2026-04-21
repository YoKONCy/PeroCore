/**
 * Extension Loader — 动态扩展加载器
 *
 * 负责：
 * 1. 扫描扩展目录 (内置 + 用户)
 * 2. 验证 manifest.json
 * 3. 动态 import() 加载入口文件
 * 4. 平台兼容性检查
 *
 * @module packages/backend/src/extensions/extensionLoader
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '../lib/logger'
import type { ExtensionManifest, ToolExtension, HookExtension, ServiceExtension } from './types'

const logger = createLogger('ExtensionLoader')

/** 加载结果 */
export interface LoadResult {
  manifest: ExtensionManifest
  dirPath: string
  module: ToolExtension | HookExtension | ServiceExtension | null
  error?: string
}

/** 当前运行平台 */
function getCurrentPlatform(): string {
  const p = process.platform
  if (p === 'win32') return 'windows'
  if (p === 'linux') {
    // Docker 环境检测
    if (existsSync('/.dockerenv') || existsSync('/run/.containerenv')) return 'docker'
    return 'linux'
  }
  return p // darwin 等直接返回
}

export class ExtensionLoader {
  private currentPlatform: string

  constructor() {
    this.currentPlatform = getCurrentPlatform()
  }

  /**
   * 扫描目录加载所有扩展
   *
   * @param dir - 扩展根目录 (每个子目录是一个扩展)
   */
  async scanAndLoadAll(dir: string): Promise<LoadResult[]> {
    if (!existsSync(dir)) {
      logger.debug(`扩展目录不存在: ${dir}`)
      return []
    }

    const results: LoadResult[] = []
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const extDir = path.join(dir, entry)
      if (!statSync(extDir).isDirectory()) continue

      const result = await this.loadFromDir(extDir)
      if (result) results.push(result)
    }

    return results
  }

  /**
   * 从指定目录加载单个扩展
   */
  async loadFromDir(extDir: string): Promise<LoadResult | null> {
    const manifestPath = path.join(extDir, 'manifest.json')

    // 1. 读取 manifest
    if (!existsSync(manifestPath)) {
      logger.debug(`跳过无 manifest.json 的目录: ${extDir}`)
      return null
    }

    let manifest: ExtensionManifest
    try {
      const raw = readFileSync(manifestPath, 'utf-8')
      manifest = JSON.parse(raw) as ExtensionManifest
      manifest.path = extDir
    } catch (err) {
      const msg = `manifest.json 解析失败: ${extDir}`
      logger.warn(msg, { error: err })
      return {
        manifest: { id: path.basename(extDir), name: '', version: '', type: 'tool', entry: '' },
        dirPath: extDir,
        module: null,
        error: msg,
      }
    }

    // 2. 验证必要字段
    const validationError = this.validateManifest(manifest)
    if (validationError) {
      logger.warn(`扩展清单校验失败 (${manifest.id}): ${validationError}`)
      return { manifest, dirPath: extDir, module: null, error: validationError }
    }

    // 3. 平台兼容性检查
    if (manifest.platforms && !manifest.platforms.includes(this.currentPlatform as any)) {
      logger.info(`扩展 ${manifest.id} 不兼容当前平台 (${this.currentPlatform})`)
      return {
        manifest,
        dirPath: extDir,
        module: null,
        error: `不兼容平台: ${this.currentPlatform}`,
      }
    }

    // 4. Service 类型不在此处加载模块 (由 ServiceRunner 管理)
    if (manifest.type === 'service') {
      logger.debug(`Service 扩展 ${manifest.id} 将由 ServiceRunner 启动`)
      return { manifest, dirPath: extDir, module: null }
    }

    // 5. 动态加载入口文件 (Tool / Hook)
    const entryPath = path.join(extDir, manifest.entry)
    if (!existsSync(entryPath)) {
      const msg = `入口文件不存在: ${entryPath}`
      logger.warn(msg)
      return { manifest, dirPath: extDir, module: null, error: msg }
    }

    try {
      const mod = await import(pathToFileURL(entryPath).href)
      const extension = mod.default ?? mod

      logger.debug(`扩展已加载: ${manifest.id} (${manifest.type})`)
      return { manifest, dirPath: extDir, module: extension }
    } catch (err) {
      const msg = `扩展 import() 失败: ${manifest.id}`
      logger.error(msg, { error: err instanceof Error ? err.message : String(err) })
      return { manifest, dirPath: extDir, module: null, error: msg }
    }
  }

  // ── 内部方法 ──

  /** 验证 manifest 必要字段 */
  private validateManifest(manifest: ExtensionManifest): string | null {
    if (!manifest.id) return '缺少 id'
    if (!manifest.type) return '缺少 type'
    if (!manifest.entry) return '缺少 entry'
    if (!['tool', 'hook', 'service'].includes(manifest.type)) {
      return `未知 type: ${manifest.type}`
    }
    return null
  }
}
