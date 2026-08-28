import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@infos/backend/services/retrieval/minGru', () => ({
  HIDDEN_DIM: 4,
  // AIOS 第八阶段：minGRU 权重大小（HIDDEN_DIM=4）
  MIN_GRU_WEIGHT_SIZES: {
    W_Z: 16, // 4×4
    B_Z: 4,
    W_H: 16, // 4×4
    B_H: 4,
    TOTAL: 40,
  },
  projectInput: vi.fn(
    (input: Float32Array) => new Float32Array([input[0] ?? 0, input[1] ?? 0, 1, 2]),
  ),
  // AIOS 第八阶段：改用 minGruForwardWithWeights（忽略 weights 参数，保持测试行为一致）
  minGruForwardWithWeights: vi.fn(
    (hidden: Float32Array, projected: Float32Array, _weights: unknown) =>
      new Float32Array(projected.map((value, index) => value + (hidden[index] ?? 0))),
  ),
  xavierInitMinGruWeights: vi.fn((_hiddenDim?: number) => ({
    wZ: new Float32Array(16).fill(0.01),
    bZ: new Float32Array(4).fill(0.1),
    wH: new Float32Array(16).fill(0.01),
    bH: new Float32Array(4).fill(0.1),
  })),
  trainMinGruStep: vi.fn(() => 0.5),
}))

import { ContextRnn } from '@infos/backend/services/retrieval/contextRnn'
import { minGruForwardWithWeights, projectInput } from '@infos/backend/services/retrieval/minGru'
import type { PathResolver } from '@infos/backend/core/pathResolver'

function createResolver(root: string): PathResolver {
  return {
    resolve: vi.fn((alias: string) =>
      join(root, alias.replace('@data/', '').replaceAll('/', '\\')),
    ),
  } as unknown as PathResolver
}

describe('ContextRnn', () => {
  let root: string

  beforeEach(() => {
    root = join(tmpdir(), `infos-context-rnn-${Date.now()}-${Math.random()}`)
    mkdirSync(root, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('应当创建零初始化状态并在更新时调用投影与 minGRU', () => {
    const rnn = new ContextRnn(createResolver(root))

    const initial = rnn.getHiddenState('pero', 'desktop')
    rnn.update('pero', 'desktop', [3, 4, 5])
    const updated = rnn.getHiddenState('pero', 'desktop')

    expect(Array.from(initial)).toEqual([0, 0, 0, 0])
    expect(projectInput).toHaveBeenCalledWith(new Float32Array([3, 4, 5]), expect.any(Float32Array))
    expect(minGruForwardWithWeights).toHaveBeenCalledWith(
      new Float32Array([0, 0, 0, 0]),
      new Float32Array([3, 4, 1, 2]),
      expect.any(Object), // minGruWeights
    )
    expect(Array.from(updated)).toEqual([3, 4, 1, 2])
    expect(rnn.getStats()).toEqual([
      { agentId: 'pero', mode: 'desktop', updateCount: 1, lastUpdatedAt: expect.any(Number) },
    ])
  })

  it('应按运行时Embedding维度生成偏置向量并计算聚类softmax亲和度', () => {
    const rnn = new ContextRnn(createResolver(root), { inputDim: 6 })
    rnn.update('pero', 'desktop', [1, 0])

    const bias = rnn.generateBias('pero', 'desktop')
    const affinities = rnn.computeClusterAffinities(
      'pero',
      'desktop',
      new Map([
        [1, new Float32Array([1, 0, 0, 0])],
        [2, new Float32Array([0, 2, 0, 0])],
      ]),
    )

    expect(bias).toHaveLength(6)
    expect(affinities.get(1)! + affinities.get(2)!).toBeCloseTo(1)
    expect(affinities.get(1)).toBeGreaterThan(affinities.get(2)!)
    expect(rnn.computeClusterAffinities('pero', 'desktop', new Map())).toEqual(new Map())
  })

  it('应当保存和恢复隐状态', () => {
    const resolver = createResolver(root)
    const rnn = new ContextRnn(resolver)
    rnn.update('pero', 'work', [2, 3])
    rnn.save('pero', 'work')

    const restored = new ContextRnn(resolver)
    const loaded = restored.load('pero', 'work')

    expect(loaded).toBe(true)
    expect(Array.from(restored.getHiddenState('pero', 'work'))).toEqual([2, 3, 1, 2])
    expect(restored.getStats()[0]).toMatchObject({ agentId: 'pero', mode: 'work', updateCount: 1 })
  })

  it('应当处理缺失、损坏状态文件和权重文件，并保存全部状态与权重', () => {
    const resolver = createResolver(root)
    const badDir = join(root, 'agent_pero')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'rnn_bad.bin'), Buffer.from([1, 2, 3]))
    const sharedDir = join(root, 'shared')
    mkdirSync(sharedDir, { recursive: true })
    writeFileSync(join(sharedDir, 'rnn_proj.bin'), Buffer.from([1, 2, 3]))

    const rnn = new ContextRnn(resolver)
    expect(rnn.load('pero', 'missing')).toBe(false)
    expect(rnn.load('pero', 'bad')).toBe(false)

    rnn.update('pero', 'desktop', [1, 1])
    rnn.saveAll()

    const loadedWeights = new ContextRnn(resolver)
    expect(loadedWeights.getHiddenState('pero', 'desktop')).toEqual(expect.any(Float32Array))
  })
})
