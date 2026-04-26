/**
 * useMemories — 记忆管理 composable
 *
 * 管理记忆节点的列表展示、搜索过滤、详情查看。
 * F3: 已对接 memoryApi 真实后端。
 *
 * @module packages/frontend/src/composables/dashboard/useMemories
 */
import { ref, shallowRef, computed, onMounted } from 'vue'
import { memoryApi } from '../../api/modules/memoryApi'
import { maintenanceApi } from '../../api/modules/maintenanceApi'
import type { MemoryDto } from '../../api/modules/memoryApi'
import { useNotificationStore } from '../../stores/useNotificationStore'
import { logger } from '../../lib/logger'

// ── 类型 ──

export type MemoryType = 'core' | 'episodic' | 'diary' | 'reflection'

export interface MemoryNode {
  id: string
  type: MemoryType
  content: string
  importance: number
  tags: string[]
  createdAt: string
  source: string
  /** 情感标记 */
  sentiment?: string
}

// ── 辅助函数 ──

/** 后端 DTO → 前端 MemoryNode */
function toMemoryNode(dto: MemoryDto): MemoryNode {
  return Object.freeze({
    id: String(dto.id),
    type: (dto.type || 'episodic') as MemoryType,
    content: dto.content,
    importance: dto.importance,
    tags: dto.tags
      ? dto.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    createdAt: new Date(dto.timestamp * 1000).toISOString(),
    source: dto.source || '对话记录',
    sentiment: dto.sentiment ?? 'neutral',
  })
}

// ── Composable ──

