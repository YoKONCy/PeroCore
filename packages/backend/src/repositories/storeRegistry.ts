/**
 * 记忆 Store 注册表
 *
 * 管理 Agent 私有 EventNote Store 与全局共享 Facts Store。
 *
 * 文件结构:
 * ```
 * data/
 * ├── agent_pero/memory.tdb
 * ├── agent_neko/memory.tdb
 * └── knowledge/facts.tdb
 * ```
 *
 * @module packages/backend/src/repositories/storeRegistry
 */

import path from 'node:path'
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)
// triviumdb 是 NAPI CJS 模块 (module.exports = { TriviumDB })，ESM 只能通过 require 加载
import type { TriviumDB as TriviumDBType } from 'triviumdb'
const _triviumModule = _require('triviumdb') as {
  TriviumDB: new (...args: unknown[]) => TriviumDBType
}
const TriviumDB = _triviumModule.TriviumDB
import type { PathResolver } from '../core/pathResolver'
import { createLogger } from '../lib/logger'

const logger = createLogger('StoreRegistry')

/** Store 模式 */
export type StoreMode = 'main' | 'social'
export type SharedStoreKind = 'facts'

/** 向量维度配置 (与 EmbeddingService 对齐) */
const DEFAULT_DIM = 1536

// ─────────────────────────────────────────────
// Store 注册表
// ─────────────────────────────────────────────

export class MemoryStoreRegistry {
  /** 缓存已打开的 TriviumDB 实例 (key = 文件路径) */
  private stores = new Map<string, TriviumDBType>()
  /** 文本索引脏标记 (key = 文件路径，true 表示有新增 indexText 未编译) */
  private textIndexDirty = new Map<string, boolean>()

  constructor(
    private pathResolver: PathResolver,
    private dim: number = DEFAULT_DIM,
  ) {}

  /**
   * Agent 专属事件记忆 Store (物理隔离)
   *
   * @example getAgentStore('pero', 'main') → data/agent_pero/main.tdb
   */
  getAgentStore(agentId: string, mode: StoreMode = 'main'): TriviumDBType {
    const tdbPath = this.resolveAgentStorePath(agentId, mode)
    return this.getOrCreate(tdbPath)
  }

  /** 全 Agent 共享的事实库。 */
  getSharedStore(kind: SharedStoreKind): TriviumDBType {
    return this.getOrCreate(this.resolveSharedStorePath(kind))
  }

  resolveSharedStorePath(kind: SharedStoreKind): string {
    return this.pathResolver.resolve(`@data/knowledge/${kind}.tdb`)
  }

  /**
   * 根据来源自动选择 Store
   *
   * 仅外部平台社交来源写入独立社交记忆：
   * - 'social' → social.tdb
   * - 'group' / 'group_chat' → main.tdb（infOS 内部据点多 Agent 群聊）
   * - 其他（desktop/companion）→ main.tdb
   *
   * @param agentId Agent ID
   * @param source  记忆来源（channel 或旧版 MemorySource）
   */
  getStoreBySource(agentId: string, source: string): TriviumDBType {
    switch (source) {
      case 'social':
        return this.getAgentStore(agentId, 'social')
      default:
        return this.getAgentStore(agentId, 'main')
    }
  }

  /** 当前Store维度；热更新时由重建流程统一切换。 */
  getDimension(): number {
    return this.dim
  }

  removeLegacyStores(): void {
    const dataRoot = this.pathResolver.resolve('@data')
    if (!existsSync(dataRoot)) return
    this.removeStoresRecursively(dataRoot, true)
  }

  /** 关闭并删除所有旧维度Store，切换后由调用方从SQLite重建索引。 */
  resetAllForDimension(dimension: number): void {
    if (!Number.isInteger(dimension) || dimension <= 0) throw new Error('Embedding维度必须为正整数')
    for (const store of this.stores.values()) store.close()
    this.stores.clear()
    this.textIndexDirty.clear()
    const dataRoot = this.pathResolver.resolve('@data')
    if (existsSync(dataRoot)) this.removeStoresRecursively(dataRoot, false)
    this.dim = dimension
    logger.info(`向量Store维度已切换: ${dimension}`)
  }

