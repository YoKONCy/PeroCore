<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getApiResourceHeaders } from '../../api/transport'

const props = defineProps<{ src: string }>()
const emit = defineEmits<{ error: [] }>()
const canvas = ref<HTMLCanvasElement | null>(null)
let task: PDFDocumentLoadingTask | undefined
let render: RenderTask | undefined
let revision = 0
GlobalWorkerOptions.workerSrc = workerUrl
async function release() {
  render?.cancel()
  const previous = task
  task = undefined
  await previous?.destroy().catch(() => undefined)
}
watch(
  () => props.src,
  async (src) => {
    const version = ++revision
    await release()
    if (!src || version !== revision) return
    const assets = new URL('pdf-assets/', document.baseURI).href
    const loading = getDocument({
      url: src,
      httpHeaders: getApiResourceHeaders(src),
      withCredentials: Boolean(Object.keys(getApiResourceHeaders(src)).length),
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
      iccUrl: `${assets}iccs/`,
      enableXfa: false,
      disableStream: true,
      disableAutoFetch: true,
      canvasMaxAreaInBytes: 16 * 1024 * 1024,
    })
    task = loading
    loading.onPassword = () => {
      if (version === revision) emit('error')
      void loading.destroy().catch(() => undefined)
    }
    try {
      const pdf = await loading.promise
      const page = await pdf.getPage(1)
      if (version !== revision || !canvas.value) return
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 480 / base.width) })
      const target = canvas.value
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      render = page.render({ canvas: target, viewport })
      await render.promise
      // 缩略图只保留画布，不继续占用 PDF Worker 与整份文档。
      await loading.destroy().catch(() => undefined)
      if (task === loading) task = undefined
    } catch {
      if (version === revision) emit('error')
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++revision
  void release()
})
</script>
<template><canvas ref="canvas" aria-hidden="true" /></template>
<style scoped>
canvas {
  display: block;
  width: 100%;
  height: auto;
  background: white;
}
</style>