export function useMemories() {
  const notify = useNotificationStore()
  const memories = shallowRef<MemoryNode[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const searchQuery = ref('')
  const filterType = ref<MemoryType | 'all'>('all')
  const selectedMemory = ref<MemoryNode | null>(null)
  const isDetailOpen = ref(false)
  const currentPage = ref(1)
  const totalCount = ref(0)
  const pageSize = 50
  /** 日期筛选 */
  const filterDate = ref('')
  /** 视图模式：列表 / 图谱 */
  const viewMode = ref<'list' | 'graph'>('list')

  const typeOptions = [
    { label: '全部类型', value: 'all' },
    { label: '🧠 核心记忆', value: 'core' },
    { label: '📝 情景记忆', value: 'episodic' },
    { label: '📖 日记', value: 'diary' },
    { label: '💡 反思', value: 'reflection' },
  ]

  const typeLabels: Record<MemoryType, string> = {
    core: '核心记忆',
    episodic: '情景记忆',
    diary: '日记',
    reflection: '反思',
  }

  const typeColors: Record<MemoryType, string> = {
    core: 'type-core',
    episodic: 'type-episodic',
    diary: 'type-diary',
    reflection: 'type-reflection',
  }

  // ── API 操作 ──

  /** 从后端加载记忆列表 */
  async function fetchMemories(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const typeParam = filterType.value !== 'all' ? filterType.value : undefined
      const res = await memoryApi.list({
        page: currentPage.value,
        pageSize,
        type: typeParam,
        agentId: 'pero',
        dateStart: filterDate.value || undefined,
      })
      const paginated = res.data
      if (paginated) {
        memories.value = paginated.data.map(toMemoryNode)
        totalCount.value = paginated.total
      }
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('加载记忆列表失败: ' + (e as Error).message, 'error')
      logger.error('Memories', '加载记忆列表失败', e)
    } finally {
      isLoading.value = false
    }
  }

  /** 语义搜索 */
  async function searchMemories(): Promise<void> {
    const q = searchQuery.value.trim()
    if (!q) {
      await fetchMemories()
      return
    }

    isLoading.value = true
    error.value = null
    try {
      const res = await memoryApi.search({ query: q, agentId: 'pero', topK: 50 })
      const results = res.data ?? []
      memories.value = results.map((r) => ({
        id: String(r.id),
        type: 'episodic' as MemoryType,
        content: r.content,
        importance: r.importance,
        tags: r.tags
          ? r.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        createdAt: '',
        source: `语义匹配 (${(r.score * 100).toFixed(1)}%)`,
      }))
      totalCount.value = results.length
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('语义搜索失败: ' + (e as Error).message, 'error')
    } finally {
      isLoading.value = false
    }
  }

  /** 删除记忆 */
  async function deleteMemory(id: string): Promise<void> {
    try {
      await memoryApi.remove(Number(id))
      memories.value = memories.value.filter((m) => m.id !== id)
      totalCount.value = Math.max(0, totalCount.value - 1)
      if (selectedMemory.value?.id === id) isDetailOpen.value = false
      notify.toast('记忆已删除', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('删除记忆失败: ' + (e as Error).message, 'error')
    }
  }

  // ── 计算属性 ──

  /** 已过滤的记忆列表（前端侧的本地二次过滤） */
  const filteredMemories = computed(() => {
    let list = memories.value
    // 本地搜索（searchMemories 已经做过后端语义搜索了，这里做前端文本过滤互补）
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(
        (m) =>
          m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => b.importance - a.importance)
  })

  const stats = computed(() => ({
    total: totalCount.value,
    core: memories.value.filter((m) => m.type === 'core').length,
    episodic: memories.value.filter((m) => m.type === 'episodic').length,
    diary: memories.value.filter((m) => m.type === 'diary').length,
    reflection: memories.value.filter((m) => m.type === 'reflection').length,
  }))

  function openDetail(memory: MemoryNode) {
    selectedMemory.value = memory
    isDetailOpen.value = true
  }

  function formatDate(iso: string): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // ── 标签筛选 ──

  const selectedTags = ref<string[]>([])

  /** 提取热门标签 (按出现频次排序) */
  const topTags = computed(() => {
    const tagCount = new Map<string, number>()
    for (const m of memories.value) {
      for (const t of m.tags) {
        tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
      }
    }
    return [...tagCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }))
  })

  function toggleTag(tag: string) {
    const idx = selectedTags.value.indexOf(tag)
    if (idx >= 0) {
      selectedTags.value.splice(idx, 1)
    } else {
      selectedTags.value.push(tag)
    }
  }

  // ── 维护操作 ──

  const isRunningMaintenance = ref(false)
  const isScanningLonely = ref(false)

  /**
   * 触发记忆维护（Reflection Orchestrator）
   *
   * 包含：标签、合并、审计、退役、梦境联想、图谱修剪
   */
  async function triggerMaintenance(): Promise<void> {
    isRunningMaintenance.value = true
    try {
      await maintenanceApi.trigger('reflection')
      notify.toast('记忆维护已触发', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('记忆维护失败: ' + (e as Error).message, 'error')
    } finally {
      isRunningMaintenance.value = false
    }
  }

  /** 触发孤立记忆扫描 */
  async function triggerScanLonely(): Promise<void> {
    isScanningLonely.value = true
    try {
      await maintenanceApi.trigger('lonely-scan')
      notify.toast('孤立记忆扫描已触发', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('孤立记忆扫描失败: ' + (e as Error).message, 'error')
    } finally {
      isScanningLonely.value = false
    }
  }

  async function triggerReindex(): Promise<void> {
    try {
      await maintenanceApi.reindex('pero')
      notify.toast('重建索引已触发', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('重建索引失败: ' + (e as Error).message, 'error')
    }
  }

  // ── 故事导入 ──

  const isImportOpen = ref(false)
  const importText = ref('')
  const isImporting = ref(false)

  async function importStory(): Promise<void> {
    const content = importText.value.trim()
    if (!content) return

    isImporting.value = true
    try {
      await memoryApi.create({
        content,
        agentId: 'pero',
        type: 'episodic',
        source: '故事导入',
        importance: 5,
      })
      isImportOpen.value = false
      importText.value = ''
      await fetchMemories()
      notify.toast('故事导入成功', 'success')
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('故事导入失败: ' + (e as Error).message, 'error')
    } finally {
      isImporting.value = false
    }
  }

  // ── 图谱 ──

  const graphData = shallowRef<{ nodes: unknown[]; edges: unknown[] }>({ nodes: [], edges: [] })
  const isLoadingGraph = ref(false)

  /** 获取图谱数据 */
  async function fetchGraph(): Promise<void> {
    if (isLoadingGraph.value) return
    isLoadingGraph.value = true
    try {
      const res = await memoryApi.graph('pero', 100)
      if (res.data) {
        graphData.value = Object.freeze(res.data)
      }
    } catch (e) {
      error.value = (e as Error).message
      notify.toast('图谱加载失败: ' + (e as Error).message, 'error')
      logger.error('Memories', '图谱加载失败', e)
    } finally {
      isLoadingGraph.value = false
    }
  }

  // ── 情感工具 （ ──

  const sentimentEmojiMap: Record<string, string> = {
    positive: 'mood-happy',
    negative: 'mood-sad',
    neutral: 'mood-neutral',
    happy: 'mood-happy',
    sad: 'mood-sad',
    angry: 'mood-angry',
    excited: 'mood-excited',
  }

  const sentimentLabelMap: Record<string, string> = {
    positive: '开心',
    negative: '忧郁',
    neutral: '平静',
    happy: '开心',
    sad: '忧郁',
    angry: '愤怒',
    excited: '激动',
  }

  const sentimentColorMap: Record<string, string> = {
    positive: '#38bdf8',
    negative: '#fb7185',
    neutral: '#94a3b8',
    happy: '#fbbf24',
    sad: '#818cf8',
    angry: '#f87171',
    excited: '#e879f9',
  }

  function getSentimentEmoji(sentiment?: string): string {
    return sentimentEmojiMap[sentiment ?? ''] ?? 'mood-neutral'
  }

  function getSentimentLabel(sentiment?: string): string {
    return sentimentLabelMap[sentiment ?? ''] ?? '平静'
  }

  function getSentimentColor(sentiment?: string): string {
    return sentimentColorMap[sentiment ?? ''] ?? '#38bdf8'
  }

  // ── 初始化 ──
  onMounted(fetchMemories)

  return {
    memories,
    isLoading,
    error,
    searchQuery,
    filterType,
    selectedMemory,
    isDetailOpen,
    currentPage,
    totalCount,
    typeOptions,
    typeLabels,
    typeColors,
    filteredMemories,
    stats,
    fetchMemories,
    searchMemories,
    openDetail,
    deleteMemory,
    formatDate,
    // P2: 标签筛选
    selectedTags,
    topTags,
    toggleTag,
    // P2: 维护操作
    isRunningMaintenance,
    isScanningLonely,
    triggerMaintenance,
    triggerScanLonely,
    triggerReindex,
    // P4: 故事导入
    isImportOpen,
    importText,
    isImporting,
    importStory,
    // 日期筛选
    filterDate,
    // 视图模式
    viewMode,
    // 图谱
    graphData,
    isLoadingGraph,
    fetchGraph,
    // 情感工具
    getSentimentEmoji,
    getSentimentLabel,
    getSentimentColor,
  }
}
