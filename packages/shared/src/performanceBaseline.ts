/**
 * performanceBaseline — 跨包共享协议层
 *
 * 负责定义该模块的稳定入口、数据边界与错误语义。
 * 调用方通过这里访问领域能力，避免绕过校验直接耦合内部状态。
 */
export interface PerformanceSummary {
  count: number
  min: number
  p50: number
  p95: number
  p99: number
  max: number
  mean: number
}

export interface PerformanceGate {
  metric: string
  percentile: 'p50' | 'p95' | 'p99' | 'max' | 'mean'
  maximum: number
  minimumSamples?: number
}

/** 环境无关的性能样本与回归门禁计算器。 */
export class PerformanceBaselineRegistry {
  private readonly samples = new Map<string, number[]>()

  observe(metric: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new Error('PERFORMANCE_SAMPLE_INVALID')
    const values = this.samples.get(metric) ?? []
    values.push(value)
    this.samples.set(metric, values)
  }

  summary(metric: string): PerformanceSummary | undefined {
    const values = [...(this.samples.get(metric) ?? [])].sort((left, right) => left - right)
    if (!values.length) return undefined
    return {
      count: values.length,
      min: values[0]!,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
      max: values.at(-1)!,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    }
  }

  snapshot(): Record<string, PerformanceSummary> {
    return Object.fromEntries(
      [...this.samples.keys()].sort().flatMap((metric) => {
        const summary = this.summary(metric)
        return summary ? [[metric, summary]] : []
      }),
    )
  }

  assertGates(gates: readonly PerformanceGate[]): void {
    const failures: string[] = []
    for (const gate of gates) {
      const summary = this.summary(gate.metric)
      if (!summary || summary.count < (gate.minimumSamples ?? 1)) {
        failures.push(`${gate.metric}: 样本不足`)
      } else if (summary[gate.percentile] > gate.maximum) {
        failures.push(
          `${gate.metric}.${gate.percentile}=${summary[gate.percentile].toFixed(3)} > ${gate.maximum}`,
        )
      }
    }
    if (failures.length) throw new Error(`PERFORMANCE_GATE_FAILED: ${failures.join('; ')}`)
  }
}

function percentile(values: readonly number[], ratio: number): number {
  return values[Math.max(0, Math.ceil(values.length * ratio) - 1)]!
}
