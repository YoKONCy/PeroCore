<script setup lang="ts">
/**
 * MemoryFilterBar — 记忆档案过滤工作台
 *
 * 第一排：搜索 / 来源 / 状态 / 模式 / 排序 / 刷新
 * 第二排（可折叠）：重要度区间、事件与记录时间范围、实体 facet 多选
 * 底部：当前筛选 chips（可单独移除 / 一键清空）
 */
import { computed, ref } from 'vue'
import type { EventNoteArchiveFacets } from '@infos/shared'
import { PixelIcon, PButton, PInput, PSelect, PSlider } from '../../pixel'
import type {
  ArchiveChips,
  ArchiveOrder,
  ArchiveSort,
  StatusFilter,
} from '../../../composables/dashboard/useMemoryArchive'

const props = defineProps<{
  facets: EventNoteArchiveFacets
  chips: ArchiveChips[]
  total: number
  isLoading: boolean
  agentOptions: Array<{ label: string; value: string }>
}>()

const emit = defineEmits<{
  refresh: []
  clear: []
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })
const agent = defineModel<string>('agent', { required: true })
const channel = defineModel<string>('channel', { required: true })
const status = defineModel<StatusFilter>('status', { required: true })
const mode = defineModel<string>('mode', { required: true })
const importanceMin = defineModel<number>('importanceMin', { required: true })
const importanceMax = defineModel<number>('importanceMax', { required: true })
const tones = defineModel<string[]>('tones', { required: true })
const participants = defineModel<string[]>('participants', { required: true })
const places = defineModel<string[]>('places', { required: true })
const objects = defineModel<string[]>('objects', { required: true })
const topics = defineModel<string[]>('topics', { required: true })
const eventAtFrom = defineModel<string>('eventAtFrom', { required: true })
const eventAtTo = defineModel<string>('eventAtTo', { required: true })
const createdAtFrom = defineModel<string>('createdAtFrom', { required: true })
const createdAtTo = defineModel<string>('createdAtTo', { required: true })
const sort = defineModel<ArchiveSort>('sort', { required: true })
const order = defineModel<ArchiveOrder>('order', { required: true })

const showAdvanced = ref(false)

const channelOptions = computed(() => [
  { label: '全部来源', value: 'all' },
  ...props.facets.channels.map((item) => ({
    label: `${item.value} (${item.count})`,
    value: item.value,
  })),
])

const statusOptions = [
  { label: '活跃', value: 'active' },
  { label: '仅归档', value: 'archived' },
  { label: '全部状态', value: 'all' },
]

const modeOptions = [
  { label: '全部模式', value: 'all' },
  { label: '主动记事', value: 'active' },
  { label: '后台炼化', value: 'background' },
]

const sortOptions = [
  { label: '事件时间', value: 'eventAt' },
  { label: '记录时间', value: 'createdAt' },
  { label: '重要度', value: 'importance' },
]

const orderOptions = [
  { label: '降序', value: 'desc' },
  { label: '升序', value: 'asc' },
]

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

const entitySections = computed(
  () =>
    [
      { key: 'topics', label: '主题', values: props.facets.topics, model: topics },
      {
        key: 'participants',
        label: '人物',
        values: props.facets.participants,
        model: participants,
      },
      { key: 'places', label: '地点', values: props.facets.places, model: places },
      { key: 'objects', label: '物品', values: props.facets.objects, model: objects },
      { key: 'tones', label: '情绪', values: props.facets.tones, model: tones },
    ] as const,
)
</script>

