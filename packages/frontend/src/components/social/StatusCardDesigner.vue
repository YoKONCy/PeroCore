<script setup lang="ts">
import { getDisplayLocale, t as __t } from '../../i18n/index'

import { computed, onMounted, ref } from 'vue'
import {
  DEFAULT_STATUS_CARD_DESIGN,
  STATUS_CARD_SECTIONS,
  parseStatusCardDesign,
  statusCardDocument,
  type StatusCardDesign,
  type StatusCardSection,
  type StatusCardSnapshot,
} from '@infos/shared'
import { socialApi } from '../../api/modules/socialApi'
import { PButton, PInput, PSelect, PixelIcon } from '../pixel'
import zpixFontUrl from '../../assets/fonts/zpix.ttf?url'

const design = ref<StatusCardDesign>(parseStatusCardDesign(DEFAULT_STATUS_CARD_DESIGN))
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const error = ref('')
const snapshot = ref<StatusCardSnapshot>()
const image = ref('')
const renderedDesign = ref('')
const renderedLanguage = ref('')
const labels: Record<StatusCardSection, string> = {
  cpu: 'CPU',
  get memory() {
    return __t('ui.social', '内存')
  },
  gpu: 'GPU',
  get disk() {
    return __t('ui.social', '系统盘')
  },
  get tasks() {
    return __t('ui.social', '助手任务')
  },
}
// 示例只用于编辑预览，真实图片始终重新采集设备指标。
const example = computed<StatusCardSnapshot>(() => ({
  capturedAt: __t('ui.social', '示例数据 · 非实时状态'),
  deviceName: __t('ui.social', '我的设备'),
  platform: 'Windows · x64',
  uptimeSeconds: 5400,
  cpu: { model: __t('ui.social', '处理器'), cores: 8, percent: 28 },
  memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 12 * 1024 ** 3 },
  gpu: {
    name: __t('ui.social', '图形处理器'),
    percent: 16,
    usedBytes: 2 * 1024 ** 3,
    totalBytes: 8 * 1024 ** 3,
  },
  disk: { totalBytes: 512 * 1024 ** 3, usedBytes: 180 * 1024 ** 3 },
  tasks: [
    {
      get title() {
        return __t('ui.social', '整理资料')
      },
      status: 'running',
    },
  ],
}))
const sectionIcons: Record<StatusCardSection, string> = {
  cpu: 'cpu',
  memory: 'cpu',
  gpu: 'desktop',
  disk: 'database',
  tasks: 'list',
}
const accentOptions = computed(
  () =>
    [
      { value: 'sky', label: __t('ui.social', '天蓝'), color: 'var(--ui-accent-sky)' },
      { value: 'pink', label: __t('ui.social', '樱粉'), color: 'var(--ui-accent-primary)' },
      { value: 'mint', label: __t('ui.social', '薄荷'), color: 'var(--ui-success)' },
      { value: 'amber', label: __t('ui.social', '琥珀'), color: 'var(--ui-warning)' },
    ] as const,
)
const draft = computed(() => {
  try {
    return parseStatusCardDesign(design.value)
  } catch {
    return null
  }
})
const previewDocument = computed(() =>
  draft.value
    ? statusCardDocument(
        draft.value,
        snapshot.value ?? example.value,
        new URL(zpixFontUrl, window.location.href).href,
        getDisplayLocale(),
      )
    : '',
)
const freshImage = computed(
  () =>
    image.value &&
    renderedDesign.value === JSON.stringify(design.value) &&
    renderedLanguage.value === getDisplayLocale(),
)
const previewHeight = computed(() => {
  const metrics = design.value.sections.filter((section) => section !== 'tasks').length
  const rows = design.value.layout === 'grid' ? Math.ceil(metrics / 2) : metrics
  const tasks = design.value.sections.includes('tasks')
    ? 114 + Math.max(0, (snapshot.value?.tasks.length ?? 1) - 1) * 40
    : 0
  return 210 + rows * 178 + tasks
})

