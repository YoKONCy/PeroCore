// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemoriesTab from '../../src/components/dashboard/tabs/MemoriesTab.vue'
import {
  DASHBOARD_CTX_KEY,
  type DashboardContext,
} from '../../src/composables/dashboard/useDashboardContext'

const memoryMocks = vi.hoisted(() => ({
  archive: vi.fn(),
  detail: vi.fn(),
  source: vi.fn(),
  graph: vi.fn(),
}))
const { archive, detail, source, graph } = memoryMocks

vi.mock('../../src/api/modules/memoryApi', () => ({
  memoryApi: memoryMocks,
}))

vi.mock('../../src/stores/useAgentStore', () => ({
  useAgentStore: () => ({
    enabledAgents: [{ id: 'pero', name: 'Pero' }],
  }),
}))

vi.mock('../../src/stores/useNotificationStore', () => ({
  useNotificationStore: () => ({ toast: vi.fn() }),
}))

const first = {
  id: 'event-1',
  agentId: 'pero',
  narrative: '较早事件',
  eventAt: '2026-08-27T09:00:00.000Z',
  createdAt: '2026-08-27T09:01:00.000Z',
  importance: 6,
  affect: { tones: ['平静'], valence: 6, arousal: 3 },
  participants: ['用户'],
  places: [],
  objects: [],
  topics: ['测试'],
  origin: {
    mode: 'active',
    threadId: 'thread-1',
    pairIds: ['pair-1'],
    messageIds: ['1'],
    channel: 'desktop',
  },
  status: 'active',
} as const

const archived = {
  ...first,
  id: 'event-2',
  narrative: '较晚的归档事件',
  eventAt: '2026-08-27T10:00:00.000Z',
  status: 'archived',
} as const

function archiveResult(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      items: [first, archived],
      page: 1,
      pageSize: 30,
      total: 2,
      pageCount: 1,
      facets: {
        channels: [{ value: 'desktop', count: 2 }],
        statuses: [{ value: 'active', count: 1 }],
        modes: [{ value: 'active', count: 2 }],
        tones: [],
        participants: [{ value: '用户', count: 1 }],
        places: [],
        objects: [],
        topics: [{ value: '测试', count: 1 }],
      },
      stats: { active: 1, archived: 1, averageImportance: 6, topicCount: 1 },
      ...overrides,
    },
  }
}

function mountTab() {
  const context = {
    activeAgentId: ref('pero'),
    refreshKey: ref(0),
  } as DashboardContext
  return mount(MemoriesTab, {
    global: {
      provide: { [DASHBOARD_CTX_KEY as symbol]: context },
      stubs: {
        PixelIcon: true,
        PCard: { template: '<div><slot /></div>' },
        PButton: {
          props: ['disabled', 'loading'],
          emits: ['click'],
          template:
            '<button :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>',
        },
        PInput: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
        },
        PSelect: true,
        PSlider: true,
        PEmpty: true,
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  archive.mockResolvedValue(archiveResult())
  graph.mockResolvedValue({
    data: {
      nodes: [first, archived],
      edges: [{ sourceId: first.id, targetId: archived.id, relation: 'same_event', weight: 1 }],
      truncated: false,
    },
  })
  detail.mockImplementation(async (id: string) => ({
    data: {
      ...(id === archived.id ? archived : first),
      previous: id === archived.id ? first : undefined,
      next: id === first.id ? archived : undefined,
      relations:
        id === archived.id
          ? [
              { sourceId: first.id, targetId: archived.id, relation: 'same_event', weight: 1 },
              { sourceId: first.id, targetId: archived.id, relation: 'caused_by', weight: 0.8 },
            ]
          : [],
    },
  }))
  source.mockResolvedValue({ data: { available: false, messages: [] } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoriesTab 档案工作台', () => {
  it('初始加载默认只请求活跃记忆并渲染列表与统计', async () => {
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))

    expect(archive).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'pero', statuses: ['active'], page: 1 }),
    )
    expect(wrapper.text()).toContain('较早事件')
    expect(wrapper.text()).toContain('较晚的归档事件')
    expect(wrapper.text()).toContain('平均重要度')
    expect(wrapper.text()).toContain('主动记事')
    expect(wrapper.text()).toContain('已归档')
  })

  it('点击条目在右侧检查器显示详情、归档提示与关系簇', async () => {
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))

    await wrapper.findAll('.entry')[1]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.inspector-body').exists()).toBe(true))

    expect(wrapper.find('.archive-badge').exists()).toBe(true)
    expect(wrapper.text()).toContain('同一事件簇')
    expect(wrapper.text()).toContain('因果')
    expect(wrapper.text()).toContain('前一个事件')
    expect(wrapper.text()).toContain('较早事件')
  })

  it('时间轴前后导航应重新请求对应详情', async () => {
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))
    await wrapper.findAll('.entry')[1]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.archive-badge').exists()).toBe(true))

    await wrapper.find('.timeline-nav-item').trigger('click')
    await vi.waitFor(() => expect(detail).toHaveBeenCalledTimes(2))
    expect(detail).toHaveBeenLastCalledWith(first.id)
  })

  it('原始对话折叠区应展示不可用与失败状态', async () => {
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))
    await wrapper.findAll('.entry')[0]!.trigger('click')
    await vi.waitFor(() => expect(wrapper.find('.inspector-body').exists()).toBe(true))

    const findSourceButton = () =>
      wrapper.findAll('button').find((button) => /展开|收起/.test(button.text()))!
    const sourceButton = findSourceButton()
    await sourceButton.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('原文不可用'))

    source.mockRejectedValueOnce(new Error('网络失败'))
    await sourceButton.trigger('click')
    await findSourceButton().trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('来源加载失败，请稍后重试'))
  })

  it('搜索输入防抖后携带query重新请求并显示可移除chip', async () => {
    vi.useFakeTimers()
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))

    await wrapper.find('input').setValue('长期记忆')
    expect(wrapper.find('.chip').exists()).toBe(true)
    expect(wrapper.text()).toContain('搜索：长期记忆')

    vi.advanceTimersByTime(350)
    await vi.waitFor(() =>
      expect(archive).toHaveBeenLastCalledWith(expect.objectContaining({ query: '长期记忆' })),
    )

    await wrapper.find('.chip').trigger('click')
    expect(wrapper.find('.chip').exists()).toBe(false)
  })

  it('分页控件应在翻页时携带新页码请求', async () => {
    archive.mockImplementation(async (filter: { page?: number }) =>
      archiveResult({ total: 40, pageCount: 2, page: filter.page ?? 1 }),
    )
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))

    const next = wrapper.findAll('button').find((button) => button.text().includes('下一页'))!
    expect((next.element as HTMLButtonElement).disabled).toBe(false)
    await next.trigger('click')
    await vi.waitFor(() =>
      expect(archive).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    )
  })

  it('切换图谱视图应请求图谱快照并渲染节点', async () => {
    const wrapper = mountTab()
    await vi.waitFor(() => expect(wrapper.findAll('.entry')).toHaveLength(2))

    const graphButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('关系图谱'))!
    await graphButton.trigger('click')

    await vi.waitFor(() => expect(graph).toHaveBeenCalledWith('pero', false))
    await vi.waitFor(() => expect(wrapper.findAll('.graph-node')).toHaveLength(2))
    expect(wrapper.find('.archive-inspector').exists()).toBe(true)
  })
})
