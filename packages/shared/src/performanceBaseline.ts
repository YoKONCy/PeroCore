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
  private readonly cursors = new Map<string, number>()

  /** 默认保留全部基线样本；长期运行的界面可限制为最近一段窗口。 */
  constructor(private readonly capacity = Infinity) {
    if (capacity !== Infinity && (!Number.isSafeInteger(capacity) || capacity < 1))
      throw new Error('PERFORMANCE_CAPACITY_INVALID')
  }

  observe(metric: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new Error('PERFORMANCE_SAMPLE_INVALID')
    const values = this.samples.get(metric) ?? []
    if (values.length < this.capacity) values.push(value)
    else {
      const cursor = this.cursors.get(metric) ?? 0
      values[cursor] = value
      this.cursors.set(metric, (cursor + 1) % this.capacity)
    }
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
