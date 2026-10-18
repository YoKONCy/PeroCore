import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { CanvasItem } from '../types'
import type { CanvasStore } from './useCanvas'

export function useCanvasSearch(
  store: CanvasStore,
  reveal: (item: CanvasItem) => void,
  enabled: () => boolean = () => true,
) {
  const open = ref(false),
    query = ref(''),
    term = ref(''),
    currentId = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  const index = computed(() => {
    const items = new Map(store.project.items.map((item) => [item.id, item])),
      linked = new Map<string, string[]>()
    for (const edge of store.project.edges || []) {
      const source = items.get(edge.source)
      if (edge.historical || source?.content.kind !== 'text') continue
      const values = linked.get(edge.target) || []
      values.push(source.content.text || '')
      linked.set(edge.target, values)
    }
    return store.project.items.map((item) => {
      const inputs = item.content.inputs || {},
        schema = item.content.step?.inputSchema.properties || {}
      const prompts = Object.entries(inputs).flatMap(([name, value]) =>
        typeof value === 'string' &&
        ((schema[name]?.type === 'string' && !schema[name]?.enum) ||
          /prompt|text|description/i.test(name))
          ? [value]
          : [],
      )
      return {
        item,
        text: [
          item.content.comment,
          item.content.text,
          item.content.promptText,
          ...prompts,
          ...(linked.get(item.id) || []),
        ]
          .filter(Boolean)
          .join('\n')
          .normalize('NFKC')
          .toLocaleLowerCase(),
      }
    })
  })
  const matches = computed(() => {
    const words = term.value.normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return words.length
      ? index.value
          .filter((entry) => words.every((word) => entry.text.includes(word)))
          .map((entry) => entry.item)
      : []
  })
  const ids = computed(() => new Set(matches.value.map((item) => item.id)))
  const position = computed(() =>
    Math.max(0, matches.value.findIndex((item) => item.id === currentId.value) + 1),
  )
  function jump(direction = 1) {
    if (query.value.trim() !== term.value) {
      clearTimeout(timer)
      term.value = query.value.trim()
      currentId.value = ''
    }
    if (!matches.value.length) return
    const current = matches.value.findIndex((item) => item.id === currentId.value)
    const index =
      current < 0
        ? direction < 0
          ? matches.value.length - 1
          : 0
        : (current + direction + matches.value.length) % matches.value.length
    const item = matches.value[index]!
    currentId.value = item.id
    reveal(item)
  }
  async function show() {
    open.value = true
    await nextTick()
    document.querySelector<HTMLInputElement>('.canvas-search-input')?.focus()
  }
  function close() {
    open.value = false
    query.value = ''
    term.value = ''
    currentId.value = ''
    clearTimeout(timer)
  }
  watch(query, (value) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      term.value = value.trim()
      currentId.value = ''
      jump(1)
    }, 140)
  })
  watch(
    () => matches.value.map((item) => item.id).join('|'),
    () => {
      if (term.value && matches.value.length && !ids.value.has(currentId.value)) jump(1)
      if (!matches.value.length) currentId.value = ''
    },
  )
  watch(() => store.project.id, close)
  function key(event: KeyboardEvent) {
    if (!enabled()) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopImmediatePropagation()
      void show()
    } else if (open.value && event.key === 'F3') {
      event.preventDefault()
      event.stopImmediatePropagation()
      jump(event.shiftKey ? -1 : 1)
    }
  }
  window.addEventListener('keydown', key, true)
  onBeforeUnmount(() => {
    clearTimeout(timer)
    window.removeEventListener('keydown', key, true)
  })
  return { open, query, matches, ids, position, currentId, show, close, jump }
}
