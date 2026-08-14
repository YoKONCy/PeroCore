/**
 * CapabilityRegistry — 节点能力注册表服务
 *
 * 封装 NodeCapabilityRepository 的业务逻辑，提供：
 * - 节点注册/注销/心跳
 * - 能力查询：给定工具名，找到能提供此能力的在线节点
 * - 离线检测：标记超时节点为 offline
 *
 * CapabilityBridge（任务3）通过此服务路由工具调用：
 *   Agent 调 screen_capture → registry.findProvider('screen_capture') → 返回 nodeId
 *   → Bridge 向该节点转发 tool_call
 *
 * @module packages/backend/src/capabilities/capabilityRegistry
 */

import type { NodeCapabilityRepository } from '../repositories/nodeCapability.repo'
import type { NodeCapabilityRegistration, NodeType } from '../repositories/nodeCapability.repo'
import { createLogger } from '../lib/logger'

const logger = createLogger('CapabilityRegistry')

/**
 * 心跳超时阈值（秒）
 *
 * 节点超过此时间未心跳则标记为离线。
 * 默认 60 秒，Electron 等节点应每 30 秒心跳一次。
 */
const HEARTBEAT_TIMEOUT_SECONDS = 60

export class CapabilityRegistry {
  constructor(private repo: NodeCapabilityRepository) {}

  /** 注册或更新节点能力 */
  async register(
    nodeId: string,
    nodeType: NodeType,
    capabilities: string[],
    url?: string | null,
  ): Promise<NodeCapabilityRegistration> {
    const reg = await this.repo.upsert({ nodeId, nodeType, capabilities, url })
    logger.info(`节点 ${nodeId} (${nodeType}) 已注册，能力: [${capabilities.join(', ')}]`)
    return reg
  }

  /**
   * 注销节点（第七阶段修复 E5：改为标记 offline 而非物理删除）
   *
   * 原实现调用 repo.delete(nodeId) 物理删除节点记录，导致：
   * - 重连后 nodeId 重新生成，丢失历史能力配置
   * - 与 markStaleOffline（心跳超时只标记 offline）语义不一致
   *
   * 现在统一为 markOffline：
   * - 节点断连后状态变为 offline，但记录保留
   * - 重连时 upsert 会恢复 online，nodeId 保持不变
   * - 物理删除仅在显式清理（如管理 API）时使用
   */
  async unregister(nodeId: string): Promise<void> {
    await this.repo.markOffline(nodeId)
    logger.info(`节点 ${nodeId} 已标记离线（断连）`)
  }

  /** 更新心跳 */
  async heartbeat(nodeId: string): Promise<void> {
    await this.repo.heartbeat(nodeId)
  }

  /**
   * 查找能提供指定能力的在线节点
   *
   * 第一版策略：返回首个匹配的在线节点。
   * 后续可扩展为按延迟/负载选择（见 10-node-architecture.md §9.2）。
   *
   * @returns 节点注册信息，无可用节点时返回 undefined
   */
  async findProvider(capability: string): Promise<NodeCapabilityRegistration | undefined> {
    const nodes = await this.repo.findByCapability(capability)
    return nodes[0]
  }

  /** 查询所有在线节点及其能力 */
  async listOnline(): Promise<NodeCapabilityRegistration[]> {
    return this.repo.findOnline()
  }

  /**
   * 清理超时节点
   *
   * 标记心跳超过 HEARTBEAT_TIMEOUT_SECONDS 秒的节点为 offline。
   * 由 CapabilityBridge 定时调用（如每 30 秒一次）。
   */
  async cleanupStaleNodes(): Promise<number> {
    const count = await this.repo.markStaleOffline(HEARTBEAT_TIMEOUT_SECONDS)
    if (count > 0) {
      logger.warn(`${count} 个节点因心跳超时被标记为离线`)
    }
    return count
  }

  /**
   * 检查某能力是否可用
   *
   * ToolExecutor 在执行平台工具前可调用此方法快速判断。
   */
  async isCapabilityAvailable(capability: string): Promise<boolean> {
    const provider = await this.findProvider(capability)
    return provider !== undefined
  }
}
