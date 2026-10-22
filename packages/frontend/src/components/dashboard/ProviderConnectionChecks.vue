<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { t } from '../../i18n/index'
import { providerApi } from '../../api/modules/providerApi'
import { copyClientText } from '../../lib/clientPlatform'
import { PButton, PInput, PixelIcon } from '../pixel'

const props = defineProps<{ connectionId: string; disabled: boolean; active: boolean }>()
const tr = (source: string, values: readonly unknown[] = []) =>
  t('ui.provider-connections', source, values)
type CheckState = 'idle' | 'loading' | 'success' | 'error'
const probeState = ref<CheckState>('idle')
const listState = ref<CheckState>('idle')
const probeDetail = ref('')
const listError = ref('')
const duration = ref<number | null>(null)
const httpStatus = ref<number | null>(null)
const models = ref<string[]>([])
const query = ref('')
const copied = ref('')
const copying = ref(false)
const copyFailed = ref(false)
let context = 0
let copyTimer: ReturnType<typeof setTimeout> | undefined
const available = computed(() => props.active && !!props.connectionId && !props.disabled)
const filteredModels = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return models.value.filter((id) => id.toLowerCase().includes(needle))
})
const probeLabel = computed(
  () =>
    ({
      idle: tr('未检查'),
      loading: tr('检查中'),
      success: tr('地址可达'),
      error: tr('检查未通过'),
    })[probeState.value],
)
const listLabel = computed(() => {
  if (listState.value === 'loading') return tr('正在获取')
  if (listState.value === 'error') return tr('获取失败')
  if (listState.value === 'success')
    return models.value.length
      ? tr('已获取 {0} 个模型', [models.value.length])
      : tr('服务商未返回模型')
  return tr('待获取')
})
const copyLabel = computed(() =>
  copied.value === 'all'
    ? tr('已复制')
    : query.value.trim()
      ? tr('复制筛选结果')
      : tr('复制全部 ID'),
)
const emptyTitle = computed(() => {
  if (listState.value === 'loading') return tr('正在读取模型目录…')
  if (listState.value === 'error') return tr('暂时无法获取模型目录')
  return listState.value === 'success' ? tr('服务商未返回模型') : tr('模型目录待获取')
})
const emptyHint = computed(() => {
  if (listState.value === 'success') return tr('你仍可在模型配置中手动填写模型 ID。')
  return listState.value === 'error'
    ? tr('请检查连接信息后重试。')
    : tr('获取后可搜索模型，并一键复制 ID。')
})

function reset(): void {
  context++
  probeState.value = 'idle'
  listState.value = 'idle'
  probeDetail.value = ''
  listError.value = ''
  duration.value = null
  httpStatus.value = null
  models.value = []
  query.value = ''
  copied.value = ''
  copying.value = false
  copyFailed.value = false
  clearTimeout(copyTimer)
}

watch(() => [props.connectionId, props.disabled, props.active], reset, { flush: 'sync' })
watch(query, () => {
  copied.value = ''
  copyFailed.value = false
})
onBeforeUnmount(reset)

/** 详情始终作为限长纯文本展示，异常不能撑开检查卡片。 */
function failureDetail(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 600) : tr('请求未完成，请重试')
}

async function probe(): Promise<void> {
  if (!available.value || probeState.value === 'loading') return
  const request = context
  probeState.value = 'loading'
  probeDetail.value = ''
  duration.value = null
  httpStatus.value = null
  try {
    const result = (await providerApi.probe(props.connectionId)).data
    if (request !== context) return
    probeState.value = result?.reachable ? 'success' : 'error'
    probeDetail.value = result?.message?.slice(0, 600) || tr('未收到检查结果')
    duration.value = Number.isFinite(result?.durationMs) ? result!.durationMs : null
    httpStatus.value = Number.isFinite(result?.status) ? result!.status! : null
  } catch (error) {
    if (request !== context) return
    probeState.value = 'error'
    probeDetail.value = failureDetail(error)
  }
}

async function fetchModels(): Promise<void> {
  if (!available.value || listState.value === 'loading') return
  const request = context
  listState.value = 'loading'
  listError.value = ''
  models.value = []
  query.value = ''
  copied.value = ''
  copyFailed.value = false
  try {
    const result = (await providerApi.listModels(props.connectionId)).data ?? []
    if (request !== context) return
    models.value = [...new Set(result.filter((id) => typeof id === 'string' && id.trim()))]
    listState.value = 'success'
  } catch (error) {
    if (request !== context) return
    listState.value = 'error'
    listError.value = failureDetail(error)
  }
}