function toggle(section: StatusCardSection) {
  const sections = design.value.sections
  design.value.sections = sections.includes(section)
    ? sections.filter((s) => s !== section)
    : [...sections, section]
}
function resetDesign() {
  design.value = parseStatusCardDesign(DEFAULT_STATUS_CARD_DESIGN)
  message.value = ''
}
function move(index: number, delta: number) {
  const next = [...design.value.sections]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  design.value.sections = next
}
async function save() {
  if (!draft.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  try {
    const result = await socialApi.saveStatusCardDesign(draft.value)
    if (!result.data) throw new Error(result.message || '保存失败')
    design.value = result.data
    message.value = __t('ui.social', '已保存')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
async function preview() {
  if (!draft.value) return
  busy.value = true
  error.value = ''
  message.value = ''
  const request = parseStatusCardDesign(draft.value)
  const language = getDisplayLocale()
  try {
    const result = await socialApi.previewStatusCard(request)
    if (!result.data) throw new Error(result.message || '设备未连接')
    snapshot.value = result.data.snapshot
    image.value = `data:image/png;base64,${result.data.imageBase64}`
    renderedDesign.value = JSON.stringify(request)
    renderedLanguage.value = language
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
onMounted(async () => {
  try {
    const result = await socialApi.getStatusCardDesign()
    if (!result.data) throw new Error(result.message || '卡片设计加载失败')
    design.value = parseStatusCardDesign(result.data)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="card-designer">
    <header class="designer-heading">
      <span class="designer-heading-icon" aria-hidden="true">
        <PixelIcon name="desktop" size="sm" />
      </span>
      <div>
        <h3>
          {{ __t('ui.social', '状态卡片') }}
        </h3>
        <p>{{ __t('ui.social', '在 QQ 主人私聊中查看设备状态，也可以直接告诉助手调整卡片。') }}</p>
      </div>
    </header>
    <div class="designer-layout">
      <fieldset class="designer-fields" :disabled="loading || busy">
        <label>
          {{ __t('ui.social', '标题') }}
          <PInput v-model="design.title" maxlength="32" />
        </label>
        <div class="field-row">
          <label>
            {{ __t('ui.social', '主题') }}
            <PSelect
              :model-value="design.theme"
              :options="[
                { value: 'dark', label: __t('ui.social', '深色') },
                { value: 'light', label: __t('ui.social', '浅色') },
              ]"
              teleport
              :disabled="loading || busy"
              @update:model-value="design.theme = $event as StatusCardDesign['theme']"
            />
          </label>
          <label>
            {{ __t('ui.social', '布局') }}
            <PSelect
              :model-value="design.layout"
              :options="[
                { value: 'grid', label: __t('ui.social', '双列') },
                { value: 'stack', label: __t('ui.social', '单列') },
              ]"
              teleport
              :disabled="loading || busy"
              @update:model-value="design.layout = $event as StatusCardDesign['layout']"
            />
          </label>
        </div>
        <div class="accent-picker">
          <span>{{ __t('ui.social', '配色') }}</span>
          <div class="accent-options">
            <button
              v-for="option in accentOptions"
              :key="option.value"
              type="button"
              :aria-pressed="design.accent === option.value"
              @click="design.accent = option.value"
            >
              <i :style="{ background: option.color }" aria-hidden="true" />
              {{ option.label }}
            </button>
          </div>
        </div>
        <div class="section-picker">
          <span>{{ __t('ui.social', '展示项目') }}</span>
          <div>
            <button
              v-for="s in STATUS_CARD_SECTIONS"
              :key="s"
              type="button"
              :aria-pressed="design.sections.includes(s)"
              @click="toggle(s)"
            >
              <PixelIcon v-if="design.sections.includes(s)" name="check" size="xs" />
              {{ labels[s] }}
            </button>
          </div>
        </div>
        <ol class="section-order">
          <li v-for="(s, i) in design.sections" :key="s">
            <span class="section-order-number">{{ i + 1 }}</span>
            <PixelIcon :name="sectionIcons[s]" size="xs" aria-hidden="true" />
            <span class="section-order-label">{{ labels[s] }}</span>
            <button
              type="button"
              :disabled="i === 0"
              :aria-label="__t('ui.social', '上移{0}', [labels[s]])"
              @click="move(i, -1)"
            >
              <PixelIcon name="chevron-up" size="xs" />
            </button>
            <button
              type="button"
              :disabled="i === design.sections.length - 1"
              :aria-label="__t('ui.social', '下移{0}', [labels[s]])"
              @click="move(i, 1)"
            >
              <PixelIcon name="chevron-down" size="xs" />
            </button>
          </li>
        </ol>
        <p v-if="!draft" class="designer-error">
          {{ __t('ui.social', '请填写标题，并至少保留一个展示项目。') }}
        </p>
        <footer>
          <PButton size="sm" :disabled="!draft" @click="save">
            <PixelIcon name="save" size="xs" />
            {{ __t('ui.social', '保存') }}
          </PButton>
          <PButton size="sm" variant="secondary" :disabled="!draft" @click="preview">
            <PixelIcon name="refresh" size="xs" />
            {{ __t('ui.social', '实时预览') }}
          </PButton>
        </footer>
        <button type="button" class="reset-design" @click="resetDesign">
          {{ __t('ui.social', '恢复默认设计') }}
        </button>
      </fieldset>
      <div class="designer-preview">
        <div class="preview-caption">
          <span>{{ snapshot ? __t('ui.social', '设备状态') : __t('ui.social', '示例预览') }}</span>
          <span>
            {{
              busy
                ? __t('ui.social', '处理中…')
                : (snapshot?.capturedAt ?? __t('ui.social', '点击实时预览以连接设备'))
            }}
          </span>
        </div>
        <div class="preview-stage" :class="{ 'is-light': design.theme === 'light' }">
          <img v-if="freshImage" :src="image" :alt="__t('ui.social', '设备状态卡片预览')" />
          <iframe
            v-else-if="previewDocument"
            :title="__t('ui.social', '卡片设计预览')"
            sandbox=""
            :style="{ height: `${previewHeight}px` }"
            :srcdoc="previewDocument"
          />
        </div>
      </div>
    </div>
    <p v-if="error" class="designer-error" role="alert">{{ error }}</p>
    <p v-else-if="message" class="designer-success" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.card-designer {
  font-family: var(--ui-font-sans);
  color: var(--ui-text-primary);
  margin: 0 24px 24px;
  padding: 20px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 10px;
  background: var(--dash-panel-bg);
}
.designer-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.designer-heading-icon {
  display: grid;
  place-items: center;
  flex: 0 0 36px;
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 20%, var(--ui-border-subtle));
  border-radius: 8px;
  background: var(--ui-accent-purple-soft);
  color: var(--ui-accent-purple);
}
header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
header p {
  color: var(--ui-text-tertiary);
  font-size: 12px;
  margin: 4px 0 0;
  line-height: 1.7;
}
.designer-layout {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
}
.designer-fields {
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  padding: 16px;
  background: var(--dash-panel-soft);
  margin: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.designer-fields label,
.section-picker,
.accent-picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-text-secondary);
}
.designer-fields :deep(.p-input),
.designer-fields :deep(.p-select-trigger) {
  min-width: 0;
  width: 100%;
  min-height: 36px;
  border: 1px solid var(--ui-border-default);
  border-radius: 4px;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
  font-family: var(--ui-font-sans);
  font-size: 12px;
  box-shadow: none;
}
button:focus-visible {
  outline: 1px solid var(--ui-accent-sky);
  outline-offset: 2px;
}
.accent-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 5px;
}
.accent-options button {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
  padding: 9px 2px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-text-tertiary);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}
.accent-options i {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  box-shadow: 0 0 0 3px var(--ui-bg-surface-soft);
}
.accent-options button[aria-pressed='true'] {
  border-color: var(--ui-border-default);
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.section-picker > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.section-picker button,
.section-order button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font: 11px var(--ui-font-sans);
  padding: 5px 8px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-secondary);
  cursor: pointer;
  border-radius: 4px;
}
.section-picker button[aria-pressed='true'] {
  border-color: var(--ui-accent-sky);
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
}
.section-order {
  list-style: none;
  padding: 0;
  margin: 0;
  padding: 0 10px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 6px;
  background: var(--ui-bg-surface-soft);
}
.section-order li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ui-border-subtle);
  font-size: 12px;
}
.section-order li:last-child {
  border-bottom: 0;
}
.section-order-number {
  width: 12px;
  font-size: 10px;
  color: var(--ui-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.section-order li > .pixel-icon {
  color: var(--ui-text-tertiary);
}
.section-order-label {
  flex: 1;
  color: var(--ui-text-secondary);
}
.section-order button {
  width: 24px;
  height: 24px;
  padding: 0;
  border-color: transparent;
  background: transparent;
}
.section-order button:hover:not(:disabled),
.accent-options button:hover:not(:disabled) {
  background: var(--ui-bg-hover);
}
.section-order button:disabled {
  opacity: 0.35;
  cursor: default;
}
footer {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.reset-design {
  align-self: flex-start;
  background: none;
  border: 0;
  padding: 0;
  color: var(--ui-text-tertiary);
  font: 11px var(--ui-font-sans);
  cursor: pointer;
}
.designer-preview {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 8px;
  background: var(--dash-panel-soft);
}
.preview-caption {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ui-border-subtle);
  font-size: 11px;
  color: var(--ui-text-tertiary);
}
.preview-caption > span:first-child {
  color: var(--ui-text-secondary);
  font-weight: 600;
}
.preview-stage {
  display: grid;
  justify-items: center;
  padding: 16px;
  background: #101219;
}
.preview-stage.is-light {
  background: #edf1f7;
}
.designer-preview img {
  display: block;
  width: 100%;
  max-width: 760px;
  height: auto;
}
.designer-preview iframe {
  display: block;
  width: 100%;
  max-width: 760px;
  min-height: 300px;
  border: 0;
  background: transparent;
}
.designer-error,
.designer-success {
  font-size: 12px;
  margin: 12px 0 0;
  overflow-wrap: anywhere;
}
.designer-error {
  color: var(--ui-danger);
}
.designer-success {
  color: var(--ui-success);
}
@media (max-width: 900px) {
  .designer-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .card-designer {
    margin: 0 16px 16px;
    padding: 16px;
  }
}
@media (max-width: 520px) {
  .card-designer {
    margin: 0 10px 16px;
    padding: 12px;
  }
  .designer-fields {
    padding: 12px;
  }
  .preview-stage {
    padding: 4px;
  }
}
</style>
