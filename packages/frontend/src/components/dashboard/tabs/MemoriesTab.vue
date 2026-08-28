<script setup lang="ts">
/**
 * MemoriesTab — 核心记忆 Tab
 *
 * 档案工作台布局：统计头 + 过滤工作台 + (列表|图谱) × 常驻详情检查器。
 * 数据全部走后端 archiveQuery / graphSnapshot，前端不做全量拉取。
 */
import { computed, onMounted, watch } from 'vue'
import type { EventNote } from '@infos/shared'
import { PixelIcon, PButton, PCard } from '../../pixel'
import { useDashboardContext } from '../../../composables/dashboard'
import { useMemoryArchive } from '../../../composables/dashboard/useMemoryArchive'
import { useNotificationStore } from '../../../stores/useNotificationStore'
import { useAgentStore } from '../../../stores/useAgentStore'
import MemoryFilterBar from '../memories/MemoryFilterBar.vue'
import MemoryList from '../memories/MemoryList.vue'
import MemoryInspector from '../memories/MemoryInspector.vue'
import MemoryGraphView from '../memories/MemoryGraphView.vue'

const ctx = useDashboardContext()
const notif = useNotificationStore()
const agentStore = useAgentStore()
const view = ref<'list' | 'graph'>('list')

const archive = useMemoryArchive(
  () => ctx.activeAgentId.value || 'pero',
  () => agentStore.enabledAgents.map((agent) => agent.id),
)
const agentOptions = computed(() => [
  { label: '全部角色', value: 'all' },
  ...agentStore.enabledAgents.map((agent) => ({ label: agent.name || agent.id, value: agent.id })),
])

const graphIncludeArchived = computed(() => archive.status.value !== 'active')

async function loadArchive(): Promise<void> {
  try {
    await archive.fetchArchive()
  } catch (error) {
    notif.toast('记忆档案加载失败：' + (error as Error).message, 'error')
  }
}

async function loadGraph(): Promise<void> {
  await archive.fetchGraph(graphIncludeArchived.value)
}

/** 搜索防抖 */
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => archive.searchQuery.value,
  () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(loadArchive, 300)
  },
)

/** 除搜索外的全部过滤 + 分页变化 → 立即重载 */
watch(
  () => [
    archive.agent.value,
    archive.channel.value,
    archive.status.value,
    archive.mode.value,
    archive.importanceMin.value,
    archive.importanceMax.value,
    archive.tones.value,
    archive.participants.value,
    archive.places.value,
    archive.objects.value,
    archive.topics.value,
    archive.eventAtFrom.value,
    archive.eventAtTo.value,
    archive.createdAtFrom.value,
    archive.createdAtTo.value,
    archive.sort.value,
    archive.order.value,
    archive.page.value,
  ],
  loadArchive,
)

/** 角色或全局刷新 → 列表与图谱一起重置 */
watch(
  () => [ctx.activeAgentId.value, ctx.refreshKey.value],
  () => {
    archive.clearFilters()
    archive.page.value = 1
    void loadArchive()
    if (view.value === 'graph') void loadGraph()
  },
)

watch(
  () => [archive.agent.value, archive.status.value],
  () => {
    if (view.value === 'graph') void loadGraph()
  },
)

watch(view, (next) => {
  if (next === 'graph' && !archive.graph.value.nodes.length) void loadGraph()
})

onMounted(loadArchive)

function onSelectNote(note: EventNote): void {
  void archive.selectNote(note)
}

const statBadges = computed(() => [
  { label: '活跃', value: archive.stats.value.active, tone: 'sky' },
  { label: '归档', value: archive.stats.value.archived, tone: 'slate' },
  { label: '平均重要度', value: archive.stats.value.averageImportance, tone: 'violet' },
  { label: '主题', value: archive.stats.value.topicCount, tone: 'emerald' },
])
</script>

