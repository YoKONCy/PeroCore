/**
 * 虚拟路径管理器
 *
 * 处理逻辑路径 (@app/@data/@workshop/@temp) 到物理路径的映射。
 * 两种部署模式通用，数据源差异通过 roots 配置自然消化。
 * 路径永远不能硬编码。
 *
 * @module packages/backend/src/core/pathResolver
 */

import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { createLogger } from '../lib/logger'

const logger = createLogger('PathResolver')

// ─────────────────────────────────────────────
// 运行时环境接口
// ─────────────────────────────────────────────

/**
 * 运行时环境配置
 *
 * 由 DI 容器根据部署形态（Electron / Docker）提供。
 */
export interface RuntimeEnv {
  /** 程序安装根目录 (只读) */
  appRoot: string
  /** 用户可写数据目录 */
  dataDir: string
  /** 运行时临时目录 */
  tempDir: string
  /** Steam Workshop 物品根目录列表（每个订阅物品一个只读根） */
  workshopDirs?: string[]
  /** 旧版单 Workshop 根目录，保留用于环境配置兼容 */
  workshopDir?: string
}

// ─────────────────────────────────────────────
// 逻辑前缀常量
// ─────────────────────────────────────────────

/** 支持的逻辑路径前缀 */
export type LogicalPrefix = '@app' | '@data' | '@workshop' | '@temp' | '@principal'

/** 全部前缀清单 */
export const ALL_PREFIXES: readonly LogicalPrefix[] = [
  '@app',
  '@data',
  '@workshop',
  '@temp',
  '@principal',
] as const

// ─────────────────────────────────────────────
// PathResolver 类
// ─────────────────────────────────────────────

export class PathResolver {
  private roots: Map<string, string>
  private workshopRoots: string[]

  constructor(env: RuntimeEnv) {
    const configuredWorkshopRoots = [
      ...(env.workshopDirs ?? []),
      ...(env.workshopDir ? [env.workshopDir] : []),
    ]
    this.workshopRoots = [
      ...new Set(configuredWorkshopRoots.filter(Boolean).map((dir) => path.resolve(dir))),
    ]

    this.roots = new Map<string, string>([
      ['@app', path.resolve(env.appRoot)],
      ['@data', path.resolve(env.dataDir)],
      ['@temp', path.resolve(env.tempDir)],
      // @workshop 的单路径解析仅用于兼容；联邦扫描必须使用 getRoots('@workshop')。
      ['@workshop', this.workshopRoots[0] ?? ''],
    ])

    // 确保可写目录存在 (只创建 @data 和 @temp，@app 和 @workshop 为只读)
    this.ensureDir(env.dataDir)
    this.ensureDir(env.tempDir)

    logger.info('虚拟路径管理器初始化完成', {
      '@app': env.appRoot,
      '@data': env.dataDir,
      '@temp': env.tempDir,
      '@workshop': this.workshopRoots.length > 0 ? this.workshopRoots : '(不可用)',
    })
  }

  /**
   * 解析逻辑路径为绝对物理路径
   *
   * @example
   * ```ts
   * resolver.resolve('@app/prompts/scorer/summary.md')
   * // → 'C:/infOS/resources/prompts/scorer/summary.md'
   *
   * resolver.resolve('@data/custom/prompts/scorer/summary.md')
   * // → '%APPDATA%/infOS/custom/prompts/scorer/summary.md'
   * ```
   */
  resolve(logicalPath: string): string {
    if (!logicalPath) {
      throw new Error('路径不能为空')
    }

    // 规范化路径分隔符
    const normalized = logicalPath.replace(/\\/g, '/')

    // 匹配逻辑前缀
    for (const [prefix, rootPath] of this.roots) {
      if (normalized.startsWith(prefix + '/')) {
        if (!rootPath) throw new Error(`${prefix} 根目录不可用`)
        const relativePart = normalized.slice(prefix.length + 1)
        return this.resolveWithin(rootPath, relativePart, prefix)
      }

      if (normalized === prefix) {
        return rootPath
      }
    }

    // 无匹配前缀 → 如果是绝对路径直接返回，否则相对于 @app
    if (path.isAbsolute(logicalPath)) {
      return logicalPath
    }

    return path.resolve(this.roots.get('@app')!, logicalPath)
  }

  /**
   * 检查前缀是否可用（路径非空且目录存在）
   *
   * 用于 AssetRegistry 判断 @workshop 是否可扫描。
   */
  isAvailable(prefix: string): boolean {
    const root = this.roots.get(prefix)
    return !!root && existsSync(root)
  }

  /** 获取指定前缀的根路径（单根兼容接口） */
  getRoot(prefix: string): string | undefined {
    return this.roots.get(prefix)
  }

  /**
   * 获取指定前缀的全部根路径。
   * Workshop 天然是多个订阅物品目录；其他逻辑前缀只返回单个根。
   */
  getRoots(prefix: string): string[] {
    if (prefix === '@workshop') return [...this.workshopRoots]
    const root = this.roots.get(prefix)
    return root ? [root] : []
  }

  /**
   * 解析 @principal 前缀路径
   *
   * @principal 是 Agent 的个人工作区前缀，解析到：
   *   @data/principals/{agentId}/workspace/{relativePath}
   *
   * 与 resolve() 不同，此方法需要 agentId 上下文，
   * 因为 @principal 的物理位置依赖 Agent。
   *
   * @param agentId Agent ID
   * @param relativePath workspace 内的相对路径（如 'notes/diary.md'）
   * @returns 绝对物理路径
   */
  resolvePrincipal(agentId: string, relativePath: string): string {
    const dataRoot = this.roots.get('@data')
    if (!dataRoot) {
      throw new Error('@data 根目录未配置，无法解析 @principal')
    }
    return path.resolve(dataRoot, 'principals', agentId, 'workspace', relativePath)
  }

  /** 获取 Agent 的 workspace 根目录 */
  getWorkspaceRoot(agentId: string): string {
    return this.resolvePrincipal(agentId, '.')
  }

  /** 安全解析根目录内的相对路径，拒绝 `..` 和绝对路径逃逸。 */
  private resolveWithin(rootPath: string, relativePath: string, prefix: string): string {
    const root = path.resolve(rootPath)
    const resolved = path.resolve(root, relativePath)
    const relative = path.relative(root, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`路径越界: ${prefix}/${relativePath}`)
    }
    return resolved
  }

  /** 确保目录存在 */
  private ensureDir(dirPath: string): void {
    try {
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true })
      }
    } catch (err) {
      logger.warn(`无法创建目录: ${dirPath}`, { error: err })
    }
  }
}
