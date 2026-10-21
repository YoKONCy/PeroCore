<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { getDocument, GlobalWorkerOptions, PasswordResponses, TextLayer } from 'pdfjs-dist'
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { WorkspacePreviewState } from './workspacePreview'
import { getApiBaseUrl, getApiResourceHeaders } from '../../api/transport'

const props = defineProps<{ src: string; state: WorkspacePreviewState }>()
const emit = defineEmits<{
  error: [message: string]
  state: [patch: Partial<WorkspacePreviewState>]
}>()
GlobalWorkerOptions.workerSrc = workerUrl
const pdf = shallowRef<PDFDocumentProxy | null>(null)
const stage = ref<HTMLElement | null>(null),
  canvas = ref<HTMLCanvasElement | null>(null),
  textContainer = ref<HTMLElement | null>(null)
const loading = ref(true),
  rendering = ref(false),
  pageCount = ref(0),
  width = ref(0)
const pageSize = ref({ width: 0, height: 0, scale: 1, totalScale: 1 })
const password = ref(''),
  passwordRequired = ref(false),
  passwordError = ref(false)
const query = ref(''),
  searching = ref(false),
  searchMessage = ref('')
const pageInput = ref(props.state.page)
let passwordCallback: ((value: string) => void) | undefined
let loadingTask: PDFDocumentLoadingTask | undefined,
  renderTask: RenderTask | undefined,
  textLayer: TextLayer | undefined
let loadRevision = 0,
  renderRevision = 0,
  searchRevision = 0
let observer: ResizeObserver | undefined
let lastMatch: { term: string; page: number } | undefined
const cachedText = new Map<number, string>()
const zoomLabel = computed(() =>
  props.state.zoom ? `${Math.round(props.state.zoom * 100)}%` : __t('ui.workspace', '适应宽度'),
)

async function load() {
  const revision = ++loadRevision
  ++renderRevision
  ++searchRevision
  renderTask?.cancel()
  textLayer?.cancel()
  const previous = loadingTask
  loadingTask = undefined
  pdf.value = null
  pageCount.value = 0
  cachedText.clear()
  loading.value = true
  passwordRequired.value = false
  passwordCallback = undefined
  await previous?.destroy().catch(() => undefined)
  if (revision !== loadRevision) return
  const assets = new URL('pdf-assets/', document.baseURI).href
  const task = getDocument({
    url: props.src,
    httpHeaders: getApiResourceHeaders(props.src),
    withCredentials: new URL(props.src, getApiBaseUrl()).origin === new URL(getApiBaseUrl()).origin,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    disableStream: true,
    disableAutoFetch: true,
    enableXfa: false,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
  })
  loadingTask = task
  task.onPassword = (updatePassword: (value: string) => void, reason: number) => {
    if (revision !== loadRevision) return
    passwordCallback = updatePassword
    passwordRequired.value = true
    passwordError.value = reason === PasswordResponses.INCORRECT_PASSWORD
    loading.value = false
  }
  try {
    const documentProxy = await task.promise
    if (revision !== loadRevision) return
    pdf.value = documentProxy
    pageCount.value = documentProxy.numPages
    const page = Math.max(1, Math.min(pageCount.value, props.state.page))
    emit('state', { page })
    pageInput.value = page
    loading.value = false
    passwordRequired.value = false
    password.value = ''
    passwordCallback = undefined
    await nextTick()
    await render()
  } catch (error) {
    if (revision !== loadRevision) return
    loading.value = false
    emit(
      'error',
      error instanceof Error && /409/.test(error.message)
        ? '文件已变化，请重新载入预览'
        : 'PDF 无法读取，请重新载入或用系统应用打开',
    )
  }
}

