<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Asset } from '../types'
import { pictoria } from '../services/transport'
import Icon from './PictoriaIcon.vue'
const props = withDefaults(
  defineProps<{
    owner: string
    selected?: string[]
    multiple?: boolean
    limit?: number
    type?: 'all' | 'image' | 'video' | 'audio'
  }>(),
  { selected: () => [], limit: 1, type: 'all' },
)
const emit = defineEmits<{ select: [asset: Asset]; close: [] }>()
const items = ref<Asset[]>([]),
  total = ref(0),
  query = ref(''),
  kind = ref<'materials' | 'artworks'>('materials'),
  busy = ref(false),
  error = ref(''),
  search = ref<HTMLInputElement | null>(null)
let generation = 0,
  disposed = false,
  timer: ReturnType<typeof setTimeout> | undefined
const previous = document.activeElement
const full = computed(() => props.multiple && props.selected.length >= props.limit)
async function load(more = false) {
  const current = ++generation,
    owner = props.owner,
    offset = more ? items.value.length : 0
  busy.value = true
  error.value = ''
  if (!more) items.value = []
  try {
    const value = await pictoria.operation<{ items: Asset[]; total: number }>(
      owner,
      'library.list',
      { kind: kind.value, type: props.type, query: query.value.trim(), offset, limit: 60 },
    )
    if (!disposed && current === generation) {
      items.value = more ? [...items.value, ...value.items] : value.items
      total.value = value.total
    }
  } catch (failure) {
    if (!disposed && current === generation)
      error.value = failure instanceof Error ? failure.message : '资源库读取失败'
  } finally {
    if (!disposed && current === generation) busy.value = false
  }
}
function choose(asset: Asset) {
  if (full.value || props.selected.includes(asset.id)) return
  emit('select', asset)
  if (!props.multiple) emit('close')
}
function trap(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const controls = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled),input,[tabindex="0"]',
    ),
  )
  if (event.shiftKey && document.activeElement === controls[0]) {
    event.preventDefault()
    controls.at(-1)?.focus()
  } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
    event.preventDefault()
    controls[0]?.focus()
  }
}
watch(
  () => [query.value, kind.value, props.owner, props.type],
  () => {
    generation++
    clearTimeout(timer)
    timer = setTimeout(() => {
      void load()
    }, 220)
  },
)
onMounted(() => {
  void load()
  void nextTick(() => search.value?.focus())
})
onBeforeUnmount(() => {
  disposed = true
  generation++
  clearTimeout(timer)
  if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
})
</script>
<template>
  <Teleport to="body">
    <div
      class="recovery-backdrop asset-library-backdrop"
      data-ui
      @pointerdown.self="emit('close')"
      @keydown.esc.stop="emit('close')"
      @keydown.stop="trap"
    >
      <section
        class="floating-panel asset-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="选择参考素材"
      >
        <header>
          <strong>选择素材</strong>
          <button class="icon-button" aria-label="关闭" @click="emit('close')">
            <Icon name="close" :size="18" />
          </button>
        </header>
        <div class="asset-library-tools">
          <nav>
            <button :class="{ active: kind === 'materials' }" @click="kind = 'materials'">
              素材
            </button>
            <button :class="{ active: kind === 'artworks' }" @click="kind = 'artworks'">
              成品
            </button>
          </nav>
          <label class="reference-search">
            <Icon name="search" :size="15" />
            <input ref="search" v-model="query" maxlength="200" placeholder="搜索资源库…" />
          </label>
        </div>
        <div class="asset-library-list" :aria-busy="busy">
          <button
            v-for="asset in items"
            :key="asset.id"
            class="asset-library-choice"
            :class="{ picked: selected.includes(asset.id) }"
            :disabled="selected.includes(asset.id) || full"
            @click="choose(asset)"
          >
            <span class="asset-library-symbol">
              <Icon
                :name="
                  asset.mimeType.startsWith('video/')
                    ? 'play'
                    : asset.mimeType.startsWith('audio/')
                      ? 'sound'
                      : 'image'
                "
                :size="22"
              />
            </span>
            <span>
              <strong>{{ asset.meta?.title || asset.name }}</strong>
              <small>
                {{ asset.mimeType.split('/')[1]?.toUpperCase() }} ·
                {{ (asset.sizeBytes / 1024 / 1024).toFixed(1) }} MB
              </small>
            </span>
            <Icon :name="selected.includes(asset.id) ? 'check' : 'plus'" :size="16" />
          </button>
          <p v-if="!items.length">{{ error || (busy ? '读取中…' : '暂无素材') }}</p>
        </div>
        <footer>
          <span>{{ selected.length }} / {{ limit }}</span>
          <button v-if="error" class="text-button" :disabled="busy" @click="load()">重试</button>
          <button
            v-else-if="items.length < total"
            class="text-button"
            :disabled="busy"
            @click="load(true)"
          >
            {{ busy ? '读取中…' : '加载更多' }}
          </button>
          <button class="create-button" @click="emit('close')">完成</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.asset-library-backdrop {
  z-index: 700;
}
.asset-library-dialog {
  width: min(620px, calc(100vw - 40px));
  max-height: min(680px, calc(100vh - 60px));
  display: flex;
  flex-direction: column;
  padding: 22px;
  border-radius: 18px;
  gap: 18px;
  animation: library-appear 0.18s ease-out;
}
header,
footer,
.asset-library-tools,
.asset-library-choice {
  display: flex;
  align-items: center;
  gap: 12px;
}
header strong,
footer span {
  flex: 1;
}
header strong {
  font-size: 17px;
}
.asset-library-tools nav {
  display: flex;
  gap: 4px;
  background: var(--field);
  padding: 4px;
  border-radius: 10px;
  flex-shrink: 0;
}
nav button {
  padding: 7px 11px;
  border-radius: 7px;
  color: var(--muted);
  transition:
    background 0.18s,
    color 0.18s;
}
nav .active {
  background: var(--accent-soft);
  color: var(--accent);
}
.reference-search {
  flex: 1;
  min-width: 0;
}
.asset-library-list {
  min-height: 160px;
  overflow-y: auto;
  display: grid;
  gap: 7px;
}
.asset-library-choice {
  width: 100%;
  text-align: left;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--field);
  transition:
    background 0.18s,
    border-color 0.18s;
}
.asset-library-choice:hover,
.asset-library-choice.picked {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.asset-library-choice > span:nth-child(2) {
  flex: 1;
  min-width: 0;
}
.asset-library-choice strong {
  display: block;
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.asset-library-choice small,
footer span {
  color: var(--muted);
  font-size: 12px;
}
.asset-library-symbol {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--hover);
  color: var(--accent);
}
.asset-library-list > p {
  margin: auto;
  color: var(--muted);
}
@keyframes library-appear {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .asset-library-dialog {
    animation: none;
  }
}
</style>
