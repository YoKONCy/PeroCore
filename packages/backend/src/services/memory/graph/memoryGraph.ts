/**
 * Memory Graph — 图谱可视化数据生成
 *
 * 从 TriviumDB 图谱中提取节点和边，转换为前端可视化所需的结构。
 *.get_memory_graph() 的功能。
 *
 * 前端使用 force-directed graph 或 D3.js 渲染。
 *
 * @module packages/backend/src/services/memory/graph/memoryGraph
 */

import type { MemoryRepository } from '../../../repositories/memory.repo'
import type { VectorRepository } from '../../../repositories/vector.repo'
import { createLogger } from '../../../lib/logger'

const logger = createLogger('MemoryGraph')

// ─────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────

/** 图谱节点 (前端渲染用) */
export interface GraphNode {
  /** 记忆 ID */
  id: number
  /** 记忆内容 (截断) */
  label: string
  /** 记忆类型 */
  type: string
  /** 重要性 (影响节点大小) */
  importance: number
  /** 情感 (影响节点颜色) */
  sentiment: string
  /** 标签列表 */
  tags: string[]
  /** 时间戳 */
  timestamp: number
  /** 来源 */
  source: string
  /** 访问次数 */
  accessCount: number
  /** 所属 cluster (如有) */
  cluster?: string
}

/** 图谱边 */
export interface GraphEdge {
  /** 源节点 ID */
  source: number
  /** 目标节点 ID */
  target: number
  /** 边类型 */
  label: string
  /** 边权重 (影响边粗细) */
  weight: number
}

/** 完整图谱数据 (前端渲染用) */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** 统计信息 */
  stats: GraphStats
}

/** 图谱统计 */
export interface GraphStats {
  totalNodes: number
  totalEdges: number
  /** 按类型分组的节点数 */
  nodesByType: Record<string, number>
  /** 按标签分组的边数 */
  edgesByLabel: Record<string, number>
  /** 最中心的节点 (边最多) */
  centralNodes: Array<{ id: number; label: string; degree: number }>
}

/** 图谱查询参数 */
export interface GraphQueryParams {
  agentId: string
  source?: string
  /** 最大节点数 */
  maxNodes?: number
  /** 中心节点 ID (如指定，只展示其 N 跳邻居) */
  centerId?: number
  /** 从中心节点展开的跳数 */
  depth?: number
  /** 过滤: 只展示指定类型的记忆 */
  types?: string[]
}

// ─────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────

export class MemoryGraphService {
  constructor(
    private memoryRepo: MemoryRepository,
    private vectorRepo: VectorRepository,
  ) {}

  /**
   * 获取图谱数据
   *
   * 两种模式:
   * 1. 全局模式: 获取最近 maxNodes 条记忆的图谱
   * 2. 中心模式: 从 centerId 出发，展开 depth 跳
   */
  async getGraph(params: GraphQueryParams): Promise<GraphData> {
    const { agentId, source = 'desktop', maxNodes = 100, centerId, depth = 2, types } = params

    let nodeIds: number[]

    if (centerId) {
      // 中心模式: 从 centerId 展开邻居
      nodeIds = await this.getNeighborIds(centerId, agentId, source, depth, maxNodes)
    } else {
      // 全局模式: 取最近的记忆
      const { data: memories } = await this.memoryRepo.list({
        agentId,
        page: 1,
        pageSize: maxNodes,
        type: types?.[0],
        source,
      })
      nodeIds = memories.map((m) => m.id)
    }

    if (nodeIds.length === 0) {
      return { nodes: [], edges: [], stats: this.emptyStats() }
    }

    // 获取记忆详情
    const memories = await this.memoryRepo.findByIds(nodeIds)
    const nodeSet = new Set(nodeIds)

    // 构建节点
    const nodes: GraphNode[] = memories
      .filter((m) => !types?.length || types.includes(m.type ?? 'event'))
      .map((m) => ({
        id: m.id,
        label: m.content.slice(0, 80) + (m.content.length > 80 ? '...' : ''),
        type: m.type ?? 'event',
        importance: m.importance ?? 1,
        sentiment: m.sentiment ?? 'neutral',
        tags: (m.tags ?? '').split(',').filter(Boolean),
        timestamp: m.timestamp,
        source: m.source ?? 'desktop',
        accessCount: m.accessCount ?? 0,
        cluster: m.clusters ?? undefined,
      }))

    // 构建边 (从时间链 + TriviumDB 邻居)
    const edges: GraphEdge[] = []

    // 时间链边 (prevId/nextId)
    for (const m of memories) {
      if (m.nextId && nodeSet.has(m.nextId)) {
        edges.push({ source: m.id, target: m.nextId, label: 'temporal', weight: 0.2 })
      }
    }

    // TriviumDB 图谱边 (通过邻居查询)
    for (const nodeId of nodeIds.slice(0, 50)) {
      try {
        const neighbors = await this.vectorRepo.neighbors(nodeId, agentId, source, 1)
        for (const neighborId of neighbors) {
          if (nodeSet.has(neighborId) && neighborId !== nodeId) {
            // 避免重复边
            const exists = edges.some(
              (e) =>
                (e.source === nodeId && e.target === neighborId) ||
                (e.source === neighborId && e.target === nodeId),
            )
            if (!exists) {
              edges.push({ source: nodeId, target: neighborId, label: 'graph', weight: 0.5 })
            }
          }
        }
      } catch {
        // 节点可能不在 TriviumDB 中
      }
    }

    // 统计
    const stats = this.computeStats(nodes, edges)

    logger.debug(`图谱生成: ${nodes.length} 节点, ${edges.length} 边 (Agent: ${agentId})`)
    return { nodes, edges, stats }
  }