  /** 安全关闭所有 Store，先落盘再释放文件锁。 */
  closeAll(): void {
    for (const [tdbPath, store] of this.stores) {
      try {
        store.close()
        logger.debug(`Store 已关闭: ${tdbPath}`)
      } catch (err) {
        logger.warn(`Store 关闭失败: ${tdbPath}`, { error: err })
      }
    }
    this.stores.clear()
    this.textIndexDirty.clear()
  }

  /** Store旁保存维度元数据，用于升级时识别旧索引。 */
  private dimensionPath(tdbPath: string): string {
    return `${tdbPath}.dimension`
  }

  private removeStoresRecursively(directory: string, legacyOnly: boolean): void {
    for (const entry of _require('node:fs').readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        this.removeStoresRecursively(target, legacyOnly)
        continue
      }
      const filePattern = legacyOnly
        ? /(?:^|[\\/])(main|diary)\.tdb(?:\.(?:vec|wal|lock|flush_ok|quiver|quiver\.meta|text|text\.meta|dimension))?$/
        : /(?:^|[\\/])(memory|social|facts)\.tdb(?:\.(?:vec|wal|lock|flush_ok|quiver|quiver\.meta|text|text\.meta|dimension))?$/
      if (filePattern.test(target)) rmSync(target, { force: true })
    }
  }

  /** 获取指定 Agent Store 的文件路径 */
  resolveAgentStorePath(agentId: string, mode: StoreMode): string {
    const fileName = mode === 'main' ? 'memory.tdb' : 'social.tdb'
    return this.pathResolver.resolve(`@data/agent_${agentId}/${fileName}`)
  }

  /** 安全关闭所有 Store，强制落盘 */
  flushAll(): void {
    for (const [tdbPath, store] of this.stores) {
      try {
        store.flush()
        logger.debug(`Store 已落盘: ${tdbPath}`)
      } catch (err) {
        logger.warn(`Store 落盘失败: ${tdbPath}`, { error: err })
      }
    }
  }

  /**
   * 重编译所有 Store 的 BM25 文本索引
   *
   * TriviumDB 的 indexText() 是增量追加，必须调 buildTextIndex() 才能生效。
   * 应由 KernelScheduler 周期计划定期触发。
   */
  rebuildAllTextIndexes(): void {
    for (const [tdbPath, store] of this.stores) {
      try {
        store.buildTextIndex()
        this.textIndexDirty.set(tdbPath, false)
        logger.debug(`文本索引已重编译: ${tdbPath}`)
      } catch (err) {
        logger.warn(`文本索引重编译失败: ${tdbPath}`, { error: err })
      }
    }
  }

  /**
   * 标记某 Store 的文本索引为脏（indexText 后调用）
   *
   * AIOS 第八阶段：修复主 Agent BM25 索引从未编译的 bug。
   * indexText() 是增量追加，不会自动触发 buildTextIndex()。
   * 此方法仅设置脏标记，实际编译延迟到 ensureTextIndexReady() 时执行。
   */
  markTextIndexDirty(tdbPath: string): void {
    this.textIndexDirty.set(tdbPath, true)
  }

  /**
   * 确保文本索引已编译（searchHybrid 前调用）
   *
   * 如果脏标记为 true，先执行 buildTextIndex() 再返回 Store。
   * 这样保证 searchHybrid 的 BM25 路总是能拿到最新索引，
   * 同时避免每次写入都全量重编译的性能开销。
   */
  ensureTextIndexReady(agentId: string, source: string): TriviumDBType {
    // 复用 getStoreBySource 的路由逻辑拿到 tdbPath
    const tdbPath = this.resolveStorePathBySource(agentId, source)
    const store = this.getOrCreate(tdbPath)

    if (this.textIndexDirty.get(tdbPath)) {
      try {
        store.buildTextIndex()
        this.textIndexDirty.set(tdbPath, false)
        logger.debug(`文本索引懒编译完成: ${tdbPath}`)
      } catch (err) {
        logger.warn(`文本索引懒编译失败: ${tdbPath}`, { error: err })
      }
    }
    return store
  }

  /**
   * 根据来源解析 Store 文件路径（仅供内部脏标记机制使用）
   */
  private resolveStorePathBySource(agentId: string, source: string): string {
    switch (source) {
      case 'social':
        return this.resolveAgentStorePath(agentId, 'social')
      default:
        return this.resolveAgentStorePath(agentId, 'main')
    }
  }

  /**
   * 获取所有 Store 的运行时统计 (admin 监控用)
   *
   * 利用 TriviumDB 的 estimatedMemory() 和 nodeCount() API。
   */
  getStoreStats(): Array<{ path: string; nodeCount: number; memoryMB: number }> {
    const stats: Array<{ path: string; nodeCount: number; memoryMB: number }> = []
    for (const [tdbPath, store] of this.stores) {
      try {
        stats.push({
          path: tdbPath,
          nodeCount: store.nodeCount(),
          memoryMB: Math.round((store.estimatedMemory() / 1024 / 1024) * 100) / 100,
        })
      } catch {
        stats.push({ path: tdbPath, nodeCount: -1, memoryMB: -1 })
      }
    }
    return stats
  }

  /** 统计现有物理 Store 的节点总数，不为缺失的 Store 创建空文件。 */
  countExistingNodes(agentIds: string[]): number {
    const paths = new Set<string>([this.resolveSharedStorePath('facts')])
    for (const agentId of agentIds) {
      paths.add(this.resolveAgentStorePath(agentId, 'main'))
      paths.add(this.resolveAgentStorePath(agentId, 'social'))
    }

    let total = 0
    for (const tdbPath of paths) {
      const openedStore = this.stores.get(tdbPath)
      if (!openedStore && !existsSync(tdbPath)) continue
      try {
        total += (openedStore ?? this.getOrCreate(tdbPath)).nodeCount()
      } catch (error) {
        logger.warn(`Store 节点统计失败: ${tdbPath}`, { error })
      }
    }
    return total
  }

  /** 清空指定 Agent 的物理 Store；关闭缓存实例后删除文件，下次访问会创建空库。 */
  resetAgentStore(agentId: string, mode: StoreMode): void {
    const tdbPath = this.resolveAgentStorePath(agentId, mode)
    const store = this.stores.get(tdbPath)
    if (store) {
      store.close()
      this.stores.delete(tdbPath)
    }
    this.textIndexDirty.delete(tdbPath)
    for (const suffix of [
      '',
      '.vec',
      '.wal',
      '.lock',
      '.flush_ok',
      '.quiver',
      '.quiver.meta',
      '.text',
      '.text.meta',
      '.dimension',
    ]) {
      rmSync(`${tdbPath}${suffix}`, { force: true })
    }
    logger.info(`Agent Store 已清空: agent=${agentId}, mode=${mode}`)
  }

  /** 清空共享 Store；下次访问时创建空库。 */
  resetSharedStore(kind: SharedStoreKind): void {
    const tdbPath = this.resolveSharedStorePath(kind)
    const store = this.stores.get(tdbPath)
    if (store) {
      store.close()
      this.stores.delete(tdbPath)
    }
    this.textIndexDirty.delete(tdbPath)
    for (const suffix of [
      '',
      '.vec',
      '.wal',
      '.lock',
      '.flush_ok',
      '.quiver',
      '.quiver.meta',
      '.text',
      '.text.meta',
      '.dimension',
    ]) {
      rmSync(`${tdbPath}${suffix}`, { force: true })
    }
    logger.info(`共享 Store 已清空: kind=${kind}`)
  }

  /** 获取或创建 TriviumDB 实例 */
  private getOrCreate(tdbPath: string): TriviumDBType {
    let store = this.stores.get(tdbPath)
    if (store) return store

    // 确保目录存在
    const dir = path.dirname(tdbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const dimensionPath = this.dimensionPath(tdbPath)
    if (existsSync(tdbPath) && existsSync(dimensionPath)) {
      const storedDimension = Number(readFileSync(dimensionPath, 'utf8'))
      if (storedDimension !== this.dim) {
        throw new Error(`向量Store维度不匹配: store=${storedDimension}, config=${this.dim}`)
      }
    }
    logger.info(`打开 TriviumDB Store: ${tdbPath}`)
    store = new TriviumDB(tdbPath, {
      dim: this.dim,
      dtype: 'f32',
      syncMode: 'normal',
      storageMode: 'mmap',
      autoBuildQuiver: true,
      memoryLimitMb: 512,
      accessMode: 'readWrite',
      missingIndexPolicy: 'fallback',
    })
    writeFileSync(dimensionPath, String(this.dim), 'utf8')

    // 定时压缩仍由引擎托管；内存预算已在打开前传入，避免初始化峰值越界。
    store.enableAutoCompaction(300) // 每 5 分钟自动压缩落盘
    this.stores.set(tdbPath, store)
    return store
  }
}
