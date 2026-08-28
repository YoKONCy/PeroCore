import { describe, expect, it } from 'vitest'
import { PerformanceBaselineRegistry } from '@infos/shared'

describe('性能基线与回归门禁', () => {
  it('应确定性计算P50/P95/P99并报告超限指标', () => {
    const registry = new PerformanceBaselineRegistry()
    for (let value = 1; value <= 100; value++) registry.observe('latency_ms', value)
    expect(registry.summary('latency_ms')).toMatchObject({
      count: 100,
      min: 1,
      p50: 50,
      p95: 95,
      p99: 99,
      max: 100,
      mean: 50.5,
    })
    expect(() =>
      registry.assertGates([
        { metric: 'latency_ms', percentile: 'p95', maximum: 95, minimumSamples: 100 },
      ]),
    ).not.toThrow()
    expect(() =>
      registry.assertGates([{ metric: 'latency_ms', percentile: 'p95', maximum: 90 }]),
    ).toThrow('PERFORMANCE_GATE_FAILED')
  })

  it('应拒绝非法样本和样本不足的伪基线', () => {
    const registry = new PerformanceBaselineRegistry()
    expect(() => registry.observe('bad', Number.NaN)).toThrow('PERFORMANCE_SAMPLE_INVALID')
    expect(() =>
      registry.assertGates([
        { metric: 'missing', percentile: 'p95', maximum: 1, minimumSamples: 2 },
      ]),
    ).toThrow('样本不足')
  })
})
