<script setup lang="ts">
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
import { PButton, PixelIcon } from '../pixel'
import zpixFontUrl from '../../assets/fonts/zpix.ttf?url'

const design = ref<StatusCardDesign>(parseStatusCardDesign(DEFAULT_STATUS_CARD_DESIGN))
const loading = ref(true)
const busy = ref(false)
const message = ref('')
const error = ref('')
const snapshot = ref<StatusCardSnapshot>()
const image = ref('')
const renderedDesign = ref('')
const labels: Record<StatusCardSection, string> = {
  cpu: 'CPU',
  memory: '内存',
  gpu: 'GPU',
  disk: '系统盘',
  tasks: '助手任务',
}
// 示例只用于编辑预览，真实图片始终重新采集设备指标。
const example: StatusCardSnapshot = {
  capturedAt: '示例数据 · 非实时状态',
  deviceName: '我的设备',
  platform: 'Windows · x64',
  uptimeSeconds: 5400,
  cpu: { model: '处理器', cores: 8, percent: 28 },
  memory: { totalBytes: 32 * 1024 ** 3, usedBytes: 12 * 1024 ** 3 },
  gpu: { name: '图形处理器', percent: 16, usedBytes: 2 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
  disk: { totalBytes: 512 * 1024 ** 3, usedBytes: 180 * 1024 ** 3 },
  tasks: [{ title: '整理资料', status: 'running' }],
}
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
        snapshot.value ?? example,
        new URL(zpixFontUrl, window.location.href).href,
      )
    : '',
)
const freshImage = computed(
  () => image.value && renderedDesign.value === JSON.stringify(design.value),
)

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
    message.value = '已保存'
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
  try {
    const result = await socialApi.previewStatusCard(request)
    if (!result.data) throw new Error(result.message || '设备未连接')
    snapshot.value = result.data.snapshot
    image.value = `data:image/png;base64,${result.data.imageBase64}`
    renderedDesign.value = JSON.stringify(request)
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
    <header>
      <div>
        <h3>
          <PixelIcon name="desktop" size="sm" />
          状态卡片
        </h3>
        <p>在 QQ 主人私聊中查看设备状态，也可以直接告诉助手调整卡片。</p>
      </div>
    </header>
    <div class="designer-layout">
      <fieldset class="designer-fields" :disabled="loading || busy">
        <label>
          标题
          <input v-model="design.title" maxlength="32" />
        </label>
        <div class="field-row">
          <label>
            主题
            <select v-model="design.theme">
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label>
            布局
            <select v-model="design.layout">
              <option value="grid">双列</option>
              <option value="stack">单列</option>
            </select>
          </label>
        </div>
        <label>
          配色
          <select v-model="design.accent">
            <option value="sky">天蓝</option>
            <option value="pink">樱粉</option>
            <option value="mint">薄荷</option>
            <option value="amber">琥珀</option>
          </select>
        </label>
        <div class="section-picker">
          <span>展示项目</span>
          <div>
            <button
              v-for="s in STATUS_CARD_SECTIONS"
              :key="s"
              type="button"
              :aria-pressed="design.sections.includes(s)"
              @click="toggle(s)"
            >
              {{ labels[s] }}
            </button>
          </div>
        </div>
        <ol class="section-order">
          <li v-for="(s, i) in design.sections" :key="s">
            <span>{{ labels[s] }}</span>
            <button
              type="button"
              :disabled="i === 0"
              :aria-label="`上移${labels[s]}`"
              @click="move(i, -1)"
            >
              ↑
            </button>
            <button
              type="button"
              :disabled="i === design.sections.length - 1"
              :aria-label="`下移${labels[s]}`"
              @click="move(i, 1)"
            >
              ↓
            </button>
          </li>
        </ol>
        <p v-if="!draft" class="designer-error">请填写标题，并至少保留一个展示项目。</p>
        <footer>
          <PButton size="sm" :disabled="!draft" @click="save">
            <PixelIcon name="save" size="xs" />
            保存
          </PButton>
          <PButton size="sm" variant="secondary" :disabled="!draft" @click="preview">
            <PixelIcon name="refresh" size="xs" />
            实时预览
          </PButton>
        </footer>
        <button type="button" class="reset-design" @click="resetDesign">恢复默认设计</button>
      </fieldset>
      <div class="designer-preview">
        <div class="preview-caption">
          <span>{{ snapshot ? '设备快照' : '示例预览' }}</span>
          <span>{{ busy ? '处理中…' : (snapshot?.capturedAt ?? '点击实时预览以连接设备') }}</span>
        </div>
        <img v-if="freshImage" :src="image" alt="设备状态卡片预览" />
        <iframe
          v-else-if="previewDocument"
          title="卡片设计预览"
          sandbox=""
          :srcdoc="previewDocument"
        />
      </div>
    </div>
    <p v-if="error" class="designer-error" role="alert">{{ error }}</p>
    <p v-else-if="message" class="designer-success" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.card-designer {
  font-family: var(--ui-font-pixel);
  color: var(--ui-text-primary);
  padding: 20px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface);
  box-shadow:
    inset 1px 1px 0 color-mix(in srgb, var(--ui-text-inverse) 15%, transparent),
    0 2px 0 var(--ui-border-strong);
}
header h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
}
header p {
  color: var(--ui-text-tertiary);
  font-size: 12px;
  margin: 8px 0 20px;
}
.designer-layout {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 24px;
}
.designer-fields {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.designer-fields label,
.section-picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--ui-text-secondary);
}
input,
select {
  min-width: 0;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--ui-border-default);
  border-radius: 0;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-primary);
  font: 13px var(--ui-font-pixel);
  box-shadow: inset 1px 2px 0 color-mix(in srgb, var(--ui-border-strong) 35%, transparent);
}
input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 1px solid var(--ui-accent-sky);
  outline-offset: 2px;
}
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.section-picker > div {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.section-picker button,
.section-order button {
  font: 12px var(--ui-font-pixel);
  padding: 5px 8px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-secondary);
  cursor: pointer;
  border-radius: 0;
  box-shadow: 0 2px 0 var(--ui-border-default);
}
.section-picker button[aria-pressed='true'] {
  border-color: var(--ui-accent-sky);
  color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  box-shadow: inset 1px 1px 0 var(--ui-border-subtle);
}
.section-order {
  list-style: none;
  padding: 0;
  margin: 0;
  border-top: 1px dashed var(--ui-border-default);
}
.section-order li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--ui-border-subtle);
  font-size: 12px;
}
.section-order li > span {
  flex: 1;
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
  font: 11px var(--ui-font-pixel);
  cursor: pointer;
}
.designer-preview {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-canvas);
}
.preview-caption {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  font-size: 11px;
  color: var(--ui-text-tertiary);
}
.designer-preview img {
  display: block;
  width: 100%;
  max-width: 720px;
  height: auto;
}
.designer-preview iframe {
  display: block;
  width: 100%;
  height: 740px;
  border: 0;
  background: var(--ui-bg-surface-soft);
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
  .designer-preview iframe {
    height: 780px;
  }
}
</style>
