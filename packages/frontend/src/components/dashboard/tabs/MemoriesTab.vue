<script setup lang="ts">
/**
 * MemoriesTab — 核心记忆 Tab (F1-2)
 *
 * 记忆节点列表 + 搜索 + 类型筛选 + 详情弹窗
 */
import { PixelIcon, PInput, PButton, PSelect, PDialog, PBadge, PEmpty } from '../../pixel'
import { useMemories } from '../../../composables/dashboard/useMemories'

const {
  searchQuery, filterType,
  typeOptions, typeLabels, typeColors,
  filteredMemories, stats,
  selectedMemory, isDetailOpen,
  openDetail, deleteMemory, formatDate,
} = useMemories()

function importanceDots(n: number): string {
  const filled = Math.min(n, 10)
  return '★'.repeat(Math.round(filled / 2)) + '☆'.repeat(5 - Math.round(filled / 2))
}
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
      <div class="mem-stat" @click="filterType = filterType === 'reflection' ? 'all' : 'reflection'">
        <span class="mem-stat-num">{{ stats.reflection }}</span>
        <span class="mem-stat-label">反思</span>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="mem-toolbar">
      <PInput v-model="searchQuery" placeholder="搜索记忆内容 / 标签..." class="mem-search" />
      <PSelect v-model="filterType" :options="typeOptions" class="mem-filter" />
      <PButton variant="primary">导入故事</PButton>
    </div>

    <!-- 记忆列表 -->
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
          <span :class="['mem-type-badge', typeColors[mem.type]]">{{ typeLabels[mem.type] }}</span>
          <span class="mem-importance">{{ importanceDots(mem.importance) }}</span>
        </div>
        <p class="mem-item-content">{{ mem.content }}</p>
        <div class="mem-item-footer">
          <div class="mem-tags">
            <span v-for="tag in mem.tags.slice(0, 3)" :key="tag" class="mem-tag">#{{ tag }}</span>
            <span v-if="mem.tags.length > 3" class="mem-tag mem-tag-more">+{{ mem.tags.length - 3 }}</span>
          </div>
          <span class="mem-date">{{ formatDate(mem.createdAt) }}</span>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <PDialog v-model="isDetailOpen" title="记忆详情" width="520px">
      <template v-if="selectedMemory">
        <div class="mem-detail">
          <div class="mem-detail-meta">
            <span :class="['mem-type-badge', typeColors[selectedMemory.type]]">{{ typeLabels[selectedMemory.type] }}</span>
            <span class="mem-importance">重要度: {{ selectedMemory.importance }}/10</span>
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
                <span v-for="tag in selectedMemory.tags" :key="tag" class="mem-tag">#{{ tag }}</span>
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
  </div>
</template>

<style scoped>
.tab-memories { padding: 32px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.tab-header { margin-bottom: 16px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; color: var(--color-text-primary); }
.tab-count { font-size: 14px; font-weight: 700; color: var(--color-blue-500); background: var(--color-blue-50, rgba(56,189,248,0.1)); padding: 2px 10px; }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }

/* 统计 */
.mem-stats { display: flex; gap: 12px; margin-bottom: 16px; }
.mem-stat {
  display: flex; flex-direction: column; align-items: center; padding: 8px 16px;
  border: 2px solid var(--color-border); background: var(--color-bg-primary);
  cursor: pointer; transition: all 0.15s; flex: 1;
}
.mem-stat:hover { border-color: var(--color-blue-300); transform: translateY(-1px); }
.mem-stat-num { font-size: 20px; font-weight: 800; color: var(--color-text-primary); }
.mem-stat-label { font-size: 10px; font-weight: 700; color: var(--color-text-muted); text-transform: uppercase; }

/* 工具栏 */
.mem-toolbar { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.mem-search { flex: 1; max-width: 300px; }
.mem-filter { width: 160px; }

/* 列表 */
.mem-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.mem-list::-webkit-scrollbar { width: 4px; }
.mem-list::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

.mem-item {
  padding: 16px; border: 2px solid var(--color-border); background: var(--color-bg-primary);
  cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 8px;
}
.mem-item:hover { border-color: var(--color-blue-200); transform: translateX(2px); }

.mem-item-header { display: flex; justify-content: space-between; align-items: center; }
.mem-type-badge { font-size: 10px; font-weight: 700; padding: 2px 8px; }
.type-core { color: var(--color-blue-600); background: var(--color-blue-50, rgba(56,189,248,0.1)); border: 1px solid var(--color-blue-200); }
.type-episodic { color: var(--color-green-600, #16a34a); background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); }
.type-diary { color: var(--color-yellow-600, #d97706); background: rgba(234,179,8,0.1); border: 1px solid rgba(234,179,8,0.3); }
.type-reflection { color: var(--color-pink-600, #db2777); background: rgba(236,72,153,0.1); border: 1px solid rgba(236,72,153,0.3); }
.mem-importance { font-size: 12px; color: var(--color-yellow-500, #eab308); letter-spacing: 2px; }

.mem-item-content { font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.mem-item-footer { display: flex; justify-content: space-between; align-items: center; }
.mem-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.mem-tag { font-size: 10px; font-weight: 700; color: var(--color-text-muted); padding: 1px 6px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); }
.mem-tag-more { color: var(--color-blue-500); }
.mem-date { font-size: 10px; color: var(--color-text-muted); white-space: nowrap; }

.mem-empty { flex: 1; display: flex; align-items: center; justify-content: center; }

/* 详情 */
.mem-detail { display: flex; flex-direction: column; gap: 16px; }
.mem-detail-meta { display: flex; align-items: center; gap: 12px; }
.mem-detail-content { font-size: 14px; line-height: 1.8; color: var(--color-text-primary); padding: 16px; background: var(--color-bg-secondary); border: 1px solid var(--color-border); }
.mem-detail-info { display: flex; flex-direction: column; gap: 8px; }
.mem-detail-row { display: flex; align-items: center; gap: 8px; }
.mem-detail-label { font-size: 11px; font-weight: 700; color: var(--color-text-muted); min-width: 60px; }
.mem-detail-value { font-size: 12px; color: var(--color-text-secondary); }
</style>
