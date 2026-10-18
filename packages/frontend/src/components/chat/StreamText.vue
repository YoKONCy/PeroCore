<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{ source: string }>()
const root = ref<HTMLElement>()
let previous = ''

/** 追加文本节点而非反复替换整段 DOM，保留正在阅读的文字选区。 */
function update(): void {
  const element = root.value
  if (!element) return
  const source = props.source
  if (!source.startsWith(previous)) {
    element.replaceChildren()
    previous = ''
  }
  let offset = previous.length
  const last = element.lastChild instanceof Text ? element.lastChild : null
  if (last && offset < source.length) {
    const capacity = Math.max(0, 2048 - last.length)
    const trailingSurrogate = /[\uD800-\uDBFF]$/.test(last.data)
    let end = Math.min(source.length, offset + Math.max(capacity, trailingSurrogate ? 1 : 0))
    if (end > offset && end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]!)) end--
    if (end > offset) last.appendData(source.slice(offset, end))
    offset = end
  }
  const fragment = document.createDocumentFragment()
  while (offset < source.length) {
    let end = Math.min(source.length, offset + 2048)
    if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]!)) end--
    fragment.append(document.createTextNode(source.slice(offset, end)))
    offset = end
  }
  if (fragment.childNodes.length) element.append(fragment)
  previous = source
}
onMounted(update)
watch(() => props.source, update, { flush: 'post' })
</script>

<template><div ref="root" class="chat-rich-text chat-rich-text--stream" /></template>
