<script setup lang="ts">
/**
 * MemoriesTab — 核心记忆 Tab (F1-2)
 *
 * 记忆节点列表 + 搜索 + 类型筛选 + 日期筛选 + 情感标记
 * + 图谱视图 (vue-echarts) + 详情弹窗 + 维护操作
 *
 * 图谱 / 日期 / 情感三大 UI 增强
 */
import { computed, watch, onMounted } from 'vue'
import { PixelIcon, PInput, PButton, PSelect, PDialog, PEmpty, PCard } from '../../pixel'
import PDatePicker from '../../pixel/PDatePicker.vue'
import { useMemories } from '../../../composables/dashboard/useMemories'
import { useDashboardContext } from '../../../composables/dashboard'
import { useAgentStore } from '../../../stores'
import { getApiBaseUrl } from '../../../api/transport'
import { VChart } from '../../../lib/echarts'
import type { ComposeOption } from 'echarts/core'
import type { GraphSeriesOption } from 'echarts/charts'
import type {
  TitleComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
} from 'echarts/components'

type EChartsOption = ComposeOption<
  GraphSeriesOption | TitleComponentOption | TooltipComponentOption | LegendComponentOption
>

const {
  searchQuery,
  filterType,
  filterDate,
  typeOptions,
  typeLabels,
  typeColors,
  filteredMemories,
  stats,
  selectedMemory,
  isDetailOpen,
  openDetail,
  deleteMemory,
  formatDate,
  // 视图模式
  viewMode,
  graphData,
  isLoadingGraph,
  fetchGraph,
  // 情感
  getSentimentEmoji,
  getSentimentLabel,
  getSentimentColor,
  // 标签 + 维护
  selectedTags,
  topTags,
  toggleTag,
  isRunningMaintenance,
  isScanningLonely,
  triggerMaintenance,
  triggerScanLonely,
  triggerReindex,
  // 故事导入
  isImportOpen,
  importText,
  isImporting,
  importStory,
  // 操作
  fetchMemories,
} = useMemories()

// ══════ DashboardContext 接入 ══════
const ctx = useDashboardContext()

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => fetchMemories(),
)

// ── 当前激活角色 ──
const agentStore = useAgentStore()
const activeAgentName = computed(() => {
  return agentStore.currentAgent?.name || ctx.activeAgentId.value || '未知'
})

onMounted(() => {
  if (!agentStore.agents.length) agentStore.fetchAgents()
})

function importanceDots(n: number): string {
  const filled = Math.min(n, 10)
  return '★'.repeat(Math.round(filled / 2)) + '☆'.repeat(5 - Math.round(filled / 2))
}

/** 切换视图模式 */
function switchView(mode: 'list' | 'graph') {
  viewMode.value = mode
  if (mode === 'graph') fetchGraph()
}

/** 日期变更 → 重新请求 */
watch(filterDate, () => {
  fetchMemories()
})

// ── ECharts 图谱配置 ──

const chartOption = computed<EChartsOption>(() => {
  const raw = graphData.value
  if (!raw.nodes.length) return {}

  const nodes = (raw.nodes as Array<Record<string, unknown>>).map((node) => ({
    id: String(node.id),
    name: String(node.id),
    value: Number(node.value ?? 5),
    category: String(node.category ?? 'event'),
    symbolSize: Math.min(Math.max(Number(node.value ?? 5) * 5, 15), 40),
    itemStyle: {
      color: getSentimentColor(node.sentiment as string),
      borderColor: 'var(--color-bg-primary)',
      borderWidth: 2,
      shadowBlur: 12,
      shadowColor: getSentimentColor(node.sentiment as string),
    },
    label: {
      show: Number(node.value ?? 0) > 5,
      fontSize: 10,
      color: 'var(--color-text-muted)',
    },
    tooltip: {
      formatter: () => {
        const content = String(node.full_content ?? '').substring(0, 80)
        return `<div style="max-width:260px;padding:4px;">
          <div style="font-weight:800;margin-bottom:4px;font-size:13px;">记忆 #${node.id}</div>
          <div style="font-size:12px;color:#64748b;line-height:1.5;">${content}${content.length >= 80 ? '...' : ''}</div>
        </div>`
      },
    },
  }))

  const links = (raw.edges as Array<Record<string, unknown>>).map((edge) => ({
    source: String(edge.source),
    target: String(edge.target),
    value: Number(edge.value ?? 1),
    lineStyle: {
      width: Math.max(Number(edge.value ?? 1) * 0.8, 1),
      curveness: 0.2,
      color: 'var(--color-border)',
    },
  }))

  const categories = [...new Set(nodes.map((n) => n.category))].map((c) => ({ name: c }))

  return {
    backgroundColor: 'transparent',
    title: {
      text: '✨ 核心记忆星云',
      subtext: 'Core Memory Nebula',
      top: '3%',
      left: 'center',
      textStyle: { color: 'var(--color-sky-500)', fontSize: 16, fontWeight: 'bolder' },
      subtextStyle: { color: 'var(--color-text-muted)', fontSize: 10 },
    },
    tooltip: {
      trigger: 'item',
      backgroundColor: 'var(--color-bg-primary)',
      borderColor: 'var(--color-border)',
      borderWidth: 1,
      textStyle: { color: 'var(--color-text-primary)', fontSize: 12 },
      extraCssText: 'box-shadow:0 4px 12px rgba(0,0,0,0.15);',
    },
    legend: {
      data: categories.map((c) => c.name),
      bottom: '3%',
      left: 'center',
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: 'var(--color-text-muted)', fontSize: 10 },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        data: nodes,
        links,
        categories,
        roam: true,
        draggable: true,
        label: {
          show: true,
          position: 'bottom',
          formatter: '{b}',
          color: 'var(--color-text-muted)',
          fontSize: 9,
        },
        force: {
          repulsion: 250,
          gravity: 0.08,
          edgeLength: [60, 150],
          layoutAnimation: true,
          friction: 0.6,
        },
        emphasis: {
          focus: 'adjacency' as const,
          scale: true,
        },
      },
    ],
  } as EChartsOption
})
</script>

