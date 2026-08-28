<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { FactArchiveObject, FactArchiveRecord, FactArchiveResult } from '@infos/shared'
import { PixelIcon, PButton } from '../../pixel'
import { knowledgeApi } from '../../../api/modules/knowledgeApi'
import { logger } from '../../../lib/logger'

const section = ref<'facts' | 'documents'>('facts')
const loading = ref(false)
const error = ref('')
const query = ref('')
const archive = ref<FactArchiveResult>({
  items: [],
  total: 0,
  stats: { objectCount: 0, activeFactCount: 0, historicalFactCount: 0 },
})
const selectedId = ref<string | null>(null)
const expandedFacts = ref(new Set<string>())
const historyOpen = ref(false)
let queryTimer: ReturnType<typeof setTimeout> | null = null

const selected = computed<FactArchiveObject | null>(
  () => archive.value.items.find((item) => item.objectId === selectedId.value) ?? null,
)

async function loadFacts(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await knowledgeApi.facts(query.value)
    if (response.data) archive.value = response.data
    if (!selected.value) selectedId.value = archive.value.items[0]?.objectId ?? null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '事实库读取失败'
    logger.error('KnowledgeTab', '读取事实库失败', cause)
  } finally {
    loading.value = false
  }
}

function toggleFact(id: string): void {
  const next = new Set(expandedFacts.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedFacts.value = next
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function confidenceLabel(value?: number): string {
  if (value === undefined) return '未标注'
  return `${Math.round(value <= 1 ? value * 100 : value)}%`
}

function replacementFor(fact: FactArchiveRecord): FactArchiveRecord | undefined {
  return selected.value?.activeFacts.find((item) => item.id === fact.supersededBy)
}

watch(query, () => {
  if (queryTimer) clearTimeout(queryTimer)
  queryTimer = setTimeout(() => void loadFacts(), 260)
})

watch(selectedId, () => {
  expandedFacts.value = new Set()
  historyOpen.value = false
})

onMounted(loadFacts)
</script>

<template>
  <div class="knowledge-page">
    <header class="knowledge-head">
      <div>
        <h2 class="font-pixel">
          <PixelIcon name="database" size="md" />
          知识库
        </h2>
        <p>共享事实与外部资料 · SHARED KNOWLEDGE ARCHIVE</p>
      </div>
      <div class="knowledge-stats">
        <span>
          <b class="font-pixel">{{ archive.stats.objectCount }}</b>
          事实对象
        </span>
        <span>
          <b class="font-pixel">{{ archive.stats.activeFactCount }}</b>
          有效事实
        </span>
        <span>
          <b class="font-pixel">{{ archive.stats.historicalFactCount }}</b>
          历史事实
        </span>
      </div>
    </header>

    <nav class="section-tabs" aria-label="知识库分类">
      <button :class="{ active: section === 'facts' }" @click="section = 'facts'">
        <PixelIcon name="database" size="sm" />
        事实库
        <small>{{ archive.stats.activeFactCount }}</small>
      </button>
      <button :class="{ active: section === 'documents' }" @click="section = 'documents'">
        <PixelIcon name="file" size="sm" />
        文档知识库
        <small>建设中</small>
      </button>
    </nav>

    <section v-if="section === 'facts'" class="facts-workbench">
      <aside class="object-panel">
        <label class="search-box">
          <PixelIcon name="search" size="sm" />
          <input v-model="query" placeholder="搜索对象、别名或事实内容……" />
        </label>

        <div v-if="loading" class="panel-state">
          <PixelIcon name="refresh" size="md" animation="spin" />
          正在翻阅事实档案…
        </div>
        <div v-else-if="error" class="panel-state error-state">
          <PixelIcon name="alert" size="md" />
          {{ error }}
          <PButton size="sm" @click="loadFacts">重新加载</PButton>
        </div>
        <div v-else-if="!archive.items.length" class="panel-state">
          <PixelIcon name="database" size="lg" />
          <b>{{ query ? '没有找到相关事实' : '事实库还是空的' }}</b>
          <span>
            {{ query ? '换个名称、别名或关键词试试' : 'Agent 会在对话与任务中逐渐整理共同事实' }}
          </span>
        </div>
        <div v-else class="object-list">
          <button
            v-for="item in archive.items"
            :key="item.objectId"
            :class="{ active: selectedId === item.objectId }"
            @click="selectedId = item.objectId"
          >
            <span>
              <b>{{ item.standardName }}</b>
              <small>{{ item.activeFacts.length }} 条</small>
            </span>
            <em>{{ item.aliases.slice(0, 2).join(' · ') || '暂无别名' }}</em>
          </button>
        </div>
      </aside>

      <main class="fact-inspector">
        <div v-if="!selected" class="inspector-empty">
          <PixelIcon name="database" size="xl" />
          <b>选择一个事实对象</b>
          <span>查看它当前成立的事实、别名和历史变化</span>
        </div>
        <template v-else>
          <header class="object-head">
            <span class="object-mark" aria-hidden="true">◇</span>
            <div>
              <h3>{{ selected.standardName }}</h3>
              <p>事实对象 · {{ selected.activeFacts.length }} 条有效事实</p>
            </div>
          </header>

          <section v-if="selected.aliases.length" class="alias-section">
            <h4>别名</h4>
            <div>
              <span v-for="alias in selected.aliases" :key="alias">{{ alias }}</span>
            </div>
          </section>

          <section class="fact-section">
            <h4>
              <PixelIcon name="sparkle" size="xs" />
              当前事实
            </h4>
            <div v-if="!selected.activeFacts.length" class="inline-empty">
              该对象目前没有有效事实
            </div>
            <article v-for="fact in selected.activeFacts" :key="fact.id" class="fact-card">
              <p>{{ fact.statement }}</p>
              <footer>
                <span>{{ fact.source || '来源未标注' }} · {{ formatDate(fact.observedAt) }}</span>
                <button @click="toggleFact(fact.id)">
                  {{ expandedFacts.has(fact.id) ? '收起' : '详情' }}
                </button>
              </footer>
              <dl v-if="expandedFacts.has(fact.id)">
                <div>
                  <dt>来源</dt>
                  <dd>{{ fact.source || '未标注' }}</dd>
                </div>
                <div>
                  <dt>观察时间</dt>
                  <dd>{{ formatDate(fact.observedAt) }}</dd>
                </div>
                <div>
                  <dt>记录时间</dt>
                  <dd>{{ formatDate(fact.createdAt) }}</dd>
                </div>
                <div>
                  <dt>置信度</dt>
                  <dd>{{ confidenceLabel(fact.confidence) }}</dd>
                </div>
              </dl>
            </article>
          </section>

          <section v-if="selected.historicalFacts.length" class="history-section">
            <button class="history-toggle" @click="historyOpen = !historyOpen">
              <PixelIcon name="chevron-down" size="xs" :class="{ open: historyOpen }" />
              历史事实 {{ selected.historicalFacts.length }}
            </button>
            <div v-if="historyOpen" class="history-list">
              <article v-for="fact in selected.historicalFacts" :key="fact.id" class="history-card">
                <span>已被取代</span>
                <p>{{ fact.statement }}</p>
                <time>{{ formatDate(fact.observedAt) }}</time>
                <template v-if="replacementFor(fact)">
                  <i>↓ 被以下事实取代</i>
                  <strong>{{ replacementFor(fact)?.statement }}</strong>
                </template>
              </article>
            </div>
          </section>
        </template>
      </main>
    </section>

    <section v-else class="documents-coming">
      <div class="document-box">
        <PixelIcon name="file" size="xl" />
        <span>KNOWLEDGE</span>
      </div>
      <h3 class="font-pixel">文档知识库尚未启用</h3>
      <p>未来会把文件、网页与 Workspace 资料整理为可追溯的检索空间。</p>
      <div class="pipeline">
        <span>知识源</span>
        <i>→</i>
        <span>文本提取</span>
        <i>→</i>
        <span>内容切片</span>
        <i>→</i>
        <span>建立索引</span>
        <i>→</i>
        <span>Agent 检索</span>
      </div>
      <div class="planned">
        <b>计划支持</b>
        <span>文件和网页导入</span>
        <span>Workspace 资料索引</span>
        <span>来源引用</span>
        <span>检索测试</span>
        <span>更新与失效管理</span>
      </div>
    </section>
  </div>
</template>

<script lang="ts">
export default { name: 'KnowledgeTab' }
</script>

<style scoped>
.knowledge-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 14px;
  padding: 24px;
  color: var(--ui-text-primary);
  overflow: hidden;
}
.knowledge-head {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: none;
}
.knowledge-head h2 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 22px;
}
.knowledge-head h2 :deep(.pixel-icon) {
  color: var(--ui-accent-emerald, #10b981);
}
.knowledge-head p {
  margin: 4px 0 0;
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--ui-text-tertiary);
}
.knowledge-stats {
  display: flex;
  gap: 8px;
  margin-left: auto;
}
.knowledge-stats span {
  display: flex;
  min-width: 72px;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  font-size: 9px;
  color: var(--ui-text-tertiary);
}
.knowledge-stats b {
  font-size: 15px;
  color: var(--ui-accent-emerald, #10b981);
}
.section-tabs {
  display: flex;
  gap: 8px;
  flex: none;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.section-tabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 13px;
  border: 0;
  border-bottom: 3px solid transparent;
  background: none;
  color: var(--ui-text-secondary);
  font-weight: 700;
  cursor: pointer;
}
.section-tabs button.active {
  border-bottom-color: var(--ui-accent-emerald, #10b981);
  color: var(--ui-accent-emerald, #10b981);
}
.section-tabs small {
  padding: 2px 6px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  font-size: 8px;
}
.facts-workbench {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: minmax(260px, 36%) minmax(0, 1fr);
  gap: 12px;
}
.object-panel,
.fact-inspector {
  min-height: 0;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-sm);
}
.object-panel {
  display: flex;
  flex-direction: column;
  padding: 12px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
}
.search-box input {
  width: 100%;
  border: 0;
  outline: 0;
  background: none;
  color: var(--ui-text-primary);
}
.object-list {
  display: grid;
  gap: 7px;
  margin-top: 10px;
  overflow: auto;
  padding: 2px;
}
.object-list button {
  display: grid;
  gap: 5px;
  padding: 10px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid transparent;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-primary);
  text-align: left;
  cursor: pointer;
}
.object-list button:hover,
.object-list button.active {
  border-color: color-mix(in srgb, var(--ui-accent-emerald, #10b981) 52%, var(--ui-border-default));
  border-left-color: var(--ui-accent-emerald, #10b981);
  background: color-mix(in srgb, var(--ui-accent-emerald, #10b981) 8%, var(--ui-bg-elevated));
}
.object-list span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.object-list small,
.object-list em {
  color: var(--ui-text-tertiary);
  font-size: 10px;
  font-style: normal;
}
.panel-state,
.inspector-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 9px;
  padding: 28px;
  color: var(--ui-text-tertiary);
  text-align: center;
}
.error-state {
  color: var(--ui-danger, #ef5b72);
}
.fact-inspector {
  overflow: auto;
  padding: 20px;
}
.object-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px dashed var(--ui-border-default);
}
.object-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  background: color-mix(in srgb, var(--ui-accent-emerald, #10b981) 14%, var(--ui-bg-elevated));
  color: var(--ui-accent-emerald, #10b981);
  font-size: 22px;
  transform: rotate(45deg);
}
.object-head h3 {
  margin: 0;
  font-size: 20px;
}
.object-head p {
  margin: 3px 0 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.alias-section,
.fact-section,
.history-section {
  margin-top: 18px;
}
.alias-section h4,
.fact-section h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 9px;
  font-size: 12px;
}
.alias-section div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.alias-section span {
  padding: 4px 8px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-sky) 35%, var(--ui-border-default));
  background: color-mix(in srgb, var(--ui-accent-sky) 8%, var(--ui-bg-elevated));
  font-size: 10px;
}
.fact-card {
  margin-top: 8px;
  padding: 12px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid var(--ui-accent-emerald, #10b981);
  background: var(--ui-bg-elevated);
}
.fact-card > p {
  margin: 0;
  line-height: 1.55;
}
.fact-card footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 9px;
  color: var(--ui-text-tertiary);
  font-size: 9px;
}
.fact-card footer button {
  border: 0;
  background: none;
  color: var(--ui-accent-sky);
  cursor: pointer;
}
.fact-card dl {
  display: grid;
  gap: 5px;
  margin: 10px 0 0;
  padding-top: 9px;
  border-top: 1px dashed var(--ui-border-default);
  font-size: 10px;
}
.fact-card dl div {
  display: grid;
  grid-template-columns: 70px 1fr;
}
.fact-card dt {
  color: var(--ui-text-tertiary);
}
.fact-card dd {
  margin: 0;
}
.inline-empty {
  padding: 16px;
  border: 1px dashed var(--ui-border-default);
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.history-toggle {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-secondary);
  cursor: pointer;
}
.history-toggle :deep(.pixel-icon) {
  transition: transform 0.18s;
}
.history-toggle :deep(.pixel-icon.open) {
  transform: rotate(180deg);
}
.history-list {
  display: grid;
  gap: 8px;
  margin-top: 8px;
}
.history-card {
  display: grid;
  gap: 7px;
  padding: 11px;
  border: 1px solid var(--ui-border-subtle);
  background: color-mix(in srgb, var(--ui-text-muted) 5%, var(--ui-bg-elevated));
  color: var(--ui-text-secondary);
}
.history-card > span {
  width: max-content;
  padding: 2px 6px;
  background: var(--ui-bg-muted);
  color: var(--ui-text-tertiary);
  font-size: 8px;
}
.history-card p {
  margin: 0;
}
.history-card time {
  color: var(--ui-text-tertiary);
  font-size: 9px;
}
.history-card i {
  color: var(--ui-text-tertiary);
  font-size: 9px;
  font-style: normal;
}
.history-card strong {
  font-size: 11px;
  color: var(--ui-accent-emerald, #10b981);
}
.documents-coming {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  text-align: center;
}
.document-box {
  position: relative;
  display: grid;
  width: 96px;
  height: 76px;
  place-items: center;
  border: 2px solid color-mix(in srgb, var(--ui-accent-primary) 48%, var(--ui-border-default));
  background: var(--ui-bg-elevated);
  box-shadow: 6px 6px 0 color-mix(in srgb, var(--ui-accent-emerald, #10b981) 16%, transparent);
  transform: rotate(-2deg);
}
.document-box span {
  position: absolute;
  bottom: 5px;
  font-size: 7px;
  letter-spacing: 0.12em;
  color: var(--ui-text-tertiary);
}
.documents-coming h3 {
  margin: 24px 0 8px;
}
.documents-coming > p {
  margin: 0;
  color: var(--ui-text-tertiary);
}
.pipeline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  flex-wrap: wrap;
  justify-content: center;
}
.pipeline span {
  padding: 7px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  font-size: 10px;
}
.pipeline i {
  color: var(--ui-accent-emerald, #10b981);
  font-style: normal;
}
.planned {
  display: flex;
  max-width: 620px;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
  margin-top: 22px;
}
.planned b {
  width: 100%;
  font-size: 11px;
}
.planned span {
  padding: 5px 8px;
  background: color-mix(in srgb, var(--ui-accent-primary) 8%, var(--ui-bg-elevated));
  border: 1px solid var(--ui-border-subtle);
  font-size: 9px;
  color: var(--ui-text-secondary);
}
@media (max-width: 800px) {
  .knowledge-page {
    padding: 14px;
  }
  .knowledge-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .knowledge-stats {
    margin-left: 0;
  }
  .facts-workbench {
    grid-template-columns: 1fr;
  }
  .object-panel {
    max-height: 42%;
  }
  .fact-inspector {
    min-height: 280px;
  }
}
</style>
