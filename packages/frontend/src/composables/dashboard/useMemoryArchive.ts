/**
 * useMemoryArchive — 核心记忆档案 composable
 *
 * 管理档案页全部状态：组合过滤、分页、facet、统计、详情检查器、图谱快照。
 * 过滤与分页全部由后端 archiveQuery 执行，前端不拉全量数据。
 *
 * @module packages/frontend/src/composables/dashboard/useMemoryArchive
 */
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type {
  EventMemoryGraphSnapshot,
  EventNote,
  EventNoteArchiveFacets,
  EventNoteArchiveStats,
  EventNoteDetail,
  EventNoteStatus,
} from '@infos/shared'
import { memoryApi, type EventMemorySource } from '../../api/modules/memoryApi'

export type ArchiveSort = 'eventAt' | 'createdAt' | 'importance'
export type ArchiveOrder = 'asc' | 'desc'
export type StatusFilter = 'all' | EventNoteStatus

export interface ArchiveChips {
  key: string
  label: string
  remove: () => void
}

const EMPTY_FACETS: EventNoteArchiveFacets = {
  channels: [],
  statuses: [],
  modes: [],
  tones: [],
  participants: [],
  places: [],
  objects: [],
  topics: [],
}

const EMPTY_STATS: EventNoteArchiveStats = {
  active: 0,
  archived: 0,
  averageImportance: 0,
  topicCount: 0,
}