<template>
  <div class="p-8 h-full flex flex-col overflow-hidden">
    <div class="mb-4 flex-shrink-0 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-pink-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-pink-400/15 transition-all duration-1000"
      />
      <h2 class="flex items-center gap-3 text-2xl font-black text-slate-800 font-pixel">
        <span
          class="group-hover/header:scale-110 group-hover/header:rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="brain" size="md" />
        </span>
        <span>核心记忆</span>
        <span class="text-sm font-bold text-sky-500 bg-sky-50 px-2.5 py-0.5 pixel-border-sm">
          {{ stats.total }}
        </span>
        <span class="opacity-0 group-hover/header:opacity-100 transition-opacity duration-500">
          <PixelIcon name="sparkle" size="xs" />
        </span>

        <!-- 当前角色头像徽标 -->
        <div class="ml-auto flex items-center">
          <div
            class="relative flex items-center gap-2 px-3 py-1.5 bg-sky-50/60 pixel-border-sky group/avatar cursor-default hover:bg-sky-50 transition-all"
          >
            <div
              class="w-8 h-8 pixel-border-sky overflow-hidden flex items-center justify-center bg-sky-100 group-hover/avatar:scale-110 transition-transform"
            >
              <img
                v-if="agentStore.currentAgent?.avatarUrl"
                :src="`${getApiBaseUrl()}${agentStore.currentAgent.avatarUrl}`"
                :alt="activeAgentName"
                class="w-full h-full object-cover"
              />
              <PixelIcon v-else name="cat" size="sm" class="text-sky-500" />
            </div>
            <span
              class="text-sm font-bold text-sky-600 group-hover/avatar:text-sky-700 transition-colors"
            >
              {{ activeAgentName }}
            </span>
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm" />
          </div>
        </div>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        CORE MEMORIES
      </p>
    </div>

    <!-- 统计小卡片 -->
    <div class="flex gap-3 mb-4 flex-shrink-0">
      <PCard
        pixel
        hoverable
        padding="sm"
        class="flex-1 flex flex-col items-center cursor-pointer"
        @click="filterType = filterType === 'core' ? 'all' : 'core'"
      >
        <span class="text-xl font-black text-slate-800 font-pixel">{{ stats.core }}</span>
        <span class="text-[10px] font-bold text-slate-400 uppercase font-pixel">核心</span>
      </PCard>
      <PCard
        pixel
        hoverable
        padding="sm"
        class="flex-1 flex flex-col items-center cursor-pointer"
        @click="filterType = filterType === 'episodic' ? 'all' : 'episodic'"
      >
        <span class="text-xl font-black text-slate-800 font-pixel">{{ stats.episodic }}</span>
        <span class="text-[10px] font-bold text-slate-400 uppercase font-pixel">情景</span>
      </PCard>
      <PCard
        pixel
        hoverable
        padding="sm"
        class="flex-1 flex flex-col items-center cursor-pointer"
        @click="filterType = filterType === 'diary' ? 'all' : 'diary'"
      >
        <span class="text-xl font-black text-slate-800 font-pixel">{{ stats.diary }}</span>
        <span class="text-[10px] font-bold text-slate-400 uppercase font-pixel">日记</span>
      </PCard>
      <PCard
        pixel
        hoverable
        padding="sm"
        class="flex-1 flex flex-col items-center cursor-pointer"
        @click="filterType = filterType === 'reflection' ? 'all' : 'reflection'"
      >
        <span class="text-xl font-black text-slate-800 font-pixel">{{ stats.reflection }}</span>
        <span class="text-[10px] font-bold text-slate-400 uppercase font-pixel">反思</span>
      </PCard>
    </div>

    <!-- 工具栏 -->
    <div class="flex gap-2 mb-4 items-center flex-wrap flex-shrink-0">
      <PInput
        v-model="searchQuery"
        placeholder="搜索记忆内容 / 标签..."
        class="flex-1 min-w-[180px] max-w-[300px]"
      />
      <PSelect v-model="filterType" :options="typeOptions" class="w-[140px]" />
      <PDatePicker v-model="filterDate" placeholder="日期筛选" class="w-[150px]" />

      <!-- 视图切换 -->
      <div class="flex border-2 border-slate-200 overflow-hidden">
        <button
          :class="[
            'flex items-center justify-center w-9 h-8 bg-white text-slate-400 border-none cursor-pointer transition-all hover:bg-slate-50 hover:text-sky-500',
            viewMode === 'list' ? 'bg-sky-50 text-sky-600' : '',
          ]"
          title="列表视图"
          @click="switchView('list')"
        >
          <PixelIcon name="list" size="xs" />
        </button>
        <button
          :class="[
            'flex items-center justify-center w-9 h-8 bg-white text-slate-400 border-none border-l border-slate-200 cursor-pointer transition-all hover:bg-slate-50 hover:text-sky-500',
            viewMode === 'graph' ? 'bg-sky-50 text-sky-600' : '',
          ]"
          title="图谱视图"
          @click="switchView('graph')"
        >
          <PixelIcon name="chart" size="xs" />
        </button>
      </div>

      <PButton variant="primary" @click="isImportOpen = true">导入故事</PButton>
    </div>

    <!-- 维护操作栏 -->
    <div class="flex gap-1.5 mb-3 flex-wrap flex-shrink-0">
      <PButton variant="ghost" size="sm" :disabled="isScanningLonely" @click="triggerScanLonely">
        <PixelIcon name="search" size="xs" />
        <span>扫描孤立</span>
      </PButton>
      <PButton
        variant="ghost"
        size="sm"
        :disabled="isRunningMaintenance"
        @click="triggerMaintenance"
      >
        <PixelIcon name="settings" size="xs" />
        <span>维护 / 梦境</span>
      </PButton>
      <PButton variant="ghost" size="sm" @click="triggerReindex">
        <PixelIcon name="refresh" size="xs" />
        <span>重建索引</span>
      </PButton>
    </div>

    <!-- 热门标签 -->
    <div
      v-if="topTags.length > 0"
      class="flex gap-1.5 items-center mb-3 overflow-x-auto flex-shrink-0"
    >
      <span class="text-[10px] font-bold text-slate-400 whitespace-nowrap uppercase font-pixel">
        热门标签:
      </span>
      <button
        v-for="{ tag, count } in topTags"
        :key="tag"
        :class="[
          'text-[10px] font-bold text-slate-400 px-2 py-0.5 border border-slate-200 bg-slate-50 cursor-pointer transition-all whitespace-nowrap hover:border-sky-300 hover:text-sky-500',
          selectedTags.includes(tag) ? 'bg-sky-50 border-sky-300 text-sky-600' : '',
        ]"
        @click="toggleTag(tag)"
      >
        #{{ tag }}
        <span v-if="count > 1" class="text-[9px] opacity-50 ml-0.5">({{ count }})</span>
      </button>
    </div>

    <!-- ═══ 列表模式 ═══ -->
    <template v-if="viewMode === 'list'">
      <div v-if="filteredMemories.length === 0" class="flex-1 flex items-center justify-center">
        <PEmpty description="没有匹配的记忆节点" />
      </div>
      <div v-else class="flex-1 overflow-y-auto flex flex-col gap-2 mem-scrollbar">
        <PCard
          v-for="mem in filteredMemories"
          :key="mem.id"
          pixel
          hoverable
          padding="sm"
          class="cursor-pointer flex flex-col gap-2"
          @click="openDetail(mem)"
        >
          <div class="flex justify-between items-center">
            <div class="flex gap-1.5 items-center flex-wrap">
              <span :class="['text-[10px] font-bold px-2 py-0.5', typeColors[mem.type]]">
                {{ typeLabels[mem.type] }}
              </span>
              <!-- 情感标记 -->
              <span
                v-if="mem.sentiment && mem.sentiment !== 'neutral'"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold border bg-slate-50 sentiment-glow"
                :style="{ borderColor: getSentimentColor(mem.sentiment) }"
              >
                <PixelIcon
                  :name="getSentimentEmoji(mem.sentiment)"
                  size="xs"
                  :style="{ color: getSentimentColor(mem.sentiment) }"
                />
                <span :style="{ color: getSentimentColor(mem.sentiment) }">
                  {{ getSentimentLabel(mem.sentiment) }}
                </span>
              </span>
            </div>
            <span class="text-xs text-yellow-500 tracking-widest">
              {{ importanceDots(mem.importance) }}
            </span>
          </div>
          <p class="text-[13px] text-slate-500 leading-relaxed line-clamp-2">{{ mem.content }}</p>
          <div class="flex justify-between items-center">
            <div class="flex gap-1 flex-wrap">
              <span
                v-for="tag in mem.tags.slice(0, 3)"
                :key="tag"
                class="text-[10px] font-bold text-slate-400 px-1.5 py-0.5 bg-slate-50 border border-slate-200"
              >
                #{{ tag }}
              </span>
              <span
                v-if="mem.tags.length > 3"
                class="text-[10px] font-bold text-sky-500 px-1.5 py-0.5 bg-slate-50 border border-slate-200"
              >
                +{{ mem.tags.length - 3 }}
              </span>
            </div>
            <span class="text-[10px] text-slate-400 whitespace-nowrap font-pixel">
              {{ formatDate(mem.createdAt) }}
            </span>
          </div>
        </PCard>
      </div>
    </template>

    <!-- ═══ 图谱模式 ═══ -->
    <template v-else>
      <div
        v-if="isLoadingGraph"
        class="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 text-sm"
      >
        <PixelIcon name="loader" size="md" />
        <span class="font-pixel">加载图谱中...</span>
      </div>
      <div v-else-if="graphData.nodes.length === 0" class="flex-1 flex items-center justify-center">
        <PEmpty description="暂无关联数据或数据量过少" />
      </div>
      <div v-else class="flex-1 flex gap-3 overflow-hidden">
        <!-- 图谱画布 -->
        <PCard
          pixel
          padding="none"
          class="flex-1 border-2 border-slate-200 bg-slate-50 overflow-hidden relative"
        >
          <VChart :option="chartOption" autoresize class="w-full h-full min-h-[400px]" />
        </PCard>

        <!-- 图例面板 -->
        <PCard pixel padding="sm" class="w-56 flex-shrink-0 overflow-y-auto flex flex-col gap-4">
          <h4 class="flex items-center gap-1.5 text-[13px] font-black text-slate-800 font-pixel">
            <PixelIcon name="chart" size="xs" />
            图谱图例
          </h4>

          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-sky-400 legend-pulse" />
              <span class="text-[11px] font-bold text-slate-500">节点 (Node)</span>
            </div>
            <p class="text-[10px] text-slate-400 leading-relaxed">
              代表独立的记忆片段。颜色代表情感，大小代表重要度。
            </p>
          </div>

          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1.5">
              <span class="w-5 h-0.5 bg-sky-300" />
              <span class="text-[11px] font-bold text-slate-500">连线 (Edge)</span>
            </div>
            <p class="text-[10px] text-slate-400 leading-relaxed">
              代表记忆之间的逻辑关联。线越粗关联越强。
            </p>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-[11px] font-bold text-slate-500">情感 (Sentiment)</span>
            <div class="flex gap-1 flex-wrap mt-1">
              <span
                class="text-[10px] font-bold px-2 py-0.5 border bg-sky-400/15 text-sky-400 border-sky-400/30"
              >
                正面 😊
              </span>
              <span
                class="text-[10px] font-bold px-2 py-0.5 border bg-rose-400/15 text-rose-400 border-rose-400/30"
              >
                负面 😟
              </span>
              <span
                class="text-[10px] font-bold px-2 py-0.5 border bg-slate-400/15 text-slate-400 border-slate-400/30"
              >
                中性 😐
              </span>
            </div>
          </div>

          <div class="pt-3 border-t border-slate-200 flex flex-col gap-1">
            <div class="flex justify-between text-[10px] text-slate-400">
              <span>当前节点</span>
              <span class="font-bold text-slate-500 tabular-nums">
                {{ graphData.nodes.length }}
              </span>
            </div>
            <div class="flex justify-between text-[10px] text-slate-400">
              <span>当前连线</span>
              <span class="font-bold text-slate-500 tabular-nums">
                {{ graphData.edges.length }}
              </span>
            </div>
          </div>
        </PCard>
      </div>
    </template>

    <!-- 详情弹窗 -->
    <PDialog v-model="isDetailOpen" title="记忆详情" width="520px">
      <template v-if="selectedMemory">
        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-3 flex-wrap">
            <span :class="['text-[10px] font-bold px-2 py-0.5', typeColors[selectedMemory.type]]">
              {{ typeLabels[selectedMemory.type] }}
            </span>
            <span class="text-xs text-yellow-500 tracking-widest">
              重要度: {{ selectedMemory.importance }}/10
            </span>
            <span
              v-if="selectedMemory.sentiment && selectedMemory.sentiment !== 'neutral'"
              class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold border bg-slate-50"
              :style="{ borderColor: getSentimentColor(selectedMemory.sentiment) }"
            >
              <PixelIcon
                :name="getSentimentEmoji(selectedMemory.sentiment)"
                size="xs"
                :style="{ color: getSentimentColor(selectedMemory.sentiment) }"
              />
              <span :style="{ color: getSentimentColor(selectedMemory.sentiment) }">
                {{ getSentimentLabel(selectedMemory.sentiment) }}
              </span>
            </span>
          </div>
          <p class="text-sm leading-loose text-slate-800 p-4 bg-slate-50 border border-slate-200">
            {{ selectedMemory.content }}
          </p>
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-bold text-slate-400 min-w-[60px] font-pixel">来源</span>
              <span class="text-xs text-slate-500">{{ selectedMemory.source }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-bold text-slate-400 min-w-[60px] font-pixel">
                创建时间
              </span>
              <span class="text-xs text-slate-500">{{ formatDate(selectedMemory.createdAt) }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] font-bold text-slate-400 min-w-[60px] font-pixel">标签</span>
              <div class="flex gap-1 flex-wrap">
                <span
                  v-for="tag in selectedMemory.tags"
                  :key="tag"
                  class="text-[10px] font-bold text-slate-400 px-1.5 py-0.5 bg-slate-50 border border-slate-200"
                >
                  #{{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <PButton variant="ghost" @click="isDetailOpen = false">关闭</PButton>
        <PButton variant="danger" @click="deleteMemory(selectedMemory!.id)">
          <PixelIcon name="trash" size="xs" />
          删除
        </PButton>
      </template>
    </PDialog>

    <!-- 故事导入弹窗 (P4) -->
    <PDialog v-model="isImportOpen" title="导入故事" width="560px">
      <div class="flex flex-col gap-3">
        <p class="text-xs text-slate-400 leading-relaxed">
          将一段故事、设定或职事粘贴到下方，它会作为情景记忆导入到 Pero 的记忆库中。
        </p>
        <textarea
          v-model="importText"
          class="w-full p-3 border-2 border-slate-200 bg-slate-50 text-slate-800 text-[13px] leading-relaxed resize-y outline-none focus:border-sky-300 font-sans"
          rows="10"
          placeholder="粘贴故事内容..."
        />
      </div>
      <template #footer>
        <PButton variant="ghost" @click="isImportOpen = false">取消</PButton>
        <PButton
          variant="primary"
          :disabled="!importText.trim() || isImporting"
          @click="importStory"
        >
          <PixelIcon name="plus" size="xs" />
          {{ isImporting ? '导入中...' : '导入' }}
        </PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
/* 类型 badge 颜色 — 通过 typeColors 动态绑定 */
.type-core {
  color: #0284c7;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
}

.type-episodic {
  color: #16a34a;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.type-diary {
  color: #d97706;
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.3);
}

.type-reflection {
  color: #db2777;
  background: rgba(236, 72, 153, 0.1);
  border: 1px solid rgba(236, 72, 153, 0.3);
}

/* 情感标记呼吸动画 */
@keyframes sentiment-glow {
  0%,
  100% {
    opacity: 0.85;
  }

  50% {
    opacity: 1;
  }
}

.sentiment-glow {
  animation: sentiment-glow 3s ease-in-out infinite;
}

/* 图例节点脉冲 */
@keyframes legend-pulse {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(1);
  }

  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

.legend-pulse {
  animation: legend-pulse 2s ease-in-out infinite;
}

/* 多行截断 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}

/* 像素风滚动条 */
.mem-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.mem-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