<template>
  <div class="memory-filter">
    <!-- 第一排：高频过滤 -->
    <div class="filter-row">
      <div class="filter-field filter-search">
        <label class="filter-label">
          <span class="filter-dot" />
          搜索
          <span class="filter-label-en">Search</span>
        </label>
        <PInput
          v-model="searchQuery"
          placeholder="叙事 / 主题 / 人物 / 地点 / 物品..."
          class="!text-sm"
        />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          角色
        </label>
        <PSelect v-model="agent" :options="agentOptions" />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          来源
        </label>
        <PSelect v-model="channel" :options="channelOptions" />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          状态
        </label>
        <PSelect v-model="status" :options="statusOptions" />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          模式
        </label>
        <PSelect v-model="mode" :options="modeOptions" />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          排序
        </label>
        <PSelect v-model="sort" :options="sortOptions" />
      </div>

      <div class="filter-field">
        <label class="filter-label">
          <span class="filter-dot" />
          顺序
        </label>
        <PSelect v-model="order" :options="orderOptions" />
      </div>

      <div class="filter-actions">
        <PButton variant="ghost" size="sm" @click="showAdvanced = !showAdvanced">
          <PixelIcon :name="showAdvanced ? 'chevron-up' : 'chevron-down'" size="xs" />
          高级过滤
        </PButton>
        <PButton variant="secondary" size="sm" :loading="isLoading" @click="emit('refresh')">
          <span class="filter-refresh-icon"><PixelIcon name="refresh" size="xs" /></span>
          刷新
        </PButton>
      </div>
    </div>

    <!-- 第二排：高级过滤 -->
    <div v-if="showAdvanced" class="filter-advanced">
      <div class="adv-section">
        <div class="adv-title">重要度区间</div>
        <div class="adv-slider-row">
          <span class="adv-slider-label">最小 {{ importanceMin }}</span>
          <PSlider v-model="importanceMin" :min="0" :max="10" :step="1" class="adv-slider" />
          <span class="adv-slider-value">{{ importanceMin }}</span>
        </div>
        <div class="adv-slider-row">
          <span class="adv-slider-label">最大 {{ importanceMax }}</span>
          <PSlider v-model="importanceMax" :min="0" :max="10" :step="1" class="adv-slider" />
          <span class="adv-slider-value">{{ importanceMax }}</span>
        </div>
      </div>

      <div class="adv-section">
        <div class="adv-title">事件时间范围</div>
        <div class="adv-date-row">
          <input v-model="eventAtFrom" type="date" class="adv-date" />
          <span class="adv-date-sep">~</span>
          <input v-model="eventAtTo" type="date" class="adv-date" />
        </div>
        <div class="adv-title adv-title-gap">记录时间范围</div>
        <div class="adv-date-row">
          <input v-model="createdAtFrom" type="date" class="adv-date" />
          <span class="adv-date-sep">~</span>
          <input v-model="createdAtTo" type="date" class="adv-date" />
        </div>
      </div>

      <div
        v-for="section in entitySections.filter((item) => item.values.length)"
        :key="section.key"
        class="adv-section adv-section-grow"
      >
        <div class="adv-title">{{ section.label }}</div>
        <div class="adv-tags">
          <button
            v-for="facet in section.values"
            :key="facet.value"
            :class="['adv-tag', { 'adv-tag-active': section.model.value.includes(facet.value) }]"
            @click="section.model.value = toggleValue(section.model.value, facet.value)"
          >
            {{ facet.value }}
            <span class="adv-tag-count">{{ facet.count }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Chips 行 -->
    <div v-if="chips.length" class="filter-chips">
      <span class="chips-label">当前筛选</span>
      <button v-for="chip in chips" :key="chip.key" class="chip" @click="chip.remove()">
        {{ chip.label }}
        <PixelIcon name="close" size="xs" class="chip-close" />
      </button>
      <PButton variant="ghost" size="sm" class="chips-clear" @click="emit('clear')">
        清空全部
      </PButton>
      <span class="chips-count">{{ total }} 条结果</span>
    </div>
  </div>
</template>

<style scoped>
.memory-filter {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 14px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 108px;
}

.filter-search {
  flex: 1;
  min-width: 180px;
  max-width: 320px;
}

.filter-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ui-text-tertiary, #94a3b8);
}

.filter-label-en {
  opacity: 0.5;
  font-weight: 400;
}

.filter-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: #0ea5e9;
}

.filter-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding-bottom: 2px;
}

.filter-refresh-icon {
  display: inline-block;
  transition: transform 0.7s;
}

.filter-actions button:hover .filter-refresh-icon {
  transform: rotate(180deg);
}

.filter-advanced {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 14px;
  border: 1px dashed var(--ui-border-default, #e2e8f0);
  background: rgba(148, 163, 184, 0.06);
}

.adv-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 220px;
}

.adv-section-grow {
  flex: 1;
  min-width: 240px;
}

.adv-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text-tertiary, #94a3b8);
}

.adv-title-gap {
  margin-top: 6px;
}

.adv-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.adv-slider-label {
  width: 56px;
  font-size: 10px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.adv-slider {
  flex: 1;
}

.adv-slider-value {
  width: 20px;
  font-size: 11px;
  font-weight: 700;
  font-family: var(--ui-font-mono, monospace);
  color: var(--ui-text-secondary, #64748b);
}

.adv-date-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.adv-date {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--ui-text-primary, #1e293b);
  background: var(--ui-bg-elevated, #fff);
  border: 1px solid var(--ui-border-default, #e2e8f0);
  outline: none;
}

.adv-date:focus {
  border-color: #0ea5e9;
}

.adv-date-sep {
  font-size: 11px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.adv-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow-y: auto;
}

.adv-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  font-size: 11px;
  color: var(--ui-text-secondary, #64748b);
  background: var(--ui-bg-elevated, #fff);
  border: 1px solid var(--ui-border-default, #e2e8f0);
  cursor: pointer;
  transition: all 0.15s;
}

.adv-tag:hover {
  border-color: #0ea5e9;
  color: #0284c7;
}

.adv-tag-active {
  color: #0369a1;
  background: rgba(14, 165, 233, 0.1);
  border-color: #0ea5e9;
  box-shadow: 1px 1px 0 rgba(14, 165, 233, 0.4);
}

.adv-tag-active .adv-tag-count {
  color: #0369a1;
}

.adv-tag-count {
  font-size: 9px;
  font-family: var(--ui-font-mono, monospace);
  color: var(--ui-text-tertiary, #94a3b8);
}

.filter-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.chips-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary, #94a3b8);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #7c3aed;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.35);
  cursor: pointer;
  transition: all 0.15s;
}

.chip:hover {
  background: rgba(139, 92, 246, 0.16);
  border-color: #8b5cf6;
}

.chip-close {
  opacity: 0.6;
}

.chips-clear {
  margin-left: 4px;
}

.chips-count {
  margin-left: auto;
  font-size: 10px;
  font-family: var(--ui-font-mono, monospace);
  color: var(--ui-text-tertiary, #94a3b8);
}
</style>
