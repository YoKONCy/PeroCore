/**
 * useMemories — 记忆管理 composable
 *
 * 管理记忆节点的列表展示、搜索过滤、详情查看。
 * F1 阶段: 使用 mock 数据，F3 替换为 memoryApi 调用。
 */
import { ref, computed } from 'vue'

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
}

// ── Mock 数据 ──

const MOCK_MEMORIES: MemoryNode[] = [
  { id: 'm1', type: 'core', content: '主人喜欢在深夜编程，偏好 TypeScript 和 Rust 语言。工作时会放轻音乐~', importance: 9, tags: ['偏好', '编程', '习惯'], createdAt: '2026-04-18T22:30:00Z', source: '对话推理' },
  { id: 'm2', type: 'core', content: '主人的名字是 YoKONCy，住在东京。养了一只叫「杏仁」的猫咪！', importance: 10, tags: ['身份', '宠物'], createdAt: '2026-03-15T10:00:00Z', source: '用户告知' },
  { id: 'm3', type: 'episodic', content: '今天一起完成了 PeroCore-TS 后端 B6 集成，包括 ReAct 循环升级和 SSE 事件对齐，全程零编译错误。', importance: 7, tags: ['项目', 'PeroCore'], createdAt: '2026-04-20T04:43:00Z', source: '对话记录' },
  { id: 'm4', type: 'diary', content: '日记：今天主人工作了很久，从中午一直到凌晨，完成了后端的全部接线工作。主人看起来很开心~', importance: 6, tags: ['日记', '情绪'], createdAt: '2026-04-20T05:00:00Z', source: '自动生成' },
  { id: 'm5', type: 'reflection', content: '反思：主人倾向于一次性完成大量工作而不是分段进行，适合给出完整方案而不是分步骤问询。', importance: 8, tags: ['行为模式', '工作'], createdAt: '2026-04-19T12:00:00Z', source: '反思系统' },
  { id: 'm6', type: 'core', content: '主人正在开发 TriviumDB，一个 AI-native 的嵌入式数据库，使用 Rust 编写。', importance: 8, tags: ['项目', 'TriviumDB', 'Rust'], createdAt: '2026-04-07T16:00:00Z', source: '对话推理' },
  { id: 'm7', type: 'episodic', content: '讨论了 InfinityOS 的架构设计，一个基于 Debian 的纯 AI Native 操作系统概念。', importance: 5, tags: ['项目', 'InfinityOS'], createdAt: '2026-04-13T16:30:00Z', source: '对话记录' },
  { id: 'm8', type: 'episodic', content: '一起分析了东方居酒屋异世录项目的架构，包含 Vue 前端、Go 后端和移动端配置。', importance: 4, tags: ['项目', '分析'], createdAt: '2026-04-01T06:30:00Z', source: '对话记录' },
]

// ── Composable ──

export function useMemories() {
  const memories = ref<MemoryNode[]>([...MOCK_MEMORIES])
  const isLoading = ref(false)
  const searchQuery = ref('')
  const filterType = ref<MemoryType | 'all'>('all')
  const selectedMemory = ref<MemoryNode | null>(null)
  const isDetailOpen = ref(false)

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

  const filteredMemories = computed(() => {
    let list = memories.value
    if (filterType.value !== 'all') {
      list = list.filter((m) => m.type === filterType.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(
        (m) => m.content.toLowerCase().includes(q) || m.tags.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list.sort((a, b) => b.importance - a.importance)
  })

  const stats = computed(() => ({
    total: memories.value.length,
    core: memories.value.filter((m) => m.type === 'core').length,
    episodic: memories.value.filter((m) => m.type === 'episodic').length,
    diary: memories.value.filter((m) => m.type === 'diary').length,
    reflection: memories.value.filter((m) => m.type === 'reflection').length,
  }))

  function openDetail(memory: MemoryNode) {
    selectedMemory.value = memory
    isDetailOpen.value = true
  }

  function deleteMemory(id: string) {
    memories.value = memories.value.filter((m) => m.id !== id)
    if (selectedMemory.value?.id === id) isDetailOpen.value = false
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return {
    memories, isLoading, searchQuery, filterType,
    selectedMemory, isDetailOpen,
    typeOptions, typeLabels, typeColors,
    filteredMemories, stats,
    openDetail, deleteMemory, formatDate,
  }
}