async function render() {
  const documentProxy = pdf.value
  if (!documentProxy || !canvas.value || !textContainer.value) return
  const revision = ++renderRevision
  const previous = renderTask
  previous?.cancel()
  textLayer?.cancel()
  rendering.value = true
  try {
    await previous?.promise.catch(() => undefined)
    const page = await documentProxy.getPage(props.state.page)
    if (revision !== renderRevision || !canvas.value || !textContainer.value) return
    const original = page.getViewport({ scale: 1 })
    const scale = props.state.zoom || Math.max(0.1, width.value / original.width)
    const viewport = page.getViewport({ scale })
    pageSize.value = {
      width: viewport.width,
      height: viewport.height,
      scale: viewport.scale,
      totalScale: viewport.scale * viewport.userUnit,
    }
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
      8192 / viewport.width,
      8192 / viewport.height,
    )
    const target = canvas.value
    target.width = Math.max(1, Math.floor(viewport.width * ratio))
    target.height = Math.max(1, Math.floor(viewport.height * ratio))
    target.style.width = `${viewport.width}px`
    target.style.height = `${viewport.height}px`
    textContainer.value.replaceChildren()
    const task = page.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
    renderTask = task
    await task.promise
    if (revision !== renderRevision || !textContainer.value) return
    const layer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textContainer.value,
      viewport,
    })
    textLayer = layer
    await layer.render()
    if (revision === renderRevision) highlight()
  } catch (error) {
    if (
      revision === renderRevision &&
      !(error instanceof Error && error.name === 'RenderingCancelledException')
    )
      emit('error', 'PDF 页面无法显示，可重新载入后重试')
  } finally {
    if (revision === renderRevision) rendering.value = false
  }
}
function go(page: number) {
  if (!Number.isFinite(page) || !pageCount.value) return
  const target = Math.max(1, Math.min(pageCount.value, Math.trunc(page)))
  emit('state', { page: target })
  pageInput.value = target
  stage.value?.scrollTo({ top: 0, left: 0 })
}
function zoom(direction: number) {
  emit('state', {
    zoom: Math.min(4, Math.max(0.25, pageSize.value.scale * (direction > 0 ? 1.25 : 0.8))),
  })
}
function unlock() {
  if (password.value && passwordCallback) {
    loading.value = true
    passwordRequired.value = false
    passwordCallback(password.value)
    password.value = ''
  }
}
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '')
function highlight() {
  const term = normalize(query.value)
  for (const span of textContainer.value?.querySelectorAll('span') ?? [])
    span.classList.toggle(
      'workspace-pdf-match',
      !!term && normalize(span.textContent ?? '').includes(term),
    )
}
async function search(direction = 1) {
  const documentProxy = pdf.value,
    term = normalize(query.value)
  if (!documentProxy || !term || searching.value) return
  const revision = ++searchRevision
  const startPage = props.state.page
  const offset = lastMatch?.term === term && lastMatch.page === startPage ? 1 : 0
  searching.value = true
  searchMessage.value = ''
  try {
    for (let step = 0; step < pageCount.value; step++) {
      const candidate =
        ((startPage - 1 + direction * (step + offset) + pageCount.value) % pageCount.value) + 1
      let text = cachedText.get(candidate)
      if (text === undefined) {
        const page = await documentProxy.getPage(candidate)
        if (revision !== searchRevision) return
        const content = await page.getTextContent()
        if (revision !== searchRevision) return
        text = normalize(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
        if (cachedText.size >= 6) cachedText.delete(cachedText.keys().next().value!)
        cachedText.set(candidate, text)
      }
      if (text.includes(term)) {
        lastMatch = { term, page: candidate }
        go(candidate)
        highlight()
        searchMessage.value = `第 ${candidate} 页`
        return
      }
    }
    searchMessage.value = '未找到'
  } catch {
    if (revision === searchRevision) searchMessage.value = '查找失败'
  } finally {
    if (revision === searchRevision) searching.value = false
  }
}
watch(query, () => {
  ++searchRevision
  searching.value = false
  searchMessage.value = ''
  lastMatch = undefined
  highlight()
})
watch(
  () => props.state.page,
  () => {
    pageInput.value = props.state.page
    void render()
  },
)
watch(
  () => props.state.zoom,
  () => void render(),
)
watch(width, () => {
  if (!props.state.zoom) void render()
})
watch(
  () => props.src,
  () => void load(),
  { immediate: true },
)
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  if (stage.value) observer.observe(stage.value)
})
onBeforeUnmount(() => {
  ++loadRevision
  ++renderRevision
  ++searchRevision
  observer?.disconnect()
  renderTask?.cancel()
  textLayer?.cancel()
  void loadingTask?.destroy().catch(() => undefined)
  passwordCallback = undefined
})
</script>
<template>
  <div class="workspace-pdf">
    <div class="file-view-controls">
      <button
        type="button"
        :disabled="!pdf || state.page <= 1"
        :aria-label="__t('ui.workspace', '上一页')"
        @click="go(state.page - 1)"
      >
        ‹
      </button>
      <input
        v-model.number="pageInput"
        type="number"
        min="1"
        :max="pageCount || 1"
        :disabled="!pdf"
        :aria-label="__t('ui.workspace', '页码')"
        @change="go(Number(pageInput))"
        @keydown.enter.prevent="go(Number(pageInput))"
      />
      <span>/ {{ pageCount || '—' }}</span>
      <button
        type="button"
        :disabled="!pdf || state.page >= pageCount"
        :aria-label="__t('ui.workspace', '下一页')"
        @click="go(state.page + 1)"
      >
        ›
      </button>
      <button
        type="button"
        :disabled="!pdf"
        :aria-label="__t('ui.workspace', '缩小')"
        @click="zoom(-1)"
      >
        −
      </button>
      <button type="button" :disabled="!pdf" @click="emit('state', { zoom: 0 })">
        {{ zoomLabel }}
      </button>
      <button
        type="button"
        :disabled="!pdf"
        :aria-label="__t('ui.workspace', '放大')"
        @click="zoom(1)"
      >
        ＋
      </button>
      <span class="file-view-spacer" />
      <form class="workspace-pdf__search" @submit.prevent="search()">
        <input
          v-model="query"
          type="search"
          :placeholder="__t('ui.workspace', '查找文字')"
          :aria-label="__t('ui.workspace', '查找 PDF 文字')"
          :disabled="!pdf"
        />
        <button type="submit" :disabled="!pdf || !query || searching">
          {{ searching ? __t('ui.workspace', '查找中…') : __t('ui.workspace', '查找') }}
        </button>
      </form>
      <small v-if="searchMessage">{{ searchMessage }}</small>
    </div>
    <div ref="stage" class="workspace-pdf__stage">
      <form
        v-if="passwordRequired"
        class="file-view-state file-view-password"
        @submit.prevent="unlock"
      >
        <span>
          {{
            passwordError
              ? __t('ui.workspace', '密码不正确，请重新输入')
              : __t('ui.workspace', '此 PDF 需要密码')
          }}
        </span>
        <input
          v-model="password"
          type="password"
          autocomplete="off"
          :aria-label="__t('ui.workspace', 'PDF 密码')"
        />
        <button class="workspace-pdf__unlock" type="submit">
          {{ __t('ui.workspace', '打开') }}
        </button>
      </form>
      <div v-if="loading" class="file-view-state">{{ __t('ui.workspace', '正在读取 PDF…') }}</div>
      <div
        v-show="pdf && !loading"
        class="workspace-pdf__sheet"
        :style="{
          width: `${pageSize.width}px`,
          height: `${pageSize.height}px`,
          '--total-scale-factor': pageSize.totalScale,
          '--scale-factor': pageSize.scale,
        }"
      >
        <canvas ref="canvas" />
        <div ref="textContainer" class="workspace-pdf__text textLayer" />
      </div>
      <span v-if="rendering && !loading" class="workspace-pdf__rendering">
        {{ __t('ui.workspace', '正在绘制…') }}
      </span>
    </div>
  </div>
