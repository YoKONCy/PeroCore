<script setup lang="ts">
import { getDisplayLocale } from '../../i18n/index'

import { t as __t } from '../../i18n/index'

import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentInfo,
  KnowledgeDocumentList,
  KnowledgeSearchResult,
} from '@infos/shared'
import { PixelIcon, PButton, PDialog } from '../pixel'
import { knowledgeApi } from '../../api/modules/knowledgeApi'
import { useNotificationStore } from '../../stores/useNotificationStore'
import KnowledgeImportDialog from './KnowledgeImportDialog.vue'
import KnowledgePartCard from './KnowledgePartCard.vue'

const emit = defineEmits<{ stats: [value: KnowledgeDocumentList['stats']] }>()
const notif = useNotificationStore()
const archive = ref<KnowledgeDocumentList>({
  items: [],
  total: 0,
  page: 1,
  pageSize: 30,
  stats: { documentCount: 0, readyCount: 0, pendingCount: 0, partCount: 0, indexingCount: 0 },
})
const query = ref('')
const page = ref(1)
const selectedId = ref<string | null>(null)
const selected = ref<KnowledgeDocumentDetail | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const error = ref('')
const detailError = ref('')
const importOpen = ref(false)
const importTarget = ref<KnowledgeDocumentInfo | null>(null)
const deleteTarget = ref<KnowledgeDocumentInfo | null>(null)
const deleting = ref(false)
const reindexing = ref(false)
const view = ref<'document' | 'search'>('document')
const keywords = ref('')
const regex = ref('')
const limit = ref(5)
const currentOnly = ref(false)
const searching = ref(false)
const searchError = ref('')
const results = ref<KnowledgeSearchResult | null>(null)
const pages = computed(() => Math.max(1, Math.ceil(archive.value.total / archive.value.pageSize)))
const hasPending = computed(
  () => archive.value.stats.pendingCount > 0 || archive.value.stats.indexingCount > 0,
)
const statusLabels = {
  get queued() {
    return __t('ui.knowledge', '待整理')
  },
  get processing() {
    return __t('ui.knowledge', '整理中')
  },
  get ready() {
    return __t('ui.knowledge', '可检索')
  },
  get failed() {
    return __t('ui.knowledge', '整理失败')
  },
}
const vectorLabels = {
  get skipped() {
    return __t('ui.knowledge', '仅文本检索')
  },
  get pending() {
    return __t('ui.knowledge', '向量索引中')
  },
  get ready() {
    return __t('ui.knowledge', '语义检索已就绪')
  },
  get failed() {
    return __t('ui.knowledge', '向量索引失败')
  },
  get stale() {
    return __t('ui.knowledge', '向量待重建')
  },
}
let active = true
let listRequest = 0
let detailRequest = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined
let queryTimer: ReturnType<typeof setTimeout> | undefined

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  if (active && hasPending.value) pollTimer = setTimeout(() => void load(false), 2000)
}
async function load(showLoading = true): Promise<void> {
  const request = ++listRequest
  if (showLoading) loading.value = true
  error.value = ''
  try {
    const response = await knowledgeApi.documents(query.value, page.value)
    if (!active || request !== listRequest || !response.data) return
    archive.value = response.data
    emit('stats', response.data.stats)
    if (page.value > pages.value) {
      page.value = pages.value
      return
    }
    if (!archive.value.items.some((item) => item.id === selectedId.value))
      selectedId.value = archive.value.items[0]?.id ?? null
    else if (selectedId.value) await loadDetail(selectedId.value, false)
  } catch (cause) {
    if (active && request === listRequest) error.value = (cause as Error).message
  } finally {
    if (request === listRequest) {
      loading.value = false
      schedulePoll()
    }
  }
}
async function loadDetail(id: string, showLoading = true): Promise<void> {
  const request = ++detailRequest
  if (showLoading) {
    selected.value = null
    detailLoading.value = true
  }
  detailError.value = ''
  try {
    const response = await knowledgeApi.document(id)
    if (active && request === detailRequest && id === selectedId.value)
      selected.value = response.data ?? null
  } catch (cause) {
    if (active && request === detailRequest) detailError.value = (cause as Error).message
  } finally {
    if (request === detailRequest) detailLoading.value = false
  }
}
function openImport(target: KnowledgeDocumentInfo | null = null): void {
  importTarget.value = target
  importOpen.value = true
}
function selectDocument(id: string): void {
  selectedId.value = id
  view.value = 'document'
}
async function imported(item: KnowledgeDocumentInfo): Promise<void> {
  query.value = ''
  page.value = 1
  await load(false)
  selectedId.value = item.id
  view.value = 'document'
  if (item.status === 'failed')
    notif.toast(item.error || __t('ui.knowledge', '资料已保存，整理未能开始'), 'error')
  else notif.toast(__t('ui.knowledge', '资料已加入整理队列'), 'success')
}
async function retry(item: KnowledgeDocumentInfo): Promise<void> {
  try {
    await knowledgeApi.retryDocument(item.id)
    await load(false)
  } catch (cause) {
    notif.toast((cause as Error).message, 'error')
  }
}
async function remove(): Promise<void> {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await knowledgeApi.deleteDocument(deleteTarget.value.id)
    deleteTarget.value = null
    results.value = null
    await load(false)
    notif.toast(__t('ui.knowledge', '资料已删除'), 'success')
  } catch (cause) {
    notif.toast((cause as Error).message, 'error')
    deleteTarget.value = null
    results.value = null
    await load(false)
  } finally {
    deleting.value = false
  }
}
async function reindex(): Promise<void> {
  reindexing.value = true
  try {
    await knowledgeApi.reindex()
    await load(false)
    notif.toast(__t('ui.knowledge', '索引重建已安排'), 'success')
  } catch (cause) {
    notif.toast((cause as Error).message, 'error')
  } finally {
    reindexing.value = false
  }
}
async function search(): Promise<void> {
  if (searching.value) return
  searching.value = true
  searchError.value = ''
  results.value = null
  try {
    const response = await knowledgeApi.search({
      keywords: keywords.value
        .split(/[,，\n]+/)
        .map((k) => k.trim())
        .filter(Boolean),
      regex: regex.value.trim() || undefined,
      limit: Math.min(20, Math.max(1, Number(limit.value) || 5)),
      documentId: currentOnly.value ? (selectedId.value ?? undefined) : undefined,
    })
    results.value = response.data ?? null
  } catch (cause) {
    searchError.value = (cause as Error).message
  } finally {
    searching.value = false
  }
}
function date(value: string): string {
  return new Date(value).toLocaleString(getDisplayLocale(), {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
watch(selectedId, (id) => {
  detailRequest++
  selected.value = null
  if (id) void loadDetail(id)
})
watch(query, () => {
  if (queryTimer) clearTimeout(queryTimer)
  queryTimer = setTimeout(() => {
    if (page.value !== 1) page.value = 1
    else void load()
  }, 260)
})
watch(page, () => void load())
function stop(): void {
  active = false
  listRequest++
  detailRequest++
  if (pollTimer) clearTimeout(pollTimer)
  if (queryTimer) clearTimeout(queryTimer)
}
onMounted(() => void load())
onActivated(() => {
  if (!active) {
    active = true
    void load(false)
  }
})
onDeactivated(stop)
onUnmounted(stop)
</script>

<template>
  <section class="document-knowledge">
    <div class="document-toolbar">
      <span>
        <PixelIcon name="file" size="sm" />
        {{ archive.stats.readyCount }} {{ __t('ui.knowledge', '份可检索') }}
        <span v-if="archive.stats.pendingCount">
          · {{ archive.stats.pendingCount }} {{ __t('ui.knowledge', '份整理中') }}
        </span>
      </span>
      <div>
        <PButton
          variant="secondary"
          size="sm"
          :loading="reindexing"
          :disabled="hasPending"
          @click="reindex"
        >
          <PixelIcon name="refresh" size="xs" />
          {{ __t('ui.knowledge', '重建索引') }}
        </PButton>
        <PButton size="sm" @click="openImport()">
          <PixelIcon name="plus" size="xs" />
          {{ __t('ui.knowledge', '导入资料') }}
        </PButton>
      </div>
    </div>
    <div class="document-workbench">
      <aside class="document-panel">
        <label class="document-filter">
          <PixelIcon name="search" size="sm" />
          <input
            v-model="query"
            :placeholder="__t('ui.knowledge', '搜索资料名称或来源……')"
            :aria-label="__t('ui.knowledge', '搜索资料')"
          />
        </label>
        <div v-if="loading && !archive.items.length" class="document-state">
          <PixelIcon name="refresh" animation="spin" />
          {{ __t('ui.knowledge', '正在读取…') }}
        </div>
        <div v-else-if="error" class="document-state document-error" role="alert">
          {{ error }}
          <PButton size="sm" @click="load()">{{ __t('ui.knowledge', '重新加载') }}</PButton>
        </div>
        <div v-else-if="!archive.items.length" class="document-state">
          <PixelIcon name="file" size="xl" />
          <b>
            {{
              query ? __t('ui.knowledge', '没有找到资料') : __t('ui.knowledge', '文档库还是空的')
            }}
          </b>
          <span>
            {{
              query
                ? __t('ui.knowledge', '换个名称或来源试试')
                : __t('ui.knowledge', '导入文本或网页，让 Agent 随时查阅')
            }}
          </span>
        </div>
        <div v-else class="document-list" :aria-busy="loading">
          <button
            v-for="item in archive.items"
            :key="item.id"
            :class="{ active: selectedId === item.id }"
            @click="selectDocument(item.id)"
          >
            <span class="document-row-title">
              <PixelIcon :name="item.sourceKind === 'url' ? 'globe' : 'file'" size="sm" />
              <b>{{ item.title }}</b>
            </span>
            <small class="document-row-source">
              {{ item.source || __t('ui.knowledge', '粘贴文本') }}
            </small>
            <span class="document-row-meta">
              <i :class="['document-status', item.status]">{{ statusLabels[item.status] }}</i>
              <small>
                {{ item.tokenCount.toLocaleString() }} Token
                <span v-if="item.status === 'ready'">
                  · {{ item.partCount }} {{ __t('ui.knowledge', '部分') }}
                </span>
              </small>
            </span>
          </button>
        </div>
        <footer class="document-pagination">
          <button :disabled="page <= 1" :aria-label="__t('ui.knowledge', '上一页')" @click="page--">
            ‹
          </button>
          <span>{{ archive.total }} {{ __t('ui.knowledge', '份 ·') }} {{ page }}/{{ pages }}</span>
          <button
            :disabled="page >= pages"
            :aria-label="__t('ui.knowledge', '下一页')"
            @click="page++"
          >
            ›
          </button>
        </footer>
      </aside>

      <main class="document-inspector">
        <nav class="inspector-tabs" :aria-label="__t('ui.knowledge', '资料查看方式')">
          <button :class="{ active: view === 'document' }" @click="view = 'document'">
            <PixelIcon name="file" size="xs" />
            {{ __t('ui.knowledge', '资料') }}
          </button>
          <button :class="{ active: view === 'search' }" @click="view = 'search'">
            <PixelIcon name="search" size="xs" />
            {{ __t('ui.knowledge', '检索') }}
          </button>
        </nav>
        <div v-if="view === 'document'" class="inspector-scroll">
          <div v-if="detailLoading" class="document-state">
            <PixelIcon name="refresh" animation="spin" />
            {{ __t('ui.knowledge', '正在读取…') }}
          </div>
          <div v-else-if="detailError" class="document-state document-error" role="alert">
            {{ detailError }}
            <PButton v-if="selectedId" size="sm" @click="loadDetail(selectedId)">
              {{ __t('ui.knowledge', '重新加载') }}
            </PButton>
          </div>
          <div v-else-if="!selected" class="document-state">
            <PixelIcon name="file" size="xl" />
            <b>{{ __t('ui.knowledge', '选择一份资料') }}</b>
            <span>{{ __t('ui.knowledge', '查看摘要、关键词和原文') }}</span>
          </div>
          <template v-else>
            <header class="document-head">
              <span class="document-mark">
                <PixelIcon :name="selected.sourceKind === 'url' ? 'globe' : 'file'" size="lg" />
              </span>
              <div>
                <h3>{{ selected.title }}</h3>
                <p>{{ selected.source || __t('ui.knowledge', '粘贴文本') }}</p>
              </div>
              <div class="document-actions">
                <button
                  :title="__t('ui.knowledge', '更新资料')"
                  :aria-label="__t('ui.knowledge', '更新资料')"
                  @click="openImport(selected)"
                >
                  <PixelIcon name="edit" size="sm" />
                </button>
                <button
                  class="danger"
                  :title="__t('ui.knowledge', '删除资料')"
                  :aria-label="__t('ui.knowledge', '删除资料')"
                  @click="deleteTarget = selected"
                >
                  <PixelIcon name="trash" size="sm" />
                </button>
              </div>
            </header>
            <div class="document-metadata">
              <i :class="['document-status', selected.status]">
                {{ statusLabels[selected.status] }}
              </i>
              <span>{{ selected.tokenCount.toLocaleString() }} Token</span>
              <span>{{ __t('ui.knowledge', '版本') }} {{ selected.revision }}</span>
              <span>{{ date(selected.updatedAt) }}</span>
            </div>
            <div
              v-if="selected.status === 'queued' || selected.status === 'processing'"
              class="document-notice"
            >
              <PixelIcon name="refresh" size="sm" animation="spin" />
              <div>
                <b>
                  {{
                    selected.status === 'queued'
                      ? __t('ui.knowledge', '等待整理')
                      : __t('ui.knowledge', '正在整理摘要与关键词')
                  }}
                </b>
                <p>{{ __t('ui.knowledge', '完成后即可检索，原文会完整保留。') }}</p>
              </div>
            </div>
            <div v-else-if="selected.status === 'failed'" class="document-notice failed">
              <PixelIcon name="alert" size="sm" />
              <div>
                <b>{{ __t('ui.knowledge', '整理失败') }}</b>
                <p>{{ selected.error }}</p>
              </div>
              <PButton size="sm" variant="secondary" @click="retry(selected)">
                {{ __t('ui.knowledge', '重试') }}
              </PButton>
            </div>
            <template v-else>
              <div class="document-index-note">
                <PixelIcon :name="selected.vectorStatus === 'ready' ? 'check' : 'info'" size="xs" />
                <span>{{ vectorLabels[selected.vectorStatus] }}</span>
                <small v-if="selected.modelName">
                  {{ __t('ui.knowledge', '整理模型：') }}{{ selected.modelName }}
                </small>
              </div>
              <p v-if="selected.error" class="document-error">{{ selected.error }}</p>
              <div class="document-parts">
                <KnowledgePartCard
                  v-for="part in selected.parts"
                  :key="`${selected.revision}:${part.id}`"
                  :part="part"
                />
              </div>
            </template>
          </template>
        </div>
        <div v-else class="inspector-scroll">
          <form class="knowledge-search" @submit.prevent="search">
            <h3>{{ __t('ui.knowledge', '检索资料') }}</h3>
            <p>{{ __t('ui.knowledge', '与 Agent 使用同一套检索，默认返回摘要和命中原文。') }}</p>
            <label>
              {{ __t('ui.knowledge', '关键词') }}
              <input
                v-model="keywords"
                :placeholder="__t('ui.knowledge', '用逗号分隔，支持自然语言短语')"
              />
            </label>
            <label>
              {{ __t('ui.knowledge', '正则（可选）') }}
              <input
                v-model="regex"
                :placeholder="__t('ui.knowledge', '原文正则表达式')"
                spellcheck="false"
              />
            </label>
            <div class="search-options">
              <label>
                {{ __t('ui.knowledge', '条数') }}
                <input v-model.number="limit" type="number" min="1" max="20" />
              </label>
              <label class="scope-check">
                <input v-model="currentOnly" type="checkbox" :disabled="!selectedId" />
                {{ __t('ui.knowledge', '仅当前资料') }}
              </label>
              <PButton
                size="sm"
                :loading="searching"
                :disabled="!keywords.trim() && !regex.trim()"
                type="submit"
              >
                <PixelIcon name="search" size="xs" />
                {{ __t('ui.knowledge', '检索') }}
              </PButton>
            </div>
          </form>
          <p v-if="searchError" class="document-error" role="alert">{{ searchError }}</p>
          <template v-if="results">
            <div class="search-count">
              {{ __t('ui.knowledge', '找到') }} {{ results.total }}
              {{ __t('ui.knowledge', '项，返回') }} {{ results.items.length }}
              {{ __t('ui.knowledge', '项') }}
              <span v-if="results.truncated">
                {{ __t('ui.knowledge', '· 结果已按预算截断，可展开继续查看') }}
              </span>
            </div>
            <p v-for="warning in results.warnings" :key="warning" class="search-warning">
              {{ warning }}
            </p>
            <div v-if="!results.items.length" class="document-state">
              {{ __t('ui.knowledge', '没有找到相关资料') }}
            </div>
            <div v-else class="document-parts">
              <KnowledgePartCard
                v-for="hit in results.items"
                :key="`${hit.revision}:${hit.id}`"
                :part="hit"
                :hit="hit"
              />
            </div>
          </template>
        </div>
      </main>
    </div>
    <KnowledgeImportDialog v-model="importOpen" :target="importTarget" @imported="imported" />
    <PDialog
      :model-value="Boolean(deleteTarget)"
      :title="__t('ui.knowledge', '永久删除资料？')"
      :message="
        __t('ui.knowledge', '删除“{0}”及其检索数据？无法恢复，原始文件保留。', [
          deleteTarget?.title ?? '',
        ])
      "
      :loading="deleting"
      @update:model-value="!deleting && !$event && (deleteTarget = null)"
    >
      <template #footer>
        <PButton variant="secondary" :disabled="deleting" @click="deleteTarget = null">
          {{ __t('ui.knowledge', '取消') }}
        </PButton>
        <PButton variant="danger" :loading="deleting" @click="remove">
          {{ __t('ui.knowledge', '删除') }}
        </PButton>
      </template>
    </PDialog>
  </section>
</template>

<style scoped>
.document-knowledge {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--ui-text-primary);
}
.document-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.document-toolbar > span {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.document-toolbar > div {
  display: flex;
  gap: 10px;
}
.document-workbench {
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-columns: minmax(250px, 34%) minmax(0, 1fr);
  gap: 12px;
}
.document-panel,
.document-inspector {
  min-height: 0;
  min-width: 0;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-sm);
  display: flex;
  flex-direction: column;
}
.document-panel {
  padding: 12px;
}
.document-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-tertiary);
}
.document-filter input {
  min-width: 0;
  width: 100%;
  color: var(--ui-text-primary);
  background: transparent;
  border: 0;
  outline: 0;
  font-size: 12px;
}
.document-filter:focus-within {
  outline: 1px solid var(--ui-accent-sky);
}
.document-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  overflow: auto;
  margin-top: 10px;
  padding: 2px;
  flex: 1;
}
.document-list > button {
  flex: none;
  display: grid;
  gap: 7px;
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 1px solid var(--ui-border-subtle);
  border-left: 3px solid transparent;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-primary);
  cursor: pointer;
}
.document-list > button:hover,
.document-list > button.active {
  border-color: color-mix(in srgb, var(--ui-success) 45%, var(--ui-border-default));
  border-left-color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-success) 7%, var(--ui-bg-elevated));
}
.document-row-title {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  font-size: 13px;
}
.document-row-title b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-row-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--ui-text-tertiary);
}
.document-row-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.document-row-meta small {
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.document-status {
  font-style: normal;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.document-status::before {
  content: '';
  width: 4px;
  height: 4px;
  background: currentColor;
}
.document-status.ready {
  color: var(--ui-success);
}
.document-status.queued,
.document-status.processing {
  color: var(--ui-warning);
}
.document-status.failed,
.danger {
  color: var(--ui-danger) !important;
}
.document-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding-top: 10px;
  margin-top: auto;
  font-size: 10px;
  color: var(--ui-text-tertiary);
}
.document-pagination button {
  border: 1px solid var(--ui-border-default);
  color: var(--ui-text-secondary);
  background: var(--ui-bg-elevated);
  width: 26px;
  height: 24px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.document-state {
  display: flex;
  flex: 1;
  min-height: 160px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 26px 18px;
  text-align: center;
  color: var(--ui-text-tertiary);
  font-size: 12px;
}
.document-state b {
  color: var(--ui-text-secondary);
}
.inspector-tabs {
  display: flex;
  flex: none;
  gap: 4px;
  padding: 8px 16px 0;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.inspector-tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  color: var(--ui-text-secondary);
  border: 0;
  border-bottom: 2px solid transparent;
  padding: 9px 12px;
  cursor: pointer;
  font-size: 12px;
}
.inspector-tabs button.active {
  color: var(--ui-success);
  border-bottom-color: currentColor;
}
.inspector-scroll {
  flex: 1;
  overflow: auto;
  min-height: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
}
.document-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  border-bottom: 1px dashed var(--ui-border-default);
}
.document-head > div:nth-child(2) {
  min-width: 0;
  flex: 1;
}
.document-mark {
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 42px;
  color: var(--ui-success);
  border: 1px solid color-mix(in srgb, var(--ui-success) 35%, var(--ui-border-default));
  background: color-mix(in srgb, var(--ui-success) 8%, var(--ui-bg-elevated));
  box-shadow: 2px 2px 0 var(--ui-border-subtle);
}
h3 {
  margin: 0;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.document-head p {
  font-size: 11px;
  line-height: 1.6;
  margin: 4px 0 0;
  color: var(--ui-text-tertiary);
  overflow-wrap: anywhere;
}
.document-actions {
  display: flex;
  gap: 8px;
}
.document-actions button {
  border: 0;
  background: transparent;
  color: var(--ui-text-secondary);
  padding: 5px;
  cursor: pointer;
}
.document-metadata {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 14px 0;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.document-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
  color: var(--ui-accent-sky);
  font-size: 13px;
  margin-top: 8px;
}
.document-notice > div {
  flex: 1;
  min-width: 0;
}
.document-notice p {
  font-size: 12px;
  color: var(--ui-text-secondary);
  margin: 6px 0 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.document-notice.failed {
  color: var(--ui-danger);
}
.document-index-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  margin-bottom: 16px;
}
.document-index-note small {
  margin-left: auto;
}
.document-parts {
  display: grid;
  gap: 12px;
}
.document-error {
  color: var(--ui-danger);
  font-size: 12px;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.knowledge-search {
  display: grid;
  gap: 14px;
  padding-bottom: 20px;
  border-bottom: 1px dashed var(--ui-border-default);
}
.knowledge-search h3 {
  font-size: 16px;
}
.knowledge-search p {
  font-size: 11px;
  color: var(--ui-text-tertiary);
  margin: -6px 0 0;
}
.knowledge-search label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--ui-text-secondary);
}
.knowledge-search input:not([type='checkbox']) {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  padding: 9px 10px;
  font: inherit;
}
.knowledge-search input:focus-visible {
  outline: 1px solid var(--ui-accent-sky);
  outline-offset: 2px;
}
.search-options {
  display: flex;
  align-items: end;
  gap: 18px;
  flex-wrap: wrap;
}
.search-options label:first-child {
  width: 70px;
}
.search-options .scope-check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.scope-check input {
  accent-color: var(--ui-success);
}
.search-options > button {
  margin-left: auto;
}
.search-count {
  padding: 16px 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.search-warning {
  color: var(--ui-warning);
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
@media (max-width: 900px) {
  .document-workbench {
    grid-template-columns: minmax(210px, 32%) minmax(0, 1fr);
  }
  .inspector-scroll {
    padding: 14px;
  }
  .document-actions {
    flex-direction: column;
    gap: 0;
  }
}
@media (max-width: 650px) {
  .document-workbench {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(160px, 35%) minmax(0, 1fr);
  }
  .document-toolbar > span {
    display: none;
  }
  .document-toolbar > div {
    margin-left: auto;
  }
}
</style>