<template>
  <div class="memories-page">
    <!-- 档案头 -->
    <header class="archive-head">
      <div class="archive-title-wrap">
        <h2 class="archive-title font-pixel">
          <PixelIcon name="brain" size="md" class="archive-title-icon" />
          核心记忆
        </h2>
        <p class="archive-subtitle">长期记忆档案 · LONG-TERM MEMORY ARCHIVE</p>
      </div>

      <div class="archive-stats">
        <div
          v-for="badge in statBadges"
          :key="badge.label"
          :class="['stat-badge', `stat-${badge.tone}`]"
        >
          <span class="stat-value font-pixel">{{ badge.value }}</span>
          <span class="stat-label">{{ badge.label }}</span>
        </div>
      </div>

      <div class="archive-view-switch">
        <PButton size="sm" :variant="view === 'list' ? 'primary' : 'ghost'" @click="view = 'list'">
          <PixelIcon name="list" size="xs" />
          档案列表
        </PButton>
        <PButton
          size="sm"
          :variant="view === 'graph' ? 'primary' : 'ghost'"
          @click="view = 'graph'"
        >
          <PixelIcon name="link" size="xs" />
          关系图谱
        </PButton>
      </div>
    </header>

    <!-- 过滤工作台 -->
    <PCard pixel padding="sm" overflow-visible class="archive-filter-card">
      <MemoryFilterBar
        v-model:search-query="archive.searchQuery.value"
        v-model:agent="archive.agent.value"
        v-model:channel="archive.channel.value"
        v-model:status="archive.status.value"
        v-model:mode="archive.mode.value"
        v-model:importance-min="archive.importanceMin.value"
        v-model:importance-max="archive.importanceMax.value"
        v-model:tones="archive.tones.value"
        v-model:participants="archive.participants.value"
        v-model:places="archive.places.value"
        v-model:objects="archive.objects.value"
        v-model:topics="archive.topics.value"
        v-model:event-at-from="archive.eventAtFrom.value"
        v-model:event-at-to="archive.eventAtTo.value"
        v-model:created-at-from="archive.createdAtFrom.value"
        v-model:created-at-to="archive.createdAtTo.value"
        v-model:sort="archive.sort.value"
        v-model:order="archive.order.value"
        :facets="archive.facets.value"
        :agent-options="agentOptions"
        :chips="archive.chips.value"
        :total="archive.total.value"
        :is-loading="archive.isLoading.value"
        @refresh="loadArchive"
        @clear="archive.clearFilters()"
      />
    </PCard>

    <!-- 主区域：左内容 + 右检查器 -->
    <div class="archive-main">
      <div class="archive-content">
        <MemoryList
          v-if="view === 'list'"
          :items="archive.items.value"
          :selected-id="archive.selectedId.value"
          :is-loading="archive.isLoading.value"
          :page="archive.page.value"
          :page-count="archive.pageCount.value"
          :page-size="archive.pageSize.value"
          :total="archive.total.value"
          @select="onSelectNote"
          @page="archive.goToPage"
        />
        <MemoryGraphView
          v-else
          :nodes="archive.graph.value.nodes"
          :edges="archive.graph.value.edges"
          :selected-id="archive.selectedId.value"
          :loading="archive.graphLoading.value"
          :error="archive.graphError.value"
          :truncated="archive.graph.value.truncated"
          @select="onSelectNote"
        />
      </div>

      <aside class="archive-inspector">
        <MemoryInspector
          :selected="archive.selected.value"
          :detail-loading="archive.detailLoading.value"
          :detail-error="archive.detailError.value"
          :source="archive.source.value"
          :source-loading="archive.sourceLoading.value"
          :source-error="archive.sourceError.value"
          @load-source="archive.loadSource"
          @select="onSelectNote"
        />
      </aside>
    </div>
  </div>
</template>

<script lang="ts">
import { ref } from 'vue'
export default { name: 'MemoriesTab' }
</script>

<style scoped>
.memories-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 24px;
  gap: 14px;
  overflow: hidden;
  color: var(--ui-text-primary);
}

/* ── 头部 ── */
.archive-head {
  display: flex;
  align-items: center;
  gap: 20px;
  flex-shrink: 0;
}

.archive-title-wrap {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.archive-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 22px;
  font-weight: 900;
  color: var(--ui-text-primary);
}

.archive-title-icon {
  color: var(--ui-accent-purple, #8b5cf6);
}

.archive-subtitle {
  margin: 0 0 0 2px;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ui-text-tertiary);
}

.archive-stats {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.stat-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 64px;
  padding: 6px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
}

.stat-value {
  font-size: 15px;
  font-weight: 700;
}

.stat-label {
  font-size: 9px;
  color: var(--ui-text-tertiary);
}

.stat-sky .stat-value {
  color: #0284c7;
}
.stat-slate .stat-value {
  color: #64748b;
}
.stat-violet .stat-value {
  color: #7c3aed;
}
.stat-emerald .stat-value {
  color: #059669;
}

.archive-view-switch {
  display: flex;
  gap: 6px;
}

/* ── 过滤卡片 ── */
.archive-filter-card {
  position: relative;
  z-index: 100;
  flex-shrink: 0;
  overflow: visible;
}

.archive-filter-card :deep(.p-card-body) {
  overflow: visible;
}

/* ── 主区域 ── */
.archive-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

.archive-content {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px;
  background: var(--ui-bg-primary);
  border: 1px solid var(--ui-border-default);
}

.archive-inspector {
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px;
  background: var(--ui-bg-primary);
  border: 1px solid var(--ui-border-default);
  border-top: 3px solid var(--ui-accent-purple, #8b5cf6);
}

@media (max-width: 1100px) {
  .archive-main {
    grid-template-columns: 1fr;
  }
  .archive-inspector {
    max-height: 320px;
  }
}

@media (max-width: 760px) {
  .memories-page {
    padding: 14px;
  }
  .archive-head {
    flex-wrap: wrap;
  }
  .archive-stats {
    margin-left: 0;
  }
}
</style>