async function copyIds(id?: string): Promise<void> {
  if (!available.value || copying.value) return
  const text = id ?? filteredModels.value.join('\n')
  if (!text) return
  const request = context
  const source = models.value
  const search = query.value
  copying.value = true
  copyFailed.value = false
  try {
    await copyClientText(text)
    if (request !== context || source !== models.value || search !== query.value) return
    copied.value = id === undefined ? 'all' : `model:${id}`
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = ''
    }, 2000)
  } catch {
    if (request === context) copyFailed.value = true
  } finally {
    if (request === context) copying.value = false
  }
}

function escapeSearch(event: KeyboardEvent): void {
  if (!query.value) return
  event.stopPropagation()
  event.preventDefault()
  query.value = ''
}
</script>

<template>
  <section class="connection-checks" :aria-label="tr('连接检查')">
    <div class="connection-checks__header">
      <div class="connection-checks__heading">
        <span class="connection-checks__symbol" aria-hidden="true">
          <PixelIcon name="link" size="sm" />
        </span>
        <div>
          <h4>{{ tr('连接检查') }}</h4>
          <p>
            {{
              available
                ? tr('检查地址响应，浏览服务商的模型目录。')
                : tr('保存连接后即可检查地址和获取模型列表。')
            }}
          </p>
        </div>
      </div>
      <div class="connection-checks__actions">
        <PButton
          size="sm"
          variant="secondary"
          :disabled="!available"
          :loading="probeState === 'loading'"
          @click="probe"
        >
          <PixelIcon v-if="probeState !== 'loading'" name="link" size="xs" />
          {{ tr('检查地址') }}
        </PButton>
        <PButton
          size="sm"
          :disabled="!available"
          :loading="listState === 'loading'"
          @click="fetchModels"
        >
          <PixelIcon
            v-if="listState !== 'loading'"
            :name="listState === 'success' ? 'refresh' : 'list'"
            size="xs"
          />
          {{ listState === 'success' ? tr('刷新模型列表') : tr('获取模型列表') }}
        </PButton>
      </div>
    </div>

    <div class="check-results" role="status" aria-live="polite" aria-atomic="true">
      <div class="check-result" :data-state="probeState">
        <div class="check-result__label">
          <i aria-hidden="true" />
          {{ tr('地址响应') }}
        </div>
        <div class="check-result__value">
          <strong>{{ probeLabel }}</strong>
          <span v-if="duration !== null" class="check-result__time">{{ duration }} ms</span>
        </div>
        <div v-if="httpStatus !== null" class="check-result__meta">HTTP {{ httpStatus }}</div>
        <p v-if="probeDetail" class="check-result__detail">{{ probeDetail }}</p>
      </div>
      <div
        class="check-result"
        :data-state="listState === 'success' && !models.length ? 'empty' : listState"
      >
        <div class="check-result__label">
          <i aria-hidden="true" />
          {{ tr('模型发现') }}
        </div>
        <div class="check-result__value">
          <strong>{{ listLabel }}</strong>
        </div>
        <p v-if="listError" class="check-result__detail">{{ listError }}</p>
      </div>
    </div>

    <div class="model-catalog" :aria-busy="listState === 'loading'">
      <div class="model-catalog__toolbar">
        <div class="model-catalog__title">
          <PixelIcon name="cpu" size="xs" />
          <h5>{{ tr('模型目录') }}</h5>
          <span v-if="listState === 'success'" class="model-catalog__count">
            {{ models.length }}
          </span>
        </div>
        <button
          v-if="models.length"
          type="button"
          class="catalog-copy-all"
          :disabled="!filteredModels.length || copying || !available"
          @click="copyIds()"
        >
          <PixelIcon :name="copied === 'all' ? 'check' : 'copy'" size="xs" />
          {{ copyLabel }}
        </button>
      </div>

      <template v-if="models.length">
        <div class="model-search">
          <PixelIcon name="search" size="xs" aria-hidden="true" />
          <PInput
            v-model="query"
            size="sm"
            :aria-label="tr('搜索模型 ID')"
            :placeholder="tr('搜索模型 ID…')"
            autocomplete="off"
            spellcheck="false"
            @keydown.esc="escapeSearch"
          />
          <button v-if="query" type="button" :aria-label="tr('清空搜索')" @click="query = ''">
            <PixelIcon name="close" size="xs" />
          </button>
        </div>
        <div class="model-catalog__columns" aria-hidden="true">
          <span>{{ tr('模型 ID') }}</span>
          <span>{{ tr('{0} / {1} 个', [filteredModels.length, models.length]) }}</span>
        </div>
        <ul
          v-if="filteredModels.length"
          class="model-catalog__list"
          tabindex="0"
          :aria-label="tr('模型目录')"
        >
          <li
            v-for="(id, index) in filteredModels"
            :key="id"
            class="model-catalog__row"
            :class="{ 'is-copied': copied === `model:${id}` }"
          >
            <span class="model-catalog__index" aria-hidden="true">
              {{ String(index + 1).padStart(2, '0') }}
            </span>
            <code :title="id">{{ id }}</code>
            <button
              type="button"
              class="catalog-copy-id"
              :disabled="copying || !available"
              :aria-label="copied === `model:${id}` ? tr('已复制') : tr('复制模型 ID：{0}', [id])"
              :title="copied === `model:${id}` ? tr('已复制') : tr('复制模型 ID')"
              @click="copyIds(id)"
            >
              <PixelIcon :name="copied === `model:${id}` ? 'check' : 'copy'" size="xs" />
            </button>
          </li>
        </ul>
        <div v-else class="model-catalog__empty">
          <PixelIcon name="search" size="md" />
          <strong>{{ tr('没有匹配的模型') }}</strong>
          <button type="button" class="catalog-text-action" @click="query = ''">
            {{ tr('清空搜索') }}
          </button>
        </div>
      </template>
      <div v-else class="model-catalog__empty" :data-state="listState">
        <PixelIcon
          :name="listState === 'loading' ? 'refresh' : listState === 'error' ? 'alert' : 'list'"
          size="md"
          :animation="listState === 'loading' ? 'spin' : undefined"
        />
        <strong>{{ emptyTitle }}</strong>
        <p>{{ emptyHint }}</p>
      </div>
      <p v-if="copyFailed" class="catalog-copy-error" role="alert">
        {{ tr('复制未完成，请选中文字手动复制。') }}
      </p>
      <span class="catalog-copy-announcement" role="status" aria-live="polite">
        {{ copied ? tr('已复制') : '' }}
      </span>
    </div>
    <footer class="connection-checks__footer">
      <PixelIcon name="info" size="xs" aria-hidden="true" />
      <span>{{ tr('复制模型 ID 后，可在模型配置中添加并测试。') }}</span>
    </footer>
  </section>
