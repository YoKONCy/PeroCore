<script setup lang="ts">
/**
 * MemoryInspector — 记忆详情检查器（右侧常驻面板）
 *
 * 事件叙事 / 时间 / 情感 / 实体 / 来源 / 前后事件 / 关系簇 / 原始对话。
 * 取代旧版 PDialog 弹窗，支持连续浏览不遮挡列表。
 */
import { computed, ref } from 'vue'
import type { EventNote, EventNoteDetail } from '@infos/shared'
import { PixelIcon, PButton } from '../../pixel'
import type { EventMemorySource } from '../../../api/modules/memoryApi'

const props = defineProps<{
  selected: EventNoteDetail | null
  detailLoading: boolean
  detailError: string
  source: EventMemorySource | null
  sourceLoading: boolean
  sourceError: string
}>()

const emit = defineEmits<{
  'load-source': []
  select: [note: EventNote]
  archive: [note: EventNote]
}>()

const showSource = ref(false)

const sameEventRelations = computed(
  () => props.selected?.relations.filter((relation) => relation.relation === 'same_event') ?? [],
)

const semanticRelations = computed(
  () => props.selected?.relations.filter((relation) => relation.relation !== 'same_event') ?? [],
)

const relationLabels: Record<string, string> = {
  temporal_next: '时间后继',
  temporal_prev: '时间前驱',
  caused_by: '因果',
  same_event: '同一事件',
  same_topic: '同主题',
  involves_person: '涉及人物',
  involves_place: '涉及地点',
  involves_object: '涉及物品',
}

