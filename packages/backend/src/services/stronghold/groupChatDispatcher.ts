/**
 * Group Chat Dispatcher — 群聊接话调度器
 *
 * 决定哪个 Agent 在群聊中接话。
 *
 * 采用两层策略:
 *
 * Layer 1: 规则预筛 (零 LLM 开销)
 *   - 被 @mention 的 Agent → 必定回复
 *   - 连续 3+ 条 Agent 发言 → 冷却期
 *   - 用户短回复 ("嗯", "好") → 降低触发概率
 *
 * Layer 2: 可选轻量判定
 *   - 基于 Agent 性格的积极度权重 (配置驱动)
 *   - 随机概率 (30% 其他 Agent 接话)
 *
 * 调度结果:
 *   - 返回 agent_id → 由调用方执行 AgentService.chat()
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
  /** 下一个发言的 Agent ID (null = 无人接话) */
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

    // 规则 B: 用户发言 → 必须有人回复
    if (lastMsg.senderId === 'user') {
      // 短回复降低概率
      if (this.isShortReply(lastMsg.content)) {
        if (Math.random() < 0.5) {
          return { agentId: null, reason: '用户短回复，50% 概率跳过' }
        }
      }
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

  /** 判断是否为短回复 */
  private isShortReply(content: string): boolean {
    const trimmed = content.trim()
    if (trimmed.length <= 3) return true

    const shortReplies = ['嗯', '好', '哦', '好的', '嗯嗯', 'ok', 'OK', '行', '了解', '知道了']
    return shortReplies.includes(trimmed)
  }

  /** 随机选择 */
  private pickRandom(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)]!
  }
}
