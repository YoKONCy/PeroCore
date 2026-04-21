/**
 * 记忆 Store 注册表 — 三层隔离架构
 *
 * 管理 TriviumDB 实例的物理隔离。
 * 每个 Agent 拥有独立的 main.tdb / social.tdb，
 * 共享日记 Store (shared/diary.tdb) 所有 Agent 可读写。
 *
 * 文件结构:
 * ```
 * data/
 * ├── agent_pero/
 * │   ├── main.tdb          ← 主模式事件记忆
 * │   ├── social.tdb        ← 社交模式事件记忆
 * │   ├── rnn_main.bin      ← ContextRNN 隐状态
 * │   └── rnn_social.bin
 * ├── agent_neko/
 * │   └── main.tdb
 * └── shared/
 *     └── diary.tdb         ← 共享日记
 * ```
 *
 * @module packages/backend/src/repositories/storeRegistry
 */

import path from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
const _require = createRequire(import.meta.url)
// triviumdb 是 NAPI CJS 模块 (module.exports = nativeBinding)，ESM 只能通过 require 加载
import type { TriviumDB as TriviumDBType } from 'triviumdb'
const TriviumDB = _require('triviumdb') as typeof TriviumDBType & (new (...args: unknown[]) => TriviumDBType)
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
   * 共享日记 Store (所有 Agent 可读写)
   *
   * @returns data/shared/diary.tdb
   */
  getDiaryStore(): TriviumDBType {
    const tdbPath = this.pathResolver.resolve('@data/shared/diary.tdb')
    return this.getOrCreate(tdbPath)
  }

  /**
   * 根据来源自动选择 Store
   *
   * @param agentId Agent ID
   * @param source  记忆来源 (MemorySource)
   */
  getStoreBySource(agentId: string, source: string): TriviumDBType {
    switch (source) {
      case 'social':
      case 'group_chat':
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
        logger.debug(`文本索引已重编译: ${tdbPath}`)
      } catch (err) {
        logger.warn(`文本索引重编译失败: ${tdbPath}`, { error: err })
      }
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
