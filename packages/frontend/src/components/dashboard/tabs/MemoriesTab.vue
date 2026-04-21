<script setup lang="ts">
/**
 * MemoriesTab — 核心记忆 Tab (F1-2)
 *
 * 记忆节点列表 + 搜索 + 类型筛选 + 日期筛选 + 情感标记
 * + 图谱视图 (vue-echarts) + 详情弹窗 + 维护操作
 *
 * 图谱 / 日期 / 情感三大 UI 增强
 */
import { computed, watch } from 'vue'
import { PixelIcon, PInput, PButton, PSelect, PDialog, PEmpty } from '../../pixel'
import PDatePicker from '../../pixel/PDatePicker.vue'
import { useMemories } from '../../../composables/dashboard/useMemories'
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
  isDreaming,
  triggerMaintenance,
  triggerScanLonely,
  triggerDream,
  triggerReindex,
  // 故事导入
  isImportOpen,
  importText,
  isImporting,
  importStory,
  // 操作
  fetchMemories,
} = useMemories()

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
  <div class="tab-memories">
    <div class="tab-header">
      <h2 class="tab-title">
        <PixelIcon name="brain" size="md" />
        <span>核心记忆</span>
        <span class="tab-count">{{ stats.total }}</span>
      </h2>
      <p class="tab-subtitle">CORE MEMORIES</p>
    </div>

    <!-- 统计小卡片 -->
    <div class="mem-stats">
      <div class="mem-stat" @click="filterType = filterType === 'core' ? 'all' : 'core'">
        <span class="mem-stat-num">{{ stats.core }}</span>
        <span class="mem-stat-label">核心</span>
      </div>
      <div class="mem-stat" @click="filterType = filterType === 'episodic' ? 'all' : 'episodic'">
        <span class="mem-stat-num">{{ stats.episodic }}</span>
        <span class="mem-stat-label">情景</span>
      </div>
      <div class="mem-stat" @click="filterType = filterType === 'diary' ? 'all' : 'diary'">
        <span class="mem-stat-num">{{ stats.diary }}</span>
        <span class="mem-stat-label">日记</span>
      </div>
      <div
        class="mem-stat"
        @click="filterType = filterType === 'reflection' ? 'all' : 'reflection'"
      >
        <span class="mem-stat-num">{{ stats.reflection }}</span>
        <span class="mem-stat-label">反思</span>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="mem-toolbar">
      <PInput v-model="searchQuery" placeholder="搜索记忆内容 / 标签..." class="mem-search" />
      <PSelect v-model="filterType" :options="typeOptions" class="mem-filter" />
      <PDatePicker v-model="filterDate" placeholder="日期筛选" class="mem-date-picker" />

      <!-- 视图切换 -->
      <div class="mem-view-switcher">
        <button
          :class="['mem-view-btn', viewMode === 'list' ? 'mem-view-active' : '']"
          title="列表视图"
          @click="switchView('list')"
        >
          <PixelIcon name="list" size="xs" />
        </button>
        <button
          :class="['mem-view-btn', viewMode === 'graph' ? 'mem-view-active' : '']"
          title="图谱视图"
          @click="switchView('graph')"
        >
          <PixelIcon name="chart" size="xs" />
        </button>
      </div>

      <PButton variant="primary" @click="isImportOpen = true">导入故事</PButton>
    </div>

    <!-- 维护操作栏 -->
    <div class="mem-actions">
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
        <span>维护</span>
      </PButton>
      <PButton variant="ghost" size="sm" :disabled="isDreaming" @click="triggerDream">
        <PixelIcon name="sparkle" size="xs" />
        <span>梦境</span>
      </PButton>
      <PButton variant="ghost" size="sm" @click="triggerReindex">
        <PixelIcon name="refresh" size="xs" />
        <span>重建索引</span>
      </PButton>
    </div>

    <!-- 热门标签 -->
    <div v-if="topTags.length > 0" class="mem-tag-bar">
      <span class="mem-tag-bar-label">热门标签:</span>
      <button
        v-for="{ tag, count } in topTags"
        :key="tag"
        :class="['mem-tag-filter', selectedTags.includes(tag) ? 'mem-tag-active' : '']"
        @click="toggleTag(tag)"
      >
        #{{ tag }}
        <span v-if="count > 1" class="mem-tag-count">({{ count }})</span>
      </button>
    </div>

    <!-- ═══ 列表模式 ═══ -->
    <template v-if="viewMode === 'list'">
      <div v-if="filteredMemories.length === 0" class="mem-empty">
        <PEmpty description="没有匹配的记忆节点" />
      </div>
      <div v-else class="mem-list">
        <div
          v-for="mem in filteredMemories"
          :key="mem.id"
          class="mem-item"
          @click="openDetail(mem)"
        >
          <div class="mem-item-header">
            <div class="mem-item-badges">
              <span :class="['mem-type-badge', typeColors[mem.type]]">
                {{ typeLabels[mem.type] }}
              </span>
              <!-- 情感标记 (对齐 v1) -->
              <span
                v-if="mem.sentiment && mem.sentiment !== 'neutral'"
                class="mem-sentiment-badge"
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
            <span class="mem-importance">{{ importanceDots(mem.importance) }}</span>
          </div>
          <p class="mem-item-content">{{ mem.content }}</p>
          <div class="mem-item-footer">
            <div class="mem-tags">
              <span v-for="tag in mem.tags.slice(0, 3)" :key="tag" class="mem-tag">#{{ tag }}</span>
              <span v-if="mem.tags.length > 3" class="mem-tag mem-tag-more">
                +{{ mem.tags.length - 3 }}
              </span>
            </div>
            <span class="mem-date">{{ formatDate(mem.createdAt) }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- ═══ 图谱模式 ═══ -->
    <template v-else>
      <div v-if="isLoadingGraph" class="mem-graph-loading">
        <PixelIcon name="loader" size="md" />
        <span>加载图谱中...</span>
      </div>
      <div v-else-if="graphData.nodes.length === 0" class="mem-empty">
        <PEmpty description="暂无关联数据或数据量过少" />
      </div>
      <div v-else class="mem-graph-layout">
        <!-- 图谱画布 -->
        <div class="mem-graph-canvas">
          <VChart :option="chartOption" autoresize class="mem-echart" />
        </div>

        <!-- 图例面板 -->
        <div class="mem-graph-legend">
          <h4 class="mem-legend-title">
            <PixelIcon name="chart" size="xs" />
            图谱图例
          </h4>

          <div class="mem-legend-section">
            <div class="mem-legend-item">
              <span class="mem-legend-dot mem-legend-dot-pulse" />
              <span class="mem-legend-label">节点 (Node)</span>
            </div>
            <p class="mem-legend-desc">代表独立的记忆片段。颜色代表情感，大小代表重要度。</p>
          </div>

          <div class="mem-legend-section">
            <div class="mem-legend-item">
              <span class="mem-legend-line" />
              <span class="mem-legend-label">连线 (Edge)</span>
            </div>
            <p class="mem-legend-desc">代表记忆之间的逻辑关联。线越粗关联越强。</p>
          </div>

          <div class="mem-legend-section">
            <span class="mem-legend-label">情感 (Sentiment)</span>
            <div class="mem-legend-sentiments">
              <span
                class="mem-legend-sent"
                style="
                  background: rgba(56, 189, 248, 0.15);
                  color: #38bdf8;
                  border-color: rgba(56, 189, 248, 0.3);
                "
                >正面 😊</span
              >
              <span
                class="mem-legend-sent"
                style="
                  background: rgba(251, 113, 133, 0.15);
                  color: #fb7185;
                  border-color: rgba(251, 113, 133, 0.3);
                "
                >负面 😟</span
              >
              <span
                class="mem-legend-sent"
                style="
                  background: rgba(148, 163, 184, 0.15);
                  color: #94a3b8;
                  border-color: rgba(148, 163, 184, 0.3);
                "
                >中性 😐</span
              >
            </div>
          </div>

          <div class="mem-legend-stats">
            <div class="mem-legend-stat-row">
              <span>当前节点</span>
              <span class="mem-legend-stat-val">{{ graphData.nodes.length }}</span>
            </div>
            <div class="mem-legend-stat-row">
              <span>当前连线</span>
              <span class="mem-legend-stat-val">{{ graphData.edges.length }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 详情弹窗 -->
    <PDialog v-model="isDetailOpen" title="记忆详情" width="520px">
      <template v-if="selectedMemory">
        <div class="mem-detail">
          <div class="mem-detail-meta">
            <span :class="['mem-type-badge', typeColors[selectedMemory.type]]">
              {{ typeLabels[selectedMemory.type] }}
            </span>
            <span class="mem-importance">重要度: {{ selectedMemory.importance }}/10</span>
            <span
              v-if="selectedMemory.sentiment && selectedMemory.sentiment !== 'neutral'"
              class="mem-sentiment-badge"
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
          <p class="mem-detail-content">{{ selectedMemory.content }}</p>
          <div class="mem-detail-info">
            <div class="mem-detail-row">
              <span class="mem-detail-label">来源</span>
              <span class="mem-detail-value">{{ selectedMemory.source }}</span>
            </div>
            <div class="mem-detail-row">
              <span class="mem-detail-label">创建时间</span>
              <span class="mem-detail-value">{{ formatDate(selectedMemory.createdAt) }}</span>
            </div>
            <div class="mem-detail-row">
              <span class="mem-detail-label">标签</span>
              <div class="mem-tags">
                <span v-for="tag in selectedMemory.tags" :key="tag" class="mem-tag">
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
      <div class="mem-import">
        <p class="mem-import-hint">
          将一段故事、设定或职事粘贴到下方，它会作为情景记忆导入到 Pero 的记忆库中。
        </p>
        <textarea
          v-model="importText"
          class="mem-import-textarea"
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
.tab-memories {
  padding: 32px;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.tab-header {
  margin-bottom: 16px;
}
.tab-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.tab-count {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-sky-500);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
  padding: 2px 10px;
}
.tab-subtitle {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
  margin-top: 4px;
  margin-left: 36px;
}

/* ── 统计 ── */
.mem-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.mem-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 16px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  cursor: pointer;
  transition: all 0.15s;
  flex: 1;
}
.mem-stat:hover {
  border-color: var(--color-sky-light);
  transform: translateY(-1px);
}
.mem-stat-num {
  font-size: 20px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.mem-stat-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

/* ── 工具栏 ── */
.mem-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  align-items: center;
  flex-wrap: wrap;
}
.mem-search {
  flex: 1;
  min-width: 180px;
  max-width: 300px;
}
.mem-filter {
  width: 140px;
}
.mem-date-picker {
  width: 150px;
}

/* ── 视图切换器 ── */
.mem-view-switcher {
  display: flex;
  border: 2px solid var(--color-border);
  overflow: hidden;
}
.mem-view-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  background: var(--color-bg-primary);
  color: var(--color-text-muted);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}