</template>
<style scoped>
.workspace-pdf {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.workspace-pdf__search {
  display: flex;
  gap: 4px;
}
.workspace-pdf__search input {
  width: 120px;
  min-width: 70px;
}
.workspace-pdf__stage {
  position: relative;
  min-height: 0;
  flex: 1;
  padding: 24px;
  overflow: auto;
  background: var(--ui-bg-surface-soft);
}
.workspace-pdf__sheet {
  --scale-round-x: 1px;
  --scale-round-y: 1px;
  position: relative;
  margin: 0 auto;
  background: white;
  color-scheme: only light;
  box-shadow:
    1px 2px 0 var(--ui-border-default),
    3px 4px 0 var(--ui-border-subtle);
}
.workspace-pdf__sheet canvas {
  display: block;
}
.workspace-pdf__rendering {
  position: sticky;
  left: 8px;
  bottom: 8px;
  padding: 4px 8px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.workspace-pdf__unlock {
  padding: 5px 14px;
  border: 1px solid var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  cursor: pointer;
}
/* 文字层遵循 PDF.js 的缩放坐标，保留复制能力，且不执行文档脚本。 */
.workspace-pdf__text {
  position: absolute;
  inset: 0;
  overflow: clip;
  text-align: initial;
  line-height: 1;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  transform-origin: 0 0;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.workspace-pdf__text :deep(:is(span, br)) {
  position: absolute;
  color: transparent;
  white-space: pre;
  cursor: text;
  transform-origin: 0 0;
  user-select: text;
}
.workspace-pdf__text :deep(> :not(.markedContent)),
.workspace-pdf__text :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  --scale-x: 1;
  --rotate: 0deg;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.workspace-pdf__text :deep(.markedContent) {
  display: contents;
}
.workspace-pdf__text[data-main-rotation='90'] {
  transform: rotate(90deg) translateY(-100%);
}
.workspace-pdf__text[data-main-rotation='180'] {
  transform: rotate(180deg) translate(-100%, -100%);
}
.workspace-pdf__text[data-main-rotation='270'] {
  transform: rotate(270deg) translateX(-100%);
}
.workspace-pdf__text :deep(::selection) {
  background: #35b6ef55;
  color: transparent;
}
.workspace-pdf__text :deep(.workspace-pdf-match) {
  background: #ffc85766;
}
</style>
