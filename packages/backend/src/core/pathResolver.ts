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
  /** Steam Workshop 目录 (Docker 版为空字符串) */
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

  constructor(env: RuntimeEnv) {
    this.roots = new Map<string, string>([
      ['@app', env.appRoot],
      ['@data', env.dataDir],
      ['@temp', env.tempDir],
      ['@workshop', env.workshopDir ?? ''],
    ])

    // 确保可写目录存在 (只创建 @data 和 @temp，@app 和 @workshop 为只读)
    this.ensureDir(env.dataDir)
    this.ensureDir(env.tempDir)

    logger.info('虚拟路径管理器初始化完成', {
      '@app': env.appRoot,
      '@data': env.dataDir,
      '@temp': env.tempDir,
      '@workshop': env.workshopDir ?? '(不可用)',
    })
  }

  /**
   * 解析逻辑路径为绝对物理路径
   *
   * @example
   * ```ts
   * resolver.resolve('@app/prompts/scorer/summary.md')
   * // → 'C:/PeroCore/resources/prompts/scorer/summary.md'
   *
   * resolver.resolve('@data/custom/prompts/scorer/summary.md')
   * // → '%APPDATA%/PeroCore/custom/prompts/scorer/summary.md'
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
        const relativePart = normalized.slice(prefix.length + 1)
        return path.resolve(rootPath, relativePart)
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

  /** 获取指定前缀的根路径 */
  getRoot(prefix: string): string | undefined {
    return this.roots.get(prefix)
  }

  /**
   * 解析 @principal 前缀路径
   *
   * @principal 是 Agent 的个人工作区前缀，解析到：
   *   @data/agents/{agentId}/workspace/{relativePath}
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
    return path.resolve(dataRoot, 'agents', agentId, 'workspace', relativePath)
  }

  /** 获取 Agent 的 workspace 根目录 */
  getWorkspaceRoot(agentId: string): string {
    return this.resolvePrincipal(agentId, '.')
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
