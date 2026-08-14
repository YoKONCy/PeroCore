/**
 * 记忆 Store 注册表 — 三层隔离架构
 *
 * 管理 TriviumDB 实例的物理隔离。
 * 每个 Agent 拥有独立的 main.tdb / social.tdb，
 * 共享日记 Store 已废弃，日记改为按 Agent 隔离。
 *
 * 文件结构:
 * ```
 * data/
 * ├── agent_pero/
 * │   ├── main.tdb          ← 主模式事件记忆
 * │   ├── social.tdb        ← 社交模式事件记忆
 * │   ├── diary.tdb         ← Agent 专属日记（AIOS Phase5 隔离）
 * │   ├── rnn_main.bin      ← ContextRNN 隐状态
 * │   └── rnn_social.bin
 * ├── agent_neko/
 * │   ├── main.tdb
 * │   └── diary.tdb
 * ```
 * （shared/diary.tdb 已废弃，保留向后兼容但不再使用）
 *
 * @module packages/backend/src/repositories/storeRegistry
 */

import path from 'node:path'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
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

  /**
   * Agent 专属日记 Store（按 Agent 隔离）
   *
   * AIOS(Phase5): 日记从 shared/diary.tdb 改为 agent_{agentId}/diary.tdb，
   * 避免不同 Agent 的日记互相污染。
   *
   * @returns data/agent_{agentId}/diary.tdb
   */
  getDiaryStore(agentId: string): TriviumDBType {
    const tdbPath = this.pathResolver.resolve(`@data/agent_${agentId}/diary.tdb`)
    return this.getOrCreate(tdbPath)
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

  /** 获取指定 Agent Store 的文件路径 */
  resolveAgentStorePath(agentId: string, mode: StoreMode): string {
    return this.pathResolver.resolve(`@data/agent_${agentId}/${mode}.tdb`)
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
   * 应由 BackgroundScheduler 定期触发。
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

  /** 清空指定 Agent 的物理 Store；关闭缓存实例后删除文件，下次访问会创建空库。 */
  resetAgentStore(agentId: string, mode: StoreMode): void {
    const tdbPath = this.resolveAgentStorePath(agentId, mode)
    const store = this.stores.get(tdbPath)
    if (store) {
      store.close()
      this.stores.delete(tdbPath)
    }
    this.textIndexDirty.delete(tdbPath)
    rmSync(tdbPath, { force: true })
    rmSync(`${tdbPath}-wal`, { force: true })
    rmSync(`${tdbPath}-shm`, { force: true })
    logger.info(`Agent Store 已清空: agent=${agentId}, mode=${mode}`)
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

    logger.info(`打开 TriviumDB Store: ${tdbPath}`)
    store = new TriviumDB(tdbPath, this.dim, 'f32', 'normal')

    // 性能与安全配置 (TriviumDB 最佳实践)
    store.enableAutoCompaction(300) // 每 5 分钟自动压缩落盘
    store.setMemoryLimit(512) // 内存上限 512MB，防止 OOM
    this.stores.set(tdbPath, store)
    return store
  }
}
