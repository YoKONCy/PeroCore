/**
 * Group Chat Dispatcher — 群聊接话调度器
 *
 * 决定哪个 Agent 在群聊中接话。
 *
 * 采用两层策略:
 *
 * Layer 1: 规则预筛 (零 LLM 开销)
 *   - 被 @mention 的 Agent → 必定回复
 *   - @全体成员 (@all) → 返回哨兵 agentId='@all'，由路由层展开为随机顺序串行回复
 *   - 连续 3+ 条 Agent 发言 → 冷却期
 *   - 用户短回复 ("嗯", "好") → 降低触发概率
 *
 * Layer 2: 可选轻量判定
 *   - 基于 Agent 性格的积极度权重 (配置驱动)
 *   - 随机概率 (30% 其他 Agent 接话)
 *
 * 调度结果:
 *   - 返回 agent_id → 由调用方执行 AgentService.chat()
 *   - 返回 '@all' → 由调用方按随机顺序执行所有在场 Agent
 *   - 返回 null → 无人接话
 *
 * @module packages/backend/src/services/stronghold/groupChatDispatcher
 */

import type { GroupChatService } from './groupChatService'

// ── 类型 ──

type MessageRow = {
  senderId: string
  content: string
  role: string
  mentionsJson: string | null
}

/** 调度结果 */
export interface DispatchResult {
  /** 下一个发言的 Agent ID (null = 无人接话；'@all' = 全体成员依次回复) */
  agentId: string | null
  /** 调度理由 */
  reason: string
}

// ── Dispatcher ──

export class GroupChatDispatcher {
  constructor(private chatService: GroupChatService) {}

  /**
   * 决定下一个发言的 Agent
   *
   * @param roomId 群聊房间 ID
   * @param history 最近的聊天记录
   */
  async decideNextTurn(roomId: string, history: MessageRow[]): Promise<DispatchResult> {
    if (history.length === 0) {
      return { agentId: null, reason: '没有消息历史' }
    }

    // 获取房间内的候选 Agent
    const candidates = await this.chatService.getCandidateAgents(roomId)
    if (candidates.length === 0) {
      return { agentId: null, reason: '房间内没有可用 Agent' }
    }

    const lastMsg = history[history.length - 1]!

    // ─── Layer 1: 规则预筛 ───

    // 规则 A: 被 @mention → 必定回复
    const mentionResult = this.checkMentions(lastMsg, candidates)
    if (mentionResult) return mentionResult

    // 规则 B: 用户发言 → 只要房间内有候选 Agent，就必须有人回复。
    // 短消息（如“你好”“在吗”）同样是明确互动，不应随机静默。
    if (lastMsg.senderId === 'user') {
      return {
        agentId: this.pickRandom(candidates),
        reason: '用户发言，随机选择 Agent 回复',
      }
    }

    // 规则 C: Agent 连续发言冷却
    const streak = this.countAgentStreak(history, candidates)
    if (streak >= 3) {
      return { agentId: null, reason: `Agent 已连续发言 ${streak} 次，冷却中` }
    }

    // ─── Layer 2: 轻量判定 ───

    // 30% 概率让另一个 Agent 接话
    if (lastMsg.senderId && candidates.includes(lastMsg.senderId)) {
      if (Math.random() < 0.3) {
        const others = candidates.filter((a) => a !== lastMsg.senderId)
        if (others.length > 0) {
          return {
            agentId: this.pickRandom(others),
            reason: '30% 概率触发其他 Agent 接话',
          }
        }
      }
    }

    // 系统消息后不触发
    if (lastMsg.role === 'system') {
      return { agentId: null, reason: '系统消息后不自动触发' }
    }

    return { agentId: null, reason: '未满足触发条件' }
  }

  // ── 内部方法 ──

  /** 检查 @mention */
  private checkMentions(msg: MessageRow, candidates: string[]): DispatchResult | null {
    try {
      const mentions: string[] = msg.mentionsJson ? JSON.parse(msg.mentionsJson) : []

      // @全体成员：召唤房间内所有候选 Agent（agentId 使用哨兵值 '@all'，由路由层展开执行）
      if (mentions.includes('@all') && candidates.length > 0) {
        return { agentId: '@all', reason: '被 @mention: 全体成员' }
      }

      const validMentions = mentions.filter((m) => candidates.includes(m))
      if (validMentions.length > 0) {
        return {
          agentId: validMentions[0] ?? null,
          reason: `被 @mention: ${validMentions[0] ?? ''}`,
        }
      }
    } catch {
      // mentions 解析失败静默处理
    }
    return null
  }

  /** 计算 Agent 连续发言次数 */
  private countAgentStreak(history: MessageRow[], candidates: string[]): number {
    let streak = 0
    for (let i = history.length - 1; i >= 0; i--) {
      if (candidates.includes(history[i]!.senderId)) {
        streak++
      } else {
        break
      }
    }
    return streak
  }

  /** 随机选择 */
  private pickRandom(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)]!
  }
}
