import { describe, expect, it } from 'vitest'
import { MemoryGate } from '@perocore/backend/services/memory/memoryGate'
import type { MemoryCandidate, CanonicalMemory } from '@perocore/backend/services/memory/memoryProvider'

/** 构造 MemoryCandidate 测试桩 */
function makeCandidate(summary: string, overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    id: 'cand-1',
    agentId: 'pero',
    source: 'thread',
    originThreadId: 'thread-1',
    originMessageIds: ['1', '2'],
    summary,
    evidenceRefs: [],
    importance: 0.5,
    confidence: 0.5,
    suggestedType: 'event',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/** 构造 CanonicalMemory 测试桩 */
function makeExisting(id: string, content: string, status: CanonicalMemory['status'] = 'active'): CanonicalMemory {
  return {
    id,
    agentId: 'pero',
    type: 'event',
    content,
    summary: '',
    importance: 0.5,
    confidence: 0.5,
    status,
    provenance: {
      originThreadId: 'thread-old',
      originMessageIds: [],
      originChannel: 'desktop',
      createdFrom: 'scorer',
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('MemoryGate', () => {
  it('应当接受无重复的新候选', () => {
    const gate = new MemoryGate()
    const candidate = makeCandidate('主人今天学会了做螺蛳粉')
    const existing = [makeExisting('m1', '主人喜欢猫')]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('accept')
    expect(result.reason).toContain('新记忆')
  })

  it('应当在候选摘要为空时返回 skip', () => {
    const gate = new MemoryGate()
    const candidate = makeCandidate('   ')
    const existing = [makeExisting('m1', '主人喜欢猫')]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('skip')
    expect(result.reason).toContain('空')
  })

  it('应当拒绝被已有记忆包含的候选（短文本包含关系）', () => {
    const gate = new MemoryGate()
    // 已有记忆内容完全包含候选摘要
    const candidate = makeCandidate('主人喜欢猫')
    const existing = [makeExisting('m1', '今天发现主人喜欢猫，还养了两只')]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('reject')
    expect(result.reason).toContain('m1')
    expect(result.reason).toContain('包含')
  })

  it('应当拒绝包含已有记忆的候选（候选更宽泛）', () => {
    const gate = new MemoryGate()
    // 候选摘要完全包含已有记忆内容
    const candidate = makeCandidate('主人喜欢猫，还养了两只')
    const existing = [makeExisting('m1', '主人喜欢猫')]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('reject')
    expect(result.reason).toContain('包含')
  })

  it('应当拒绝与已有记忆高度相似的候选（Jaccard 相似度）', () => {
    const gate = new MemoryGate()
    // 字符集相同但顺序不同：contains 不触发，Jaccard=1.0 触发
    const candidate = makeCandidate('主人喜欢猫狗')
    const existing = [makeExisting('m1', '喜欢猫狗主人')]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('reject')
    expect(result.reason).toContain('相似')
  })

  it('应当忽略非 active 状态的已有记忆', () => {
    const gate = new MemoryGate()
    const candidate = makeCandidate('主人喜欢猫')
    // 已有记忆内容与候选完全相同，但状态为 archived
    const existing = [makeExisting('m1', '主人喜欢猫', 'archived')]

    const result = gate.review(candidate, existing)

    // archived 不参与去重，应接受
    expect(result.decision).toBe('accept')
  })

  it('应当接受与已有记忆内容差异较大的候选', () => {
    const gate = new MemoryGate()
    const candidate = makeCandidate('主人今天去了北京旅游')
    const existing = [
      makeExisting('m1', '主人喜欢猫'),
      makeExisting('m2', '主人的工作是程序员'),
    ]

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('accept')
  })

  it('应当在无已有记忆时接受候选', () => {
    const gate = new MemoryGate()
    const candidate = makeCandidate('第一条记忆')
    const existing: CanonicalMemory[] = []

    const result = gate.review(candidate, existing)

    expect(result.decision).toBe('accept')
  })
})
