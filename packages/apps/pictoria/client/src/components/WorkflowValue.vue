<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, reactive, ref, watch } from 'vue'
import type { Asset, FieldSchema } from '../types'
import PictoriaSelect from './PictoriaSelect.vue'
import Icon from './PictoriaIcon.vue'
import AssetLibraryPicker from './AssetLibraryPicker.vue'
const props = defineProps<{
  modelValue?: unknown
  schema?: FieldSchema
  assets?: Asset[]
  aspectRatio?: string
  owner?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown]; upload: [] }>()
const problem = ref('')
const libraryOpen = ref(false),
  selectedAssets = reactive<Record<string, Asset>>({})
const asset = computed(() => Boolean(props.schema?.properties?.assetId))
const singleAssetId = computed(() =>
  props.modelValue && typeof props.modelValue === 'object' && 'assetId' in props.modelValue
    ? String(props.modelValue.assetId || '')
    : '',
)
const assets = computed(
  () => props.schema?.type === 'array' && Boolean(props.schema.items?.properties?.assetId),
)
const references = computed(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as Array<{ assetId: string }>) : [],
)
function json(event: Event) {
  try {
    emit('update:modelValue', JSON.parse((event.target as HTMLTextAreaElement).value))
    problem.value = ''
  } catch {
    problem.value = 'JSON 无效'
  }
}
function move(index: number, direction: number) {
  const values = [...references.value],
    next = index + direction
  if (next < 0 || next >= values.length) return
  ;[values[index], values[next]] = [values[next]!, values[index]!]
  emit('update:modelValue', values)
}
const selectedIds = computed(() =>
  assets.value
    ? references.value.map((item) => item.assetId)
    : [(props.modelValue as { assetId?: string })?.assetId || ''].filter(Boolean),
)
const mediaType = computed(() =>
  /图|image|mask/i.test(props.schema?.title || '')
    ? 'image'
    : /视频|video/i.test(props.schema?.title || '')
      ? 'video'
      : /音频|audio/i.test(props.schema?.title || '')
        ? 'audio'
        : 'all',
)
function chooseLibrary(value: Asset) {
  if (selectedIds.value.includes(value.id)) return
  if (assets.value && references.value.length >= (props.schema?.maxItems ?? 20)) {
    problem.value = '参考数量已满'
    return
  }
  selectedAssets[value.id] = value
  emit(
    'update:modelValue',
    assets.value ? [...references.value, { assetId: value.id }] : { assetId: value.id },
  )
}
const choices = computed(() =>
  [
    ...new Map(
      [...(props.assets || []), ...Object.values(selectedAssets)].map((value) => [value.id, value]),
    ).values(),
  ].filter(
    (value) => mediaType.value === 'all' || value.mimeType.startsWith(`${mediaType.value}/`),
  ),
)
function chooseExisting(id: string) {
  const value = choices.value.find((asset) => asset.id === id)
  if (value) chooseLibrary(value)
}
watch(
  () => props.owner,
  () => {
    libraryOpen.value = false
    for (const id of Object.keys(selectedAssets)) delete selectedAssets[id]
  },
)
</script>
<template>
  <div class="workflow-value">
    <button v-if="(asset || assets) && owner" class="text-button" @click="libraryOpen = true">
      <Icon name="image" :size="14" />
      {{ __t('apps.pictoria.ui', '资源库') }}
    </button>
    <AssetLibraryPicker
      v-if="libraryOpen && owner"
      :owner="owner"
      :selected="selectedIds"
      :multiple="assets"
      :limit="assets ? (schema?.maxItems ?? 20) : 1"
      :type="mediaType"
      @select="chooseLibrary"
      @close="libraryOpen = false"
    />
    <PictoriaSelect
      v-if="schema?.enum"
      :model-value="String(modelValue ?? '')"
      :options="schema.enum.map((value) => ({ value: String(value), label: String(value) }))"
      :aspect-ratio="aspectRatio"
      @update:model-value="
        emit(
          'update:modelValue',
          schema?.enum?.find((value) => String(value) === $event),
        )
      "
    />
    <template v-else-if="asset">
      <PictoriaSelect
        :model-value="singleAssetId"
        :options="choices.map((item) => ({ value: item.id, label: item.meta?.title || item.name }))"
        :placeholder="__t('apps.pictoria.ui', '选择素材')"
        @update:model-value="chooseExisting"
      />
      <button class="text-button" @click="emit('upload')">
        <Icon name="upload" :size="13" />
        {{ __t('apps.pictoria.ui', '上传') }}
      </button>
    </template>
    <template v-else-if="assets">
      <div
        v-for="(item, index) in references"
        :key="`${item.assetId}:${index}`"
        class="workflow-reference-row"
      >
        <small>{{ index + 1 }}</small>
        <span>
          {{
            selectedAssets[item.assetId]?.meta?.title ||
            selectedAssets[item.assetId]?.name ||
            props.assets?.find((asset) => asset.id === item.assetId)?.name ||
            item.assetId
          }}
        </span>
        <button
          class="icon-button"
          :disabled="!index"
          :aria-label="__t('apps.pictoria.ui', '向前')"
          @click="move(index, -1)"
        >
          <Icon name="chevron" class="workflow-left" :size="12" />
        </button>
        <button
          class="icon-button"
          :disabled="index === references.length - 1"
          :aria-label="__t('apps.pictoria.ui', '向后')"
          @click="move(index, 1)"
        >
          <Icon name="chevron" :size="12" />
        </button>
        <button
          class="icon-button"
          :aria-label="__t('apps.pictoria.ui', '移除')"
          @click="
            emit(
              'update:modelValue',
              references.filter((_, row) => row !== index),
            )
          "
        >
          <Icon name="close" :size="12" />
        </button>
      </div>
      <PictoriaSelect
        model-value=""
        :options="choices.map((item) => ({ value: item.id, label: item.name }))"
        :placeholder="__t('apps.pictoria.ui', '添加素材')"
        @update:model-value="chooseExisting"
      />
      <button class="text-button" @click="emit('upload')">
        <Icon name="upload" :size="13" />
        {{ __t('apps.pictoria.ui', '上传') }}
      </button>
    </template>
    <label v-else-if="schema?.type === 'boolean'" class="workflow-checkbox">
      <input
        type="checkbox"
        :checked="Boolean(modelValue)"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      {{ __t('apps.pictoria.ui', '开启') }}
    </label>
    <input
      v-else-if="['number', 'integer'].includes(schema?.type || '')"
      type="number"
      :value="modelValue as number"
      :min="schema?.minimum"
      :max="schema?.maximum"
      :step="schema?.type === 'integer' ? 1 : 'any'"
      @input="
        emit(
          'update:modelValue',
          ($event.target as HTMLInputElement).value === ''
            ? undefined
            : Number(($event.target as HTMLInputElement).value),
        )
      "
    />
    <template v-else-if="['object', 'array'].includes(schema?.type || '')">
      <textarea
        :value="modelValue === undefined ? '' : JSON.stringify(modelValue, null, 2)"
        rows="3"
        placeholder="JSON"
        @change="json"
      />
      <small v-if="problem" class="workflow-field-error">{{ problem }}</small>
    </template>
    <textarea
      v-else
      :value="(modelValue as string) || ''"
      :maxlength="schema?.maxLength || 64000"
      rows="3"
      :placeholder="__t('apps.pictoria.ui', '填写内容')"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>
