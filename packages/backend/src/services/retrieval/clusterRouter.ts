/**
 * ClusterRouter — 记忆社区路由
 *
 * 管理记忆图谱的社区聚类 (Leiden/Louvain) 并提供基于
 * ContextRNN 隐状态的 cluster 路由能力。
 *
 * 当前聚类由 TriviumDB 原生 Leiden 能力执行，本模块负责把原生返回的平铺结构
 * 转换为 TypeScript 侧可缓存、可路由的社区索引。
 * 新记忆的增量归属暂未实现，仍需依赖周期性 rebuildClusters() 刷新缓存。
 *
 * @module packages/backend/src/services/retrieval/clusterRouter
 */

import type { VectorRepository } from '../../repositories/vector.repo'
import type { MemoryRepository } from '../../repositories/memory.repo'
import type { MemoryStoreRegistry } from '../../repositories/storeRegistry'
import type { ContextRnn } from './contextRnn'
import { createLogger } from '../../lib/logger'

const logger = createLogger('ClusterRouter')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 活跃簇信息 */
export interface ActiveCluster {
  /** 簇 ID */
  clusterId: number
  /** 簇标签 (如 "料理体验") */
  label: string
  /** ContextRNN 亲和度 (0~1) */
  affinity: number
}

/** 簇信息 (缓存) */
interface ClusterInfo {
  /** 簇内节点 ID 集合 */
  memberIds: Set<number>
  /** 簇 centroid (embedding 均值) */
  centroid: Float32Array
  /** 簇标签 */
  label: string
}

/** ClusterRouter 配置 */
export interface ClusterRouterConfig {
  /** 路由时取 top-N 活跃簇 (默认 3) */
  topActiveClusters: number
  /** 聚类最小社区大小 (默认 3) */
  minCommunitySize: number
  /** 无聚类结果时的 fallback 策略 */
  fallbackToFullSearch: boolean
}

const DEFAULT_CONFIG: ClusterRouterConfig = {
  topActiveClusters: 3,
  minCommunitySize: 3,
  fallbackToFullSearch: true,
}