export function useMemoryArchive(
  getAgentId: () => string,
  getAgentIds: () => string[] = () => [getAgentId()],
) {
  // ── 列表与分页 ──
  const items = shallowRef<EventNote[]>([])
  const total = ref(0)
  const pageCount = ref(1)
  const page = ref(1)
  const pageSize = ref(30)
  const isLoading = ref(false)
  const facets = shallowRef<EventNoteArchiveFacets>(EMPTY_FACETS)
  const stats = shallowRef<EventNoteArchiveStats>(EMPTY_STATS)

  // ── 过滤条件 ──
  const searchQuery = ref('')
  const agent = ref(getAgentId())
  const channel = ref('all')
  const status = ref<StatusFilter>('active')
  const mode = ref('all')
  const importanceMin = ref(0)
  const importanceMax = ref(10)
  const tones = ref<string[]>([])
  const participants = ref<string[]>([])
  const places = ref<string[]>([])
  const objects = ref<string[]>([])
  const topics = ref<string[]>([])
  const eventAtFrom = ref('')
  const eventAtTo = ref('')
  const createdAtFrom = ref('')
  const createdAtTo = ref('')
  const sort = ref<ArchiveSort>('eventAt')
  const order = ref<ArchiveOrder>('desc')

  // ── 详情检查器 ──
  const selected = shallowRef<EventNoteDetail | null>(null)
  const selectedId = ref<string | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const source = shallowRef<EventMemorySource | null>(null)
  const sourceLoading = ref(false)
  const sourceError = ref('')

  // ── 图谱 ──
  const graph = shallowRef<EventMemoryGraphSnapshot>({ nodes: [], edges: [], truncated: false })
  const graphLoading = ref(false)
  const graphError = ref('')

  /** 当前筛选是否偏离默认值（决定 chips 区是否显示） */
  const hasActiveFilters = computed(() => chips.value.length > 0)

  const chips = computed<ArchiveChips[]>(() => {
    const list: ArchiveChips[] = []
    if (searchQuery.value.trim()) {
      const value = searchQuery.value
      list.push({
        key: 'query',
        label: `搜索：${value.trim()}`,
        remove: () => (searchQuery.value = ''),
      })
    }
    if (channel.value !== 'all') {
      const value = channel.value
      list.push({ key: 'channel', label: `来源：${value}`, remove: () => (channel.value = 'all') })
    }
    if (status.value !== 'active') {
      const value = status.value
      list.push({
        key: 'status',
        label: value === 'archived' ? '仅归档' : '全部状态',
        remove: () => (status.value = 'active'),
      })
    }
    if (mode.value !== 'all') {
      const value = mode.value
      list.push({
        key: 'mode',
        label: value === 'active' ? '主动记事' : '后台炼化',
        remove: () => (mode.value = 'all'),
      })
    }
    if (importanceMin.value > 0 || importanceMax.value < 10) {
      const min = importanceMin.value
      const max = importanceMax.value
      list.push({
        key: 'importance',
        label: `重要度 ${min}–${max}`,
        remove: () => {
          importanceMin.value = 0
          importanceMax.value = 10
        },
      })
    }
    for (const [key, values, setter] of [
      ['tone', tones, () => (tones.value = [])],
      ['participant', participants, () => (participants.value = [])],
      ['place', places, () => (places.value = [])],
      ['object', objects, () => (objects.value = [])],
      ['topic', topics, () => (topics.value = [])],
    ] as const) {
      if (!values.value.length) continue
      const label = values.value.join('、')
      list.push({ key, label, remove: setter })
    }
    if (eventAtFrom.value || eventAtTo.value) {
      const from = eventAtFrom.value
      const to = eventAtTo.value
      list.push({
        key: 'eventRange',
        label: `事件时间 ${from || '…'} ~ ${to || '…'}`,
        remove: () => {
          eventAtFrom.value = ''
          eventAtTo.value = ''
        },
      })
    }
    if (createdAtFrom.value || createdAtTo.value) {
      const from = createdAtFrom.value
      const to = createdAtTo.value
      list.push({
        key: 'createdRange',
        label: `记录时间 ${from || '…'} ~ ${to || '…'}`,
        remove: () => {
          createdAtFrom.value = ''
          createdAtTo.value = ''
        },
      })
    }
    return list
  })

  function clearFilters(): void {
    searchQuery.value = ''
    channel.value = 'all'
    status.value = 'active'
    mode.value = 'all'
    importanceMin.value = 0
    importanceMax.value = 10
    tones.value = []
    participants.value = []
    places.value = []
    objects.value = []
    topics.value = []
    eventAtFrom.value = ''
    eventAtTo.value = ''
    createdAtFrom.value = ''
    createdAtTo.value = ''
  }

  function toggleFacetValue(list: Ref<string[]>, value: string): void {
    list.value = list.value.includes(value)
      ? list.value.filter((item) => item !== value)
      : [...list.value, value]
  }

  /** facet 值 → 请求参数（供组件模板直接绑定） */
  const requestFilter = computed(() => {
    const selectedAgentIds = agent.value === 'all' ? getAgentIds() : [agent.value]
    const filter: Record<string, string | number | string[]> = {
      agentId: selectedAgentIds[0] ?? getAgentId(),
      agentIds: selectedAgentIds,
      page: page.value,
      pageSize: pageSize.value,
      sort: sort.value,
      order: order.value,
    }
    if (searchQuery.value.trim()) filter.query = searchQuery.value.trim()
    if (channel.value !== 'all') filter.channels = [channel.value]
    if (status.value === 'active') filter.statuses = ['active']
    else if (status.value === 'archived') filter.statuses = ['archived']
    if (mode.value !== 'all') filter.modes = [mode.value]
    if (importanceMin.value > 0) filter.importanceMin = importanceMin.value
    if (importanceMax.value < 10) filter.importanceMax = importanceMax.value
    if (tones.value.length) filter.tones = tones.value
    if (participants.value.length) filter.participants = participants.value
    if (places.value.length) filter.places = places.value
    if (objects.value.length) filter.objects = objects.value
    if (topics.value.length) filter.topics = topics.value
    if (eventAtFrom.value) filter.eventAtFrom = new Date(eventAtFrom.value).toISOString()
    if (eventAtTo.value) filter.eventAtTo = `${new Date(eventAtTo.value).toISOString()}`
    if (createdAtFrom.value) filter.createdAtFrom = new Date(createdAtFrom.value).toISOString()
    if (createdAtTo.value) filter.createdAtTo = new Date(createdAtTo.value).toISOString()
    return filter
  })

  async function fetchArchive(): Promise<void> {
    isLoading.value = true
    // 记录请求时的页码：响应页码只用于校验，不回写 page，
    // 否则过滤条件变化触发的重置（page=1）会被旧响应的页码覆盖，造成额外请求。
    const requestedPage = page.value
    try {
      const response = await memoryApi.archive(requestFilter.value)
      const data = response.data
      if (!data) throw new Error('档案数据为空')
      items.value = data.items
      total.value = data.total
      pageCount.value = data.pageCount
      // 页面被过滤收缩时，把超出范围的页码拉回最后一页（仅当期间用户未再改页）
      if (requestedPage === page.value && data.page !== requestedPage) {
        page.value = data.page
      }
      facets.value = data.facets
      stats.value = data.stats
    } catch (error) {
      items.value = []
      total.value = 0
      pageCount.value = 1
      facets.value = EMPTY_FACETS
      throw error
    } finally {
      isLoading.value = false
    }
  }

  async function selectNote(note: EventNote): Promise<void> {
    selectedId.value = note.id
    selected.value = null
    source.value = null
    detailError.value = ''
    sourceError.value = ''
    detailLoading.value = true
    try {
      const response = await memoryApi.detail(note.id)
      selected.value = response.data ?? null
      if (!selected.value) detailError.value = '事件详情加载失败'
    } catch {
      selected.value = null
      detailError.value = '事件详情加载失败，请稍后重试。'
    } finally {
      detailLoading.value = false
    }
  }

  async function loadSource(): Promise<void> {
    if (!selected.value) return
    sourceLoading.value = true
    sourceError.value = ''
    try {
      const response = await memoryApi.source(selected.value.id)
      source.value = response.data ?? null
    } catch {
      source.value = null
      sourceError.value = '来源加载失败，请稍后重试。'
    } finally {
      sourceLoading.value = false
    }
  }

  async function fetchGraph(includeArchived: boolean): Promise<void> {
    graphLoading.value = true
    graphError.value = ''
    try {
      const agentIds = agent.value === 'all' ? getAgentIds() : [agent.value]
      const responses = await Promise.all(
        agentIds.map((agentId) => memoryApi.graph(agentId, includeArchived)),
      )
      graph.value = {
        nodes: responses.flatMap((response) => response.data?.nodes ?? []),
        edges: responses.flatMap((response) => response.data?.edges ?? []),
        truncated: responses.some((response) => response.data?.truncated),
      }
    } catch {
      graph.value = { nodes: [], edges: [], truncated: false }
      graphError.value = '记忆图谱加载失败，请稍后重试。'
    } finally {
      graphLoading.value = false
    }
  }

  function goToPage(target: number): void {
    const clamped = Math.max(1, Math.min(target, pageCount.value))
    if (clamped === page.value) return
    page.value = clamped
  }

  // 过滤条件变化时回到第一页并重新加载
  watch(
    () => [
      searchQuery.value,
      channel.value,
      status.value,
      mode.value,
      importanceMin.value,
      importanceMax.value,
      tones.value,
      participants.value,
      places.value,
      objects.value,
      topics.value,
      eventAtFrom.value,
      eventAtTo.value,
      createdAtFrom.value,
      createdAtTo.value,
      sort.value,
      order.value,
    ],
    () => {
      page.value = 1
    },
  )

  return {
    // 列表与分页
    items,
    total,
    pageCount,
    page,
    pageSize,
    isLoading,
    facets,
    stats,
    // 过滤
    searchQuery,
    agent,
    channel,
    status,
    mode,
    importanceMin,
    importanceMax,
    tones,
    participants,
    places,
    objects,
    topics,
    eventAtFrom,
    eventAtTo,
    createdAtFrom,
    createdAtTo,
    sort,
    order,
    chips,
    hasActiveFilters,
    clearFilters,
    toggleFacetValue,
    // 详情
    selected,
    selectedId,
    detailLoading,
    detailError,
    source,
    sourceLoading,
    sourceError,
    // 图谱
    graph,
    graphLoading,
    graphError,
    // 操作
    fetchArchive,
    selectNote,
    loadSource,
    fetchGraph,
    goToPage,
  }
}
