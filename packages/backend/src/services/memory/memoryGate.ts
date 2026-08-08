/**
 * MemoryGate — 记忆候选审核门控
 *
 * 第五阶段简化版：基于内容去重 + 新增决策。
 * - 若候选内容与已有 CanonicalMemory 高度重复（包含或近似）→ reject
 * - 否则 → accept
 *
 * 未来可扩展为基于 LLM 的合并/取代决策（merge/supersede）。
 *
 * @module packages/backend/src/services/memory/memoryGate
 */

import type {
  MemoryCandidate,
  CanonicalMemory,
  GateResult,
} from './memoryProvider'
import { createLogger } from '../../lib/logger'

const logger = createLogger('MemoryGate')

// ─────────────────────────────────────────────
// 配置常量
// ─────────────────────────────────────────────

/** 内容包含/被包含阈值（字符数）：短于此长度不做包含判断（避免短串误判） */
const CONTAIN_MIN_LENGTH = 3

/** 归一化后内容相似度阈值（Jaccard），超过则判重 */
const SIMILARITY_THRESHOLD = 0.85

// ─────────────────────────────────────────────
// MemoryGate
// ─────────────────────────────────────────────

export class MemoryGate {
  /**
   * 审核单条候选
   *
   * @param candidate 待审核的候选
   * @param existingMemories 该 Agent 已有的 active CanonicalMemory 列表
   * @returns 审核决策结果
   */
  review(candidate: MemoryCandidate, existingMemories: CanonicalMemory[]): GateResult {
    const candidateText = this.normalize(candidate.summary)

    // 空内容直接 skip
    if (!candidateText) {
      return {
        decision: 'skip',
        reason: '候选摘要为空，无法审核',
      }
    }

    // 与已有记忆逐一比对
    for (const existing of existingMemories) {
      // 仅与 active 记忆比对
      if (existing.status !== 'active') continue

      const existingText = this.normalize(existing.content)
      if (!existingText) continue

      // 1. 包含关系：一方完全包含另一方（短文本场景）
      if (
        candidateText.length >= CONTAIN_MIN_LENGTH &&
        existingText.length >= CONTAIN_MIN_LENGTH &&
        (candidateText.includes(existingText) || existingText.includes(candidateText))
      ) {
        logger.debug(`候选被判定为重复（包含关系）: candidate="${candidateText.slice(0, 30)}..."`)
        return {
          decision: 'reject',
          reason: `与已有记忆 ${existing.id} 内容重复（包含关系）`,
        }
      }

      // 2. 词级 Jaccard 相似度
      const sim = this.jaccardSimilarity(candidateText, existingText)
      if (sim >= SIMILARITY_THRESHOLD) {
        logger.debug(
          `候选被判定为重复（相似度=${sim.toFixed(3)}）: candidate="${candidateText.slice(0, 30)}..."`,
        )
        return {
          decision: 'reject',
          reason: `与已有记忆 ${existing.id} 内容高度相似 (sim=${sim.toFixed(3)})`,
        }
      }
    }

    // 无重复 → 接受
    return {
      decision: 'accept',
      reason: '新记忆，无重复',
    }
  }

  // ── 内部方法 ──

  /** 文本归一化：去空白、转小写、去标点 */
  private normalize(text: string): string {
    if (!text) return ''
    return text
      .toLowerCase()
      .replace(/[\s\u3000，。！？、,.!?;:""'']/g, '')
      .trim()
  }

  /** 计算词级 Jaccard 相似度（中文按字符切分，英文按空格切分） */
  private jaccardSimilarity(a: string, b: string): number {
    const setA = this.tokenize(a)
    const setB = this.tokenize(b)
    if (setA.size === 0 || setB.size === 0) return 0

    let intersection = 0
    for (const token of setA) {
      if (setB.has(token)) intersection++
    }
    const union = setA.size + setB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  /** 分词：含 CJK 字符时按字符切，否则按空格切 */
  private tokenize(text: string): Set<string> {
    if (!text) return new Set()
    // 含 CJK 字符 → 按字符切（适合中文短文本）
    if (/[\u4e00-\u9fff]/.test(text)) {
      return new Set(text.split(''))
    }
    // 否则按空格切（英文/拉丁字符）
    return new Set(text.split(/\s+/).filter(Boolean))
  }
}
