import type {
  TokenUsageGroup,
  TokenUsagePeriod,
  TokenUsageStatistics,
  TokenUsageTotals,
  TokenUsageFilters,
} from '@infos/shared'
import type { TokenUsageRepository } from '../../repositories/tokenUsage.repo'

function emptyTotals(): TokenUsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    cacheReportedRequests: 0,
    cacheHitRequests: 0,
    reasoningTokens: 0,
    requests: 0,
    reportedRequests: 0,
    inputReportedRequests: 0,
    outputReportedRequests: 0,
    incompleteRequests: 0,
    unreportedRequests: 0,
    failedRequests: 0,
  }
}
function add(target: TokenUsageTotals, value: TokenUsageTotals): void {
  for (const key of Object.keys(target) as Array<keyof TokenUsageTotals>) {
    if (typeof target[key] === 'number' && typeof value[key] === 'number') target[key] += value[key]
  }
}
function shiftDate(key: string, days: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

export class TokenUsageService {
  constructor(private repository: TokenUsageRepository) {}

  filterOptions(agentId?: string) {
    return this.repository.filterOptions(agentId)
  }

  statistics(
    period: TokenUsagePeriod,
    timeZone: string,
    agentId?: string,
    filters: TokenUsageFilters = {},
  ): TokenUsageStatistics {
    const now = Date.now()
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
    const parts = (at: number) => {
      const values = Object.fromEntries(
        formatter.formatToParts(at).map((part) => [part.type, part.value]),
      )
      return { day: `${values.year}-${values.month}-${values.day}`, hour: values.hour ?? '00' }
    }
    const today = parts(now).day
    const days = period === 'today' ? 1 : period === '7d' ? 7 : 30
    const firstDay = shiftDate(today, 1 - days)
    // 用日历边界二分定位当地零点，不能把跨夏令时的自然日当成固定 24 小时。
    const midnight = (day: string) => {
      const center = Date.parse(`${day}T00:00:00Z`)
      let low = center - 36 * 3600000
      let high = center + 36 * 3600000
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        if (parts(middle).day < day) low = middle + 1
        else high = middle
      }
      return low
    }
    const from = midnight(firstDay)
    const to = midnight(shiftDate(today, 1))
    const buckets = Array.from({ length: period === 'today' ? 24 : days }, (_, index) => {
      const key = period === 'today' ? String(index).padStart(2, '0') : shiftDate(firstDay, index)
      return {
        key,
        label: period === 'today' ? `${key}:00` : key.slice(5).replace('-', '/'),
        ...emptyTotals(),
      }
    })
    const bucketMap = new Map(buckets.map((item) => [item.key, item]))
    const models = new Map<string, TokenUsageGroup>()
    const purposes = new Map<string, TokenUsageGroup>()
    const channels = new Map<string, TokenUsageGroup>()
    const totals = emptyTotals()
    const minuteParts = new Map<number, ReturnType<typeof parts>>()
    for (const row of this.repository.aggregate(from, to, agentId, filters)) {
      const date = minuteParts.get(row.at) ?? parts(Math.max(row.at, from))
      minuteParts.set(row.at, date)
      const bucket = bucketMap.get(period === 'today' ? date.hour : date.day)
      if (bucket) add(bucket, row)
      add(totals, row)
      const modelKey = JSON.stringify([row.provider, row.modelId])
      const model = models.get(modelKey) ?? {
        key: modelKey,
        provider: row.provider,
        modelId: row.modelId,
        ...emptyTotals(),
      }
      add(model, row)
      models.set(modelKey, model)
      const purpose = purposes.get(row.purpose) ?? { key: row.purpose, ...emptyTotals() }
      add(purpose, row)
      purposes.set(row.purpose, purpose)
      const channelKey = row.channel || 'unknown'
      const channel = channels.get(channelKey) ?? { key: channelKey, ...emptyTotals() }
      add(channel, row)
      channels.set(channelKey, channel)
    }
    const firstAt = this.repository.firstRecordedAt(agentId, filters)
    return {
      period,
      timeZone,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      generatedAt: new Date(now).toISOString(),
      firstRecordedAt: firstAt === null ? null : new Date(firstAt).toISOString(),
      totals,
      buckets,
      models: [...models.values()].sort(
        (a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests,
      ),
      purposes: [...purposes.values()].sort(
        (a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests,
      ),
      channels: [...channels.values()].sort(
        (a, b) => b.totalTokens - a.totalTokens || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      ),
    }
  }
}