</template>

<style scoped>
.connection-checks {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border-default);
  border-radius: 6px;
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}
.connection-checks__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 18px;
}
.connection-checks__heading {
  display: flex;
  flex: 1 1 220px;
  align-items: center;
  min-width: 0;
  gap: 10px;
}
.connection-checks__heading > div {
  min-width: 0;
}
.connection-checks__symbol {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
}
.connection-checks h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 750;
}
.connection-checks__heading p {
  margin: 4px 0 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  line-height: 1.6;
}
.connection-checks__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.connection-checks__actions :deep(.p-btn) {
  min-height: 32px;
  border-width: 1px;
  border-radius: 3px;
  box-shadow: none;
  font-family: var(--ui-font-sans);
  font-size: 11px;
}
.check-results {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: 10px;
  padding: 0 18px 18px;
}
.check-result {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 4px;
  background: var(--ui-bg-surface-soft);
}
.check-result__label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.check-result__label i {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 1px;
  background: var(--ui-text-disabled);
}
.check-result__value {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-top: 7px;
}
.check-result__value strong {
  font-size: 12px;
  font-weight: 650;
}
.check-result__time,
.check-result__meta {
  color: var(--ui-text-tertiary);
  font: 10px/1.6 var(--ui-font-mono);
}
.check-result__meta {
  margin-top: 5px;
}
.check-result__detail {
  max-height: 76px;
  overflow: auto;
  margin: 6px 0 0;
  color: var(--ui-text-secondary);
  font-size: 11px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.check-result[data-state='success'] .check-result__label i {
  background: var(--ui-success);
}
.check-result[data-state='error'] .check-result__label i {
  background: var(--ui-danger);
}
.check-result[data-state='loading'] .check-result__label i {
  background: var(--ui-accent-sky);
}
.check-result[data-state='empty'] .check-result__label i {
  background: var(--ui-warning);
}
.check-result[data-state='error'] strong {
  color: var(--ui-danger);
}
.model-catalog {
  min-width: 0;
  border-top: 1px solid var(--ui-border-subtle);
}
.model-catalog__toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 14px 18px 10px;
}
.model-catalog__title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-secondary);
}
.model-catalog h5 {
  margin: 0;
  font-size: 12px;
  font-weight: 650;
}
.model-catalog__count {
  min-width: 20px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.catalog-copy-all,
.catalog-copy-id,
.catalog-text-action,
.model-search button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ui-text-secondary);
  font: inherit;
  cursor: pointer;
}
.catalog-copy-all {
  min-height: 26px;
  font-size: 11px;
}
.catalog-copy-all:hover:not(:disabled),
.catalog-copy-id:hover:not(:disabled),
.model-search button:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-accent-purple);
}
.catalog-copy-all:disabled,
.catalog-copy-id:disabled {
  opacity: 0.45;
  cursor: default;
}
.model-search {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 18px 10px;
  color: var(--ui-text-tertiary);
}
.model-search > :first-child {
  position: absolute;
  left: 10px;
  pointer-events: none;
}
.model-search :deep(input) {
  min-height: 34px;
  padding-right: 32px;
  padding-left: 32px;
  border-width: 1px;
  border-radius: 4px;
  background: var(--ui-bg-surface-soft);
  font-family: var(--ui-font-sans);
  font-size: 11px;
}
.model-search button {
  position: absolute;
  right: 6px;
  width: 24px;
  height: 24px;
}
.model-catalog__columns {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 0 22px 8px 54px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.model-catalog__list {
  max-height: min(260px, 35dvh);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  margin: 0 8px 12px 18px;
  padding: 0 7px 0 0;
  list-style: none;
}
.model-catalog__row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) 28px;
  align-items: center;
  min-height: 38px;
  gap: 8px;
  padding: 4px 6px;
  border-top: 1px solid var(--ui-border-subtle);
  border-radius: 2px;
}
.model-catalog__row:hover {
  background: var(--ui-bg-hover);
}
.model-catalog__index {
  color: var(--ui-text-disabled);
  font: 10px/1.6 var(--ui-font-mono);
  font-variant-numeric: tabular-nums;
}
.model-catalog__row code {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-primary);
  font: 11px/1.7 var(--ui-font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.catalog-copy-id {
  width: 28px;
  height: 28px;
  color: var(--ui-text-tertiary);
}
.model-catalog__row.is-copied {
  background: var(--ui-success-soft);
}
.model-catalog__row.is-copied .catalog-copy-id {
  color: var(--ui-success);
}
.model-catalog__empty {
  display: flex;
  min-height: 122px;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 20px;
  color: var(--ui-text-tertiary);
  text-align: center;
}
.model-catalog__empty > :first-child {
  color: var(--ui-accent-purple);
  opacity: 0.7;
}
.model-catalog__empty strong {
  font-size: 12px;
  font-weight: 550;
}
.model-catalog__empty p {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}
.catalog-text-action {
  color: var(--ui-accent-purple);
  font-size: 11px;
}
.catalog-copy-error {
  margin: 0;
  padding: 0 18px 12px;
  color: var(--ui-danger);
  font-size: 11px;
}
.catalog-copy-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.connection-checks__footer {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 11px 18px;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-tertiary);
  font-size: 10px;
  line-height: 1.7;
}
.connection-checks__footer > :first-child {
  flex-shrink: 0;
  margin-top: 2px;
}
.catalog-copy-all:focus-visible,
.catalog-copy-id:focus-visible,
.catalog-text-action:focus-visible,
.model-search button:focus-visible,
.model-catalog__list:focus-visible {
  outline: 2px solid var(--ui-focus-color);
  outline-offset: 2px;
}
@media (max-width: 680px) {
  .connection-checks__header {
    padding: 14px;
  }
  .check-results {
    padding: 0 14px 14px;
  }
  .model-catalog__toolbar {
    padding-right: 14px;
    padding-left: 14px;
  }
  .model-search {
    margin-right: 14px;
    margin-left: 14px;
  }
  .connection-checks__footer {
    padding-right: 14px;
    padding-left: 14px;
  }
}
</style>