function relationLabel(relation: string): string {
  return relationLabels[relation] ?? relation
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function otherSide(relation: { sourceId: string; targetId: string }, selfId: string): string {
  return relation.sourceId === selfId ? relation.targetId : relation.sourceId
}

function openSource(): void {
  showSource.value = !showSource.value
  // 每次展开都重新拉取，保证失败后可重试
  if (showSource.value) emit('load-source')
}
</script>

<template>
  <div class="inspector">
    <!-- 空态 -->
    <div v-if="!selected && !detailLoading && !detailError" class="inspector-empty">
      <PixelIcon name="brain" size="3xl" class="inspector-empty-icon" />
      <p class="font-pixel">MEMORY INSPECTOR</p>
      <p class="inspector-empty-hint">在左侧选择一条记忆，查看事件详情、关系与原始对话</p>
    </div>

    <!-- 加载中 -->
    <div v-else-if="detailLoading" class="inspector-empty">
      <PixelIcon name="refresh" size="sm" animation="spin" />
      <p class="inspector-empty-hint">加载事件详情...</p>
    </div>

    <!-- 详情错误 -->
    <div v-else-if="detailError" class="inspector-empty">
      <PixelIcon name="alert" size="sm" />
      <p class="inspector-empty-hint">{{ detailError }}</p>
    </div>

    <!-- 详情主体 -->
    <div v-else-if="selected" class="inspector-body">
      <!-- 叙事 -->
      <section class="panel panel-narrative">
        <p class="narrative-text">{{ selected.narrative }}</p>
        <div v-if="selected.status === 'archived'" class="archive-badge">
          <PixelIcon name="alert" size="xs" />
          该事件已归档，且不再进入对话记忆检索
        </div>
      </section>

      <!-- 基本信息 -->
      <section class="panel">
        <h4 class="panel-title">
          <span class="panel-title-bar" />
          基本信息
        </h4>
        <dl class="info-grid">
          <dt>事件时间</dt>
          <dd>{{ formatTime(selected.eventAt) }}</dd>
          <dt>记录时间</dt>
          <dd>{{ formatTime(selected.createdAt) }}</dd>
          <dt>重要度</dt>
          <dd class="font-pixel">{{ selected.importance }} / 10</dd>
          <dt>情感</dt>
          <dd>
            {{ selected.affect.tones.join('、') || '未标注' }}
            <span class="info-dim">
              · 效价 {{ selected.affect.valence }}/10 · 唤醒 {{ selected.affect.arousal }}/10
            </span>
          </dd>
          <dt>来源</dt>
          <dd>
            {{ selected.origin.channel }}
            <span class="info-dim">
              · {{ selected.origin.mode === 'active' ? '主动记事' : '后台炼化' }}
            </span>
          </dd>
          <dt>对话 Pair</dt>
          <dd>{{ selected.origin.pairIds.length }} 组</dd>
        </dl>
      </section>

      <!-- 实体 -->
      <section class="panel">
        <h4 class="panel-title">
          <span class="panel-title-bar" />
          关联实体
        </h4>
        <div class="entity-groups">
          <div v-if="selected.participants.length" class="entity-group">
            <span class="entity-label">人物</span>
            <div class="entity-tags">
              <span
                v-for="name in selected.participants"
                :key="name"
                class="entity-tag entity-tag-person"
              >
                {{ name }}
              </span>
            </div>
          </div>
          <div v-if="selected.places.length" class="entity-group">
            <span class="entity-label">地点</span>
            <div class="entity-tags">
              <span v-for="name in selected.places" :key="name" class="entity-tag entity-tag-place">
                {{ name }}
              </span>
            </div>
          </div>
          <div v-if="selected.objects.length" class="entity-group">
            <span class="entity-label">物品</span>
            <div class="entity-tags">
              <span
                v-for="name in selected.objects"
                :key="name"
                class="entity-tag entity-tag-object"
              >
                {{ name }}
              </span>
            </div>
          </div>
          <div v-if="selected.topics.length" class="entity-group">
            <span class="entity-label">主题</span>
            <div class="entity-tags">
              <span v-for="name in selected.topics" :key="name" class="entity-tag entity-tag-topic">
                {{ name }}
              </span>
            </div>
          </div>
          <p
            v-if="
              !selected.participants.length &&
              !selected.places.length &&
              !selected.objects.length &&
              !selected.topics.length
            "
            class="entity-empty"
          >
            未标注实体
          </p>
        </div>
      </section>

      <!-- 时间轴导航 -->
      <section class="panel">
        <h4 class="panel-title">
          <span class="panel-title-bar" />
          时间轴
        </h4>
        <div class="timeline-nav">
          <button
            v-if="selected.previous"
            class="timeline-nav-item"
            @click="emit('select', selected.previous)"
          >
            <PixelIcon name="chevron-down" size="xs" class="rotate-90" />
            <span class="timeline-nav-body">
              <span class="timeline-nav-label">前一个事件</span>
              <span class="timeline-nav-text">{{ selected.previous.narrative }}</span>
            </span>
          </button>
          <p v-else class="timeline-nav-empty">已是时间轴上最早的事件</p>

          <button
            v-if="selected.next"
            class="timeline-nav-item"
            @click="emit('select', selected.next)"
          >
            <span class="timeline-nav-body">
              <span class="timeline-nav-label">后一个事件</span>
              <span class="timeline-nav-text">{{ selected.next.narrative }}</span>
            </span>
            <PixelIcon name="chevron-down" size="xs" class="-rotate-90" />
          </button>
          <p v-else class="timeline-nav-empty">已是时间轴上最近的事件</p>
        </div>
      </section>

      <!-- 关系 -->
      <section v-if="sameEventRelations.length || semanticRelations.length" class="panel">
        <h4 class="panel-title">
          <span class="panel-title-bar" />
          事件关系
        </h4>
        <div v-if="sameEventRelations.length" class="relation-group">
          <span class="relation-group-label">同一事件簇</span>
          <div class="relation-list">
            <button
              v-for="relation in sameEventRelations"
              :key="`${relation.sourceId}:${relation.targetId}`"
              class="relation-item relation-item-cluster"
              @click="emit('select', { id: otherSide(relation, selected.id) } as EventNote)"
            >
              <PixelIcon name="link" size="xs" />
              {{ otherSide(relation, selected.id).slice(0, 8) }}…
            </button>
          </div>
        </div>
        <div v-if="semanticRelations.length" class="relation-group">
          <span class="relation-group-label">语义关系</span>
          <div class="relation-list">
            <span
              v-for="relation in semanticRelations"
              :key="`${relation.sourceId}:${relation.relation}:${relation.targetId}`"
              class="relation-item"
              :class="`relation-${relation.relation}`"
            >
              <b>{{ relationLabel(relation.relation) }}</b>
              {{ relation.sourceId === selected.id ? '→' : '←' }}
              {{ otherSide(relation, selected.id).slice(0, 8) }}…
            </span>
          </div>
        </div>
      </section>

      <section v-if="selected.status === 'active'" class="panel archive-action">
        <div>
          <strong>删除这条核心记忆</strong>
          <span>记忆将退出检索，但节点和关系边会完整保留。</span>
        </div>
        <PButton variant="danger" size="sm" @click="emit('archive', selected)">
          <PixelIcon name="trash" size="xs" />
          删除
        </PButton>
      </section>

      <!-- 原始对话 -->
      <section class="panel">
        <div class="source-head">
          <h4 class="panel-title">
            <span class="panel-title-bar" />
            原始对话
          </h4>
          <PButton variant="ghost" size="sm" :loading="sourceLoading" @click="openSource">
            <PixelIcon :name="showSource ? 'chevron-up' : 'chevron-down'" size="xs" />
            {{ showSource ? '收起' : '展开' }}
          </PButton>
        </div>
        <div v-if="showSource" class="source-body">
          <p v-if="sourceError" class="source-error">{{ sourceError }}</p>
          <p v-else-if="sourceLoading" class="source-hint">加载来源对话...</p>
          <p v-else-if="source && !source.available" class="source-hint">
            原文不可用（原始消息可能已被清理）
          </p>
          <div v-else-if="source" class="source-messages">
            <article
              v-for="message in source.messages"
              :key="message.id"
              :class="['source-message', `source-message-${message.role}`]"
            >
              <span class="source-role">{{ message.role }}</span>
              <span class="source-content">{{ message.content }}</span>
            </article>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.inspector-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.inspector-empty-icon {
  opacity: 0.25;
}

.inspector-empty p {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.1em;
}

.inspector-empty-hint {
  max-width: 240px;
  text-align: center;
  line-height: 1.7;
  letter-spacing: 0 !important;
}

.inspector-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.archive-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-color: color-mix(in srgb, var(--ui-danger, #ef4444) 38%, var(--ui-border-subtle));
}
.archive-action div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.archive-action strong {
  color: var(--ui-text-primary);
  font-size: 12px;
}
.archive-action span {
  color: var(--ui-text-tertiary);
  font-size: 10px;
  line-height: 1.5;
}

.panel {
  padding: 12px;
  background: var(--ui-bg-elevated, #fff);
  border: 1px solid var(--ui-border-default, #e2e8f0);
}

.panel-narrative {
  border-left: 3px solid #8b5cf6;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--ui-text-primary, #1e293b);
}

.panel-title-bar {
  width: 3px;
  height: 11px;
  background: #0ea5e9;
}

.narrative-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--ui-text-primary, #1e293b);
  overflow-wrap: anywhere;
}

.archive-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 7px 9px;
  font-size: 11px;
  font-weight: 600;
  color: #b45309;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.35);
}

.info-grid {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 7px 10px;
  margin: 0;
  font-size: 11px;
}

.info-grid dt {
  color: var(--ui-text-tertiary, #94a3b8);
}

.info-grid dd {
  margin: 0;
  color: var(--ui-text-primary, #1e293b);
  overflow-wrap: anywhere;
}

.info-dim {
  color: var(--ui-text-tertiary, #94a3b8);
}

.entity-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.entity-group {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.entity-label {
  flex-shrink: 0;
  width: 30px;
  padding-top: 2px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary, #94a3b8);
}

.entity-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.entity-tag {
  padding: 2px 7px;
  font-size: 10px;
  border: 1px solid;
}

.entity-tag-person {
  color: #db2777;
  border-color: rgba(219, 39, 119, 0.35);
  background: rgba(219, 39, 119, 0.07);
}

.entity-tag-place {
  color: #16a34a;
  border-color: rgba(22, 163, 74, 0.35);
  background: rgba(22, 163, 74, 0.07);
}

.entity-tag-object {
  color: #ea580c;
  border-color: rgba(234, 88, 12, 0.35);
  background: rgba(234, 88, 12, 0.07);
}

.entity-tag-topic {
  color: #0284c7;
  border-color: rgba(2, 132, 199, 0.35);
  background: rgba(2, 132, 199, 0.07);
}

.entity-empty {
  margin: 0;
  font-size: 11px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.timeline-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timeline-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  text-align: left;
  cursor: pointer;
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid var(--ui-border-default, #e2e8f0);
  transition: all 0.15s;
}

.timeline-nav-item:hover {
  border-color: #7dd3fc;
  background: rgba(14, 165, 233, 0.06);
}

.timeline-nav-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.timeline-nav-label {
  font-size: 9px;
  font-weight: 700;
  color: var(--ui-text-tertiary, #94a3b8);
}

.timeline-nav-text {
  font-size: 11px;
  line-height: 1.6;
  color: var(--ui-text-primary, #1e293b);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.timeline-nav-empty {
  margin: 0;
  padding: 4px 2px;
  font-size: 10px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.relation-group {
  margin-bottom: 10px;
}

.relation-group:last-child {
  margin-bottom: 0;
}

.relation-group-label {
  display: block;
  margin-bottom: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--ui-text-tertiary, #94a3b8);
}

.relation-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.relation-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  font-size: 10px;
  font-family: var(--ui-font-mono, monospace);
  color: var(--ui-text-secondary, #64748b);
  background: rgba(148, 163, 184, 0.06);
  border: 1px solid var(--ui-border-default, #e2e8f0);
}

.relation-item b {
  font-family: inherit;
  font-weight: 700;
}

.relation-item-cluster {
  cursor: pointer;
  color: #7c3aed;
  border-color: rgba(139, 92, 246, 0.35);
  background: rgba(139, 92, 246, 0.06);
}

.relation-item-cluster:hover {
  background: rgba(139, 92, 246, 0.12);
}

.relation-temporal_next,
.relation-temporal_prev {
  border-left: 2px solid #64748b;
}

.relation-caused_by {
  border-left: 2px solid #d97706;
}

.relation-same_event {
  border-left: 2px solid #8b5cf6;
}

.relation-same_topic {
  border-left: 2px solid #0ea5e9;
}

.relation-involves_person {
  border-left: 2px solid #db2777;
}

.relation-involves_place {
  border-left: 2px solid #16a34a;
}

.relation-involves_object {
  border-left: 2px solid #ea580c;
}

.source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.source-head .panel-title {
  margin-bottom: 0;
}

.source-body {
  margin-top: 10px;
}

.source-error {
  margin: 0;
  padding: 8px;
  font-size: 11px;
  color: #be123c;
  background: rgba(244, 63, 94, 0.08);
  border: 1px solid rgba(244, 63, 94, 0.3);
}

.source-hint {
  margin: 0;
  font-size: 11px;
  color: var(--ui-text-tertiary, #94a3b8);
}

.source-messages {
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.source-message {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 8px;
  padding: 8px;
  font-size: 11px;
  background: rgba(148, 163, 184, 0.05);
  border: 1px solid var(--ui-border-default, #e2e8f0);
}

.source-role {
  font-weight: 700;
  text-transform: uppercase;
  color: var(--ui-text-tertiary, #94a3b8);
}

.source-message-user .source-role {
  color: #0284c7;
}

.source-message-assistant .source-role {
  color: #7c3aed;
}

.source-content {
  line-height: 1.65;
  color: var(--ui-text-primary, #1e293b);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.rotate-90 {
  transform: rotate(90deg);
}

.-rotate-90 {
  transform: rotate(-90deg);
}
</style>
