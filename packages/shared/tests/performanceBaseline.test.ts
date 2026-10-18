import { describe, expect, it } from 'vitest'
import { PerformanceBaselineRegistry } from '../src/performanceBaseline'

describe('性能样本有界窗口', () => {
  it('长期采样只保留最近窗口，默认基线仍保留全部样本', () => {
    const bounded = new PerformanceBaselineRegistry(3)
    const baseline = new PerformanceBaselineRegistry()
    for (const value of [1, 2, 3, 4, 5]) {
      bounded.observe('耗时', value)
      baseline.observe('耗时', value)
    }
    expect(bounded.summary('耗时')).toMatchObject({ count: 3, min: 3, max: 5, mean: 4 })
    expect(baseline.summary('耗时')).toMatchObject({ count: 5, min: 1, max: 5 })
    expect(() => new PerformanceBaselineRegistry(0)).toThrow('PERFORMANCE_CAPACITY_INVALID')
  })
})