/** ClusterRouter 依赖 */
interface ClusterRouterDeps {
  vectorRepo: VectorRepository
  memoryRepo: MemoryRepository
  storeRegistry: MemoryStoreRegistry
  contextRnn: ContextRnn
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class ClusterRouter {
  private deps: ClusterRouterDeps
  private config: ClusterRouterConfig

  /** 每个 Agent 的聚类缓存 (agentId → clusters) */
  private clusterCache = new Map<string, Map<number, ClusterInfo>>()

  /** 节点 → 簇 ID 映射缓存 (agentId → nodeToCluster) */
  private nodeMappingCache = new Map<string, Map<number, number>>()

  /** 上次聚类时间 */
  private lastClusteringAt = new Map<string, number>()

  constructor(deps: ClusterRouterDeps, config?: Partial<ClusterRouterConfig>) {
    this.deps = deps
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async rebuildClusters(agentId: string, source: string = 'desktop'): Promise<number> {
    logger.info(`开始记忆社区聚类 (Agent: ${agentId})`)

    // 通过 storeRegistry 获取对应 source 的 TriviumDB 实例；不同来源可落在不同向量存储中。
    const store = this.deps.storeRegistry.getStoreBySource(agentId, source)
    if (!store) {
      logger.warn(`找不到对应的 store: ${agentId}/${source}，停止聚类`)
      return 0
    }

    // TriviumDB 返回的是跨语言传输友好的平铺数组，下面会解包为 Map/Set 结构供路由阶段快速读取。
    const result = store.leidenCluster({
      minCommunitySize: this.config.minCommunitySize,
    })

    const clusters = new Map<number, ClusterInfo>()
    const nodeMapping = new Map<number, number>()

    const { nodeToCluster, clusterLabels, centroids } = result

    // 1. 构建 nodeMapping (平铺: [nodeId1, clusterId1, nodeId2, clusterId2...])
    for (let i = 0; i < nodeToCluster.length; i += 2) {
      const nodeId = nodeToCluster[i]!
      const clusterId = nodeToCluster[i + 1]!
      nodeMapping.set(nodeId, clusterId)
    }

    // 2. 构建 clusters (平铺: [clusterIdStr, label, ...])
    for (let i = 0; i < clusterLabels.length; i += 2) {
      const clusterIdStr = clusterLabels[i]!
      const label = clusterLabels[i + 1]!
      const clusterId = parseInt(clusterIdStr, 10)
      if (!isNaN(clusterId)) {
        clusters.set(clusterId, {
          memberIds: new Set(),
          centroid: new Float32Array(),
          label,
        })
      }
    }

    // 3. 填充 memberIds
    for (const [nodeId, clusterId] of nodeMapping) {
      const info = clusters.get(clusterId)
      if (info) {
        info.memberIds.add(nodeId)
      }
    }

    // 4. 解包质心 (平铺: [clusterId1, v0..v_dim, clusterId2, v0..v_dim, ...])
    const numClusters = clusters.size
    if (numClusters > 0 && centroids.length > 0) {
      const stride = centroids.length / numClusters
      for (let i = 0; i < centroids.length; i += stride) {
        const clusterId = centroids[i]!
        const vec = centroids.slice(i + 1, i + stride)
        const info = clusters.get(clusterId)
        if (info) {
          info.centroid = new Float32Array(vec)
        }
      }
    }

    this.clusterCache.set(agentId, clusters)
    this.nodeMappingCache.set(agentId, nodeMapping)
    this.lastClusteringAt.set(agentId, Date.now())

    logger.info(`社区聚类完成: ${clusters.size} 个社区 (Agent: ${agentId})`)
    return clusters.size
  }

  /**
   * 基于 ContextRNN 隐状态路由到 top-N 活跃簇
   *
   * @returns 按亲和度降序排列的活跃簇 (空聚类时返回空数组)
   */
  routeByContext(agentId: string, mode: string): ActiveCluster[] {
    const clusters = this.clusterCache.get(agentId)

    // 无聚类 → 返回空 (调用方应 fallback 到全库检索)
    if (!clusters || clusters.size === 0) {
      return []
    }

    // 构建 centroid Map 给 ContextRNN
    const centroids = new Map<number, Float32Array>()
    for (const [clusterId, info] of clusters) {
      centroids.set(clusterId, info.centroid)
    }

    // 计算 h_t 与各 centroid 的亲和度
    const affinities = this.deps.contextRnn.computeClusterAffinities(agentId, mode, centroids)

    // 排序取 top-N
    const sorted: ActiveCluster[] = []
    for (const [clusterId, affinity] of affinities) {
      const info = clusters.get(clusterId)
      if (info) {
        sorted.push({ clusterId, label: info.label, affinity })
      }
    }
    sorted.sort((a, b) => b.affinity - a.affinity)

    return sorted.slice(0, this.config.topActiveClusters)
  }

  /**
   * 获取指定簇的成员节点 ID 集合
   */
  getClusterMembers(agentId: string, clusterId: number): Set<number> {
    const clusters = this.clusterCache.get(agentId)
    return clusters?.get(clusterId)?.memberIds ?? new Set()
  }

  /**
   * 获取所有簇的标签列表 (用于 Scorer 提示词注入)
   *
   * @returns 如 ["料理体验", "工作讨论", "感情互动"]
   */
  getClusterLabels(agentId: string): string[] {
    const clusters = this.clusterCache.get(agentId)
    if (!clusters) return []
    return Array.from(clusters.values()).map((c) => c.label)
  }

  /**
   * 获取节点所属的簇 ID
   */
  getNodeCluster(agentId: string, nodeId: number): number | undefined {
    return this.nodeMappingCache.get(agentId)?.get(nodeId)
  }

  /**
   * 更新单个节点的簇归属 (用于新记忆创建时)
   *
   * 当前只保留接口形状，不直接写入缓存。
   * 原因是单点插入会让 centroid、memberIds、nodeMapping 三份缓存产生一致性风险；
   * 在 TriviumDB 提供可靠的增量社区更新前，统一通过 rebuildClusters() 重建。
   */
  assignNodeToCluster(_agentId: string, _nodeId: number, _clusterId: number): void {
    // 增量聚类未接入，保持 no-op，避免写入半更新缓存。
  }

  /**
   * 判断是否有有效的聚类数据
   */
  hasClusters(agentId: string): boolean {
    const clusters = this.clusterCache.get(agentId)
    return !!clusters && clusters.size > 0
  }

  /**
   * 是否应 fallback 到全库检索
   */
  shouldFallbackToFullSearch(agentId: string): boolean {
    if (!this.config.fallbackToFullSearch) return false
    return !this.hasClusters(agentId)
  }

  /**
   * 获取聚类统计
   */
  getStats(agentId: string): {
    clusterCount: number
    lastClusteringAt: number | undefined
    totalNodes: number
  } {
    const clusters = this.clusterCache.get(agentId)
    let totalNodes = 0
    if (clusters) {
      for (const info of clusters.values()) {
        totalNodes += info.memberIds.size
      }
    }
    return {
      clusterCount: clusters?.size ?? 0,
      lastClusteringAt: this.lastClusteringAt.get(agentId),
      totalNodes,
    }
  }
}
