<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Asset, AssetReference, CanvasItem } from '../types'
import Icon from './PictoriaIcon.vue'
import AssetLibraryPicker from './AssetLibraryPicker.vue'

const props = defineProps<{
  references: AssetReference[]
  candidates: CanvasItem[]
  thumbnails: Record<string, string>
  multiple: boolean
  limit: number
  online: boolean
  owner?: string
  fieldName?: string
}>()
const emit = defineEmits<{
  add: [assetId: string]
  library: [asset: Asset]
  remove: [assetId: string]
  move: [assetId: string, direction: number]
  preview: [assetId: string]
}>()
const libraryOpen = ref(false)
const mediaType = computed(() =>
  /image|mask|图/i.test(props.fieldName || '')
    ? 'image'
    : /video|视频/i.test(props.fieldName || '')
      ? 'video'
      : /audio|音频/i.test(props.fieldName || '')
        ? 'audio'
        : 'all',
)
const root = ref<HTMLElement | null>(null),
  open = ref(false),
  query = ref('')
const choices = computed(() => {
  const seen = new Set<string>(),
    search = query.value.trim().toLocaleLowerCase()
  return props.candidates.filter((item) => {
    const id = item.content.assetId
    if (!id || seen.has(id)) return false
    seen.add(id)
    return !search || (item.content.name || '').toLocaleLowerCase().includes(search)
  })
})
const full = computed(() => props.multiple && props.references.length >= props.limit)
function picked(id: string) {
  return props.references.some((ref) => ref.assetId === id)
}
function add(id: string) {
  if (picked(id) || full.value) return
  emit('add', id)
  if (!props.multiple) open.value = false
}
function outside(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}
function close() {
  open.value = false
}
function key(event: KeyboardEvent) {
  if (['Delete', 'Backspace', ' '].includes(event.key)) event.stopPropagation()
}
watch(
  () => [props.references.map((ref) => ref.assetId).join('|'), props.online],
  () => {
    if (props.online)
      for (const ref of props.references)
        if (ref.mimeType?.startsWith('image/')) emit('preview', ref.assetId)
  },
  { immediate: true },
)
watch(open, (value) => {
  if (value) {
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', close)
  } else {
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('blur', close)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('blur', close)
})
</script>

<template>
  <div ref="root" class="reference-input" data-ui @keydown="key" @keydown.esc.stop="open = false">
    <div class="reference-strip" role="list" aria-label="按顺序排列的参考素材">
      <div
        v-for="(reference, index) in references"
        :key="reference.assetId"
        class="reference-tile"
        role="listitem"
        :title="`${index + 1}. ${reference.name}`"
      >
        <img
          v-if="thumbnails[reference.assetId] && reference.mimeType?.startsWith('image/')"
          :src="thumbnails[reference.assetId]"
          :alt="reference.name"
          draggable="false"
        />
        <Icon
          v-else
          :name="
            reference.mimeType?.startsWith('video/')
              ? 'play'
              : reference.mimeType?.startsWith('audio/')
                ? 'sound'
                : 'image'
          "
          :size="19"
        />
        <b class="reference-number">{{ index + 1 }}</b>
        <button
          class="reference-remove"
          :aria-label="`移除参考 ${index + 1}：${reference.name}`"
          title="移除引用"
          @click="emit('remove', reference.assetId)"
        >
          <Icon name="close" :size="11" />
        </button>
        <div v-if="multiple && references.length > 1" class="reference-order">
          <button
            :disabled="!index"
            :aria-label="`前移参考 ${index + 1}`"
            title="前移"
            @click="emit('move', reference.assetId, -1)"
          >
            ←
          </button>
          <button
            :disabled="index === references.length - 1"
            :aria-label="`后移参考 ${index + 1}`"
            title="后移"
            @click="emit('move', reference.assetId, 1)"
          >
            →
          </button>
        </div>
      </div>
      <span v-if="!references.length" class="reference-empty">
        <Icon name="link" :size="14" />
        连接或添加素材
      </span>
    </div>
    <div class="reference-toolbar">
      <button
        class="reference-add"
        :aria-expanded="open"
        @click="
          () => {
            open = !open
            query = ''
          }
        "
      >
        <Icon name="plus" :size="12" />
        {{
          full ? '查看素材' : multiple ? '添加参考' : references.length ? '更换素材' : '添加素材'
        }}
      </button>
      <button
        v-if="owner"
        class="reference-add"
        :disabled="!online || full"
        @click="
          () => {
            open = false
            libraryOpen = true
          }
        "
      >
        <Icon name="image" :size="12" />
        资源库
      </button>
      <small>{{ references.length }} / {{ limit }}{{ full ? ' · 已满' : '' }}</small>
    </div>
    <AssetLibraryPicker
      v-if="libraryOpen && owner"
      :owner="owner"
      :selected="references.map((item) => item.assetId)"
      :multiple="multiple"
      :limit="limit"
      :type="mediaType"
      @select="emit('library', $event)"
      @close="libraryOpen = false"
    />
    <Transition name="float">
      <div v-if="open" class="reference-picker floating-panel">
        <label class="reference-search">
          <Icon name="search" :size="13" />
          <input v-model="query" placeholder="搜索画布素材…" aria-label="搜索画布素材" />
        </label>
        <div class="reference-choices">
          <button
            v-for="item in choices"
            :key="item.id"
            class="reference-choice"
            :class="{ picked: picked(item.content.assetId!) }"
            :disabled="picked(item.content.assetId!) || full"
            @click="add(item.content.assetId!)"
          >
            <Icon
              :name="
                item.content.mimeType?.startsWith('video/')
                  ? 'play'
                  : item.content.mimeType?.startsWith('audio/')
                    ? 'sound'
                    : 'image'
              "
              :size="14"
            />
            <span>{{ item.content.name || '未命名素材' }}</span>
            <Icon :name="picked(item.content.assetId!) ? 'check' : 'plus'" :size="13" />
          </button>
          <p v-if="!choices.length">{{ query ? '没有匹配的素材' : '先导入素材到画布' }}</p>
        </div>
        <small v-if="full">最多 {{ limit }} 份</small>
      </div>
    </Transition>
  </div>
</template>