  /** 标签云 TTL 缓存 */
  private tagCloudCache = new Map<
    string,
    { data: Array<{ tag: string; count: number }>; expiresAt: number }
  >()
  private static readonly TAG_CLOUD_TTL_MS = 5 * 60 * 1000 // 5 分钟

  /**
   * 获取 Tag Cloud 数据 (带 TTL 缓存)
   *
   * 使用内存缓存避免高频全表扫描，TTL = 5 分钟。
   * 记忆增删时应调用 invalidateTagCloudCache() 使缓存失效。
   */
  async getTagCloud(
    agentId: string,
    limit: number = 30,
  ): Promise<Array<{ tag: string; count: number }>> {
    const now = Date.now()

    // 命中缓存则直接返回
    const cached = this.tagCloudCache.get(agentId)
    if (cached && now < cached.expiresAt) {
      return cached.data.slice(0, limit)
    }

    const { data: memories } = await this.memoryRepo.list({
      agentId,
      page: 1,
      pageSize: 500,
    })

    const tagCounts = new Map<string, number>()
    for (const m of memories) {
      if (!m.tags) continue
      const tags = m.tags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }

    const result = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50) // 缓存 top-50，按需截取
      .map(([tag, count]) => ({ tag, count }))

    // 写入缓存
    this.tagCloudCache.set(agentId, {
      data: result,
      expiresAt: now + MemoryGraphService.TAG_CLOUD_TTL_MS,
    })

    return result.slice(0, limit)
  }

  /** 使标签云缓存失效 (记忆增删后调用) */
  invalidateTagCloudCache(agentId?: string): void {
    if (agentId) {
      this.tagCloudCache.delete(agentId)
    } else {
      this.tagCloudCache.clear()
    }
  }

  // ── 内部方法 ──

  /**
   * 从中心节点展开邻居
   */
  private async getNeighborIds(
    centerId: number,
    agentId: string,
    source: string,
    depth: number,
    maxNodes: number,
  ): Promise<number[]> {
    const visited = new Set<number>([centerId])
    let frontier = [centerId]

    for (let d = 0; d < depth && visited.size < maxNodes; d++) {
      const nextFrontier: number[] = []

      for (const nodeId of frontier) {
        // 从 TriviumDB 获取邻居
        try {
          const neighbors = await this.vectorRepo.neighbors(nodeId, agentId, source, 1)
          for (const nId of neighbors) {
            if (!visited.has(nId) && visited.size < maxNodes) {
              visited.add(nId)
              nextFrontier.push(nId)
            }
          }
        } catch {
          // 静默处理
        }

        // 从时间链获取邻居
        const memory = await this.memoryRepo.findById(nodeId)
        if (memory?.prevId && !visited.has(memory.prevId)) {
          visited.add(memory.prevId)
          nextFrontier.push(memory.prevId)
        }
        if (memory?.nextId && !visited.has(memory.nextId)) {
          visited.add(memory.nextId)
          nextFrontier.push(memory.nextId)
        }
      }

      frontier = nextFrontier
    }

    return [...visited]
  }

  /** 计算统计信息 */
  private computeStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
    // 节点按类型分组
    const nodesByType: Record<string, number> = {}
    for (const n of nodes) {
      nodesByType[n.type] = (nodesByType[n.type] ?? 0) + 1
    }

    // 边按标签分组
    const edgesByLabel: Record<string, number> = {}
    for (const e of edges) {
      edgesByLabel[e.label] = (edgesByLabel[e.label] ?? 0) + 1
    }

    // 计算度 (每个节点的边数)
    const degreeMap = new Map<number, number>()
    for (const e of edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1)
    }

    // 最中心的节点
    const centralNodes = [...degreeMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, degree]) => {
        const node = nodes.find((n) => n.id === id)
        return { id, label: node?.label ?? '', degree }
      })

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodesByType,
      edgesByLabel,
      centralNodes,
    }
  }

  /** 空统计 */
  private emptyStats(): GraphStats {
    return {
      totalNodes: 0,
      totalEdges: 0,
      nodesByType: {},
      edgesByLabel: {},
      centralNodes: [],
    }
  }
}