.mem-view-btn:hover {
  background: var(--color-bg-secondary);
  color: var(--color-sky-500);
}
.mem-view-active {
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
  color: var(--color-sky-shadow);
}
.mem-view-btn + .mem-view-btn {
  border-left: 1px solid var(--color-border);
}

/* ── 列表 ── */
.mem-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mem-list::-webkit-scrollbar {
  width: 4px;
}
.mem-list::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.mem-item {
  padding: 16px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mem-item:hover {
  border-color: var(--color-sky-light);
  transform: translateX(2px);
}

.mem-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mem-item-badges {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.mem-type-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
}
.type-core {
  color: var(--color-sky-shadow);
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
  border: 1px solid var(--color-sky-light);
}
.type-episodic {
  color: var(--color-emerald-shadow, #16a34a);
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.type-diary {
  color: var(--color-yellow-600, #d97706);
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.3);
}
.type-reflection {
  color: var(--color-pink-shadow, #db2777);
  background: rgba(236, 72, 153, 0.1);
  border: 1px solid rgba(236, 72, 153, 0.3);
}

/* ── 情感标记 ── */
.mem-sentiment-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid;
  background: var(--color-bg-secondary);
  animation: sentiment-glow 3s ease-in-out infinite;
}
@keyframes sentiment-glow {
  0%,
  100% {
    opacity: 0.85;
  }
  50% {
    opacity: 1;
  }
}

.mem-importance {
  font-size: 12px;
  color: var(--color-yellow-500, #eab308);
  letter-spacing: 2px;
}

.mem-item-content {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mem-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mem-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.mem-tag {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  padding: 1px 6px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
}
.mem-tag-more {
  color: var(--color-sky-500);
}
.mem-date {
  font-size: 10px;
  color: var(--color-text-muted);
  white-space: nowrap;
}

.mem-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── 图谱模式 ── */
.mem-graph-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 13px;
}
.mem-graph-layout {
  flex: 1;
  display: flex;
  gap: 12px;
  overflow: hidden;
}
.mem-graph-canvas {
  flex: 1;
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  overflow: hidden;
  position: relative;
}
.mem-echart {
  width: 100%;
  height: 100%;
  min-height: 400px;
}

/* ── 图例面板 ── */
.mem-graph-legend {
  width: 220px;
  flex-shrink: 0;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mem-legend-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.mem-legend-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mem-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mem-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-sky-hover);
}
.mem-legend-dot-pulse {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
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
.mem-legend-line {
  width: 20px;
  height: 2px;
  background: var(--color-sky-light);
}
.mem-legend-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.mem-legend-desc {
  font-size: 10px;
  color: var(--color-text-muted);
  line-height: 1.5;
}
.mem-legend-sentiments {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.mem-legend-sent {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 8px;
  border: 1px solid;
}
.mem-legend-stats {
  padding-top: 12px;
  border-top: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mem-legend-stat-row {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--color-text-muted);
}
.mem-legend-stat-val {
  font-weight: 700;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── 详情 ── */
.mem-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mem-detail-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.mem-detail-content {
  font-size: 14px;
  line-height: 1.8;
  color: var(--color-text-primary);
  padding: 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
}
.mem-detail-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mem-detail-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mem-detail-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  min-width: 60px;
}
.mem-detail-value {
  font-size: 12px;
  color: var(--color-text-secondary);
}

/* ── 维护操作栏 ── */
.mem-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

/* ── 标签筛选栏 ── */
.mem-tag-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 12px;
  overflow-x: auto;
  flex-shrink: 0;
}
.mem-tag-bar::-webkit-scrollbar {
  height: 2px;
}
.mem-tag-bar::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
.mem-tag-bar-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  white-space: nowrap;
  text-transform: uppercase;
}
.mem-tag-filter {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}
.mem-tag-filter:hover {
  border-color: var(--color-sky-light);
  color: var(--color-sky-500);
}
.mem-tag-active {
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
  border-color: var(--color-sky-hover);
  color: var(--color-sky-shadow);
}
.mem-tag-count {
  font-size: 9px;
  opacity: 0.5;
  margin-left: 2px;
}

/* ── 故事导入 ── */
.mem-import {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mem-import-hint {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}
.mem-import-textarea {
  width: 100%;
  padding: 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.mem-import-textarea:focus {
  border-color: var(--color-sky-hover);
}
</style>
