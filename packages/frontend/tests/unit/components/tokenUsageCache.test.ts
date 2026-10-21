// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import type { TokenUsageStatistics, TokenUsageTotals } from '@infos/shared'
import TokenUsageCard from '../../../src/components/usage/TokenUsageCard.vue'

const mocks = vi.hoisted(() => ({ statistics: vi.fn(), filters: vi.fn() }))
vi.mock('../../../src/api/modules/tokenUsageApi', () => ({
  tokenUsageApi: { statistics: mocks.statistics, filters: mocks.filters },
}))
vi.mock('../../../src/stores', () => ({ useAgentStore: () => ({ agents: [] }) }))

const wrappers: VueWrapper[] = []
function statistics(overrides: Partial<TokenUsageTotals> = {}): TokenUsageStatistics {
  const totals: TokenUsageTotals = {
    inputTokens: 10100,
    outputTokens: 60,
    totalTokens: 10160,
    cachedReadTokens: 900,
    cachedWriteTokens: 0,
    cacheHitTokens: 900,
    cacheMissTokens: 200,
    cacheReportedRequests: 2,
    cacheHitRequests: 1,
    reasoningTokens: 0,
    requests: 3,
    reportedRequests: 3,
    inputReportedRequests: 3,
    outputReportedRequests: 3,
    incompleteRequests: 0,
    unreportedRequests: 0,
    failedRequests: 0,
    ...overrides,
  }
  return {
    period: 'today',
    timeZone: 'Asia/Shanghai',
    from: '2026-10-18T00:00:00+08:00',
    to: '2026-10-19T00:00:00+08:00',
    generatedAt: '2026-10-18T12:00:00+08:00',
    firstRecordedAt: null,
    totals,
    buckets: [],
    models: [{ key: 'deepseek', provider: 'deepseek', modelId: 'deepseek-flash', ...totals }],
    purposes: [{ key: 'conversation', ...totals }],
  }
}
async function card(data: TokenUsageStatistics) {
  mocks.statistics.mockResolvedValue({ data })
  mocks.filters.mockResolvedValue({
    data: {
      threads: [{ id: 'thread-a', title: '制作网页' }],
      models: [{ provider: 'deepseek', modelId: 'deepseek-flash' }],
    },
  })
  const wrapper = mount(TokenUsageCard, {
    global: {
      stubs: {
        PCard: { template: '<section><slot /></section>' },
        PSelect: true,
        PixelIcon: true,
        BrandIcon: true,
      },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
beforeEach(() => vi.spyOn(document, 'hidden', 'get').mockReturnValue(false))
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('用量卡片的缓存统计', () => {
  it('Thread 和模型选项来自实际调用，组合选择后传给后台统计', async () => {
    const wrapper = await card(statistics())
    await wrapper.get('.usage-summary').trigger('click')
    await flushPromises()
    const selects = wrapper.findAllComponents({ name: 'PSelect' })
    const thread = selects.find((item) => item.attributes('aria-label') === '筛选会话')!
    const model = selects.find((item) => item.attributes('aria-label') === '筛选模型')!
    thread.vm.$emit('update:modelValue', 'thread-a')
    model.vm.$emit('update:modelValue', JSON.stringify(['deepseek', 'deepseek-flash']))
    await flushPromises()
    expect(mocks.statistics).toHaveBeenLastCalledWith(
      'today',
      expect.any(String),
      undefined,
      expect.any(AbortSignal),
      {
        threadId: 'thread-a',
        provider: 'deepseek',
        modelId: 'deepseek-flash',
      },
    )
    expect(wrapper.get('.usage-summary-footer').text()).toContain('已筛选')
  })
  it('用有效上报的输入计算命中率，展开后显示计数与统计覆盖量', async () => {
    const wrapper = await card(statistics())
    expect(wrapper.get('.usage-cache-summary').text()).toContain('81.82%')
    await wrapper.get('.usage-summary').trigger('click')
    await flushPromises()
    const cache = wrapper.get('[aria-label="缓存命中统计"]')
    expect(cache.text()).toContain('2 / 3 次已上报')
    expect(cache.text()).toContain('900')
    expect(cache.text()).toContain('200')
    expect(cache.get('[role="meter"]').attributes('aria-valuetext')).toBe('81.82%')
    expect(wrapper.get('.usage-row-cache').text()).toContain('81.82%')
    expect(cache.text().replace(/\s/g, '')).toContain('1/2次')
  })

  it('没有缓存上报时显示未上报，不显示零命中或进度条', async () => {
    const wrapper = await card(
      statistics({
        cacheHitTokens: 0,
        cacheMissTokens: 0,
        cacheReportedRequests: 0,
        cacheHitRequests: 0,
        cachedReadTokens: 0,
      }),
    )
    expect(wrapper.get('.usage-cache-summary').text()).toContain('未上报')
    await wrapper.get('.usage-summary').trigger('click')
    await flushPromises()
    const cache = wrapper.get('[aria-label="缓存命中统计"]')
    expect(cache.text()).toContain('未上报')
    expect(cache.find('[role="meter"]').exists()).toBe(false)
    expect(cache.text()).not.toContain('0.00%')
  })

  it('明确零命中显示零，缓存写入单独展示且不会算入命中', async () => {
    const wrapper = await card(
      statistics({
        cacheHitTokens: 0,
        cacheMissTokens: 100,
        cacheReportedRequests: 1,
        cacheHitRequests: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 100,
      }),
    )
    expect(wrapper.get('.usage-cache-summary').text()).toContain('0.00%')
    await wrapper.get('.usage-summary').trigger('click')
    await flushPromises()
    expect(wrapper.get('.usage-cache-write').text()).toBe('缓存写入 100 Token')
    expect(wrapper.get('[role="meter"]').attributes('aria-valuenow')).toBe('0')
  })
})
