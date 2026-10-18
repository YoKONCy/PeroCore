<script setup lang="ts">
import { ref } from 'vue'
import type { FieldSchema } from '../types'
import PictoriaSelect from './PictoriaSelect.vue'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{ modelValue: FieldSchema }>()
const emit = defineEmits<{
  'update:modelValue': [value: FieldSchema]
  remove: [name: string]
  checkpoint: []
}>()
const adding = ref(false),
  name = ref(''),
  problem = ref('')
const options = [
  { value: 'string', label: '文本' },
  { value: 'image', label: '素材' },
  { value: 'images', label: '多素材' },
  { value: 'number', label: '数字' },
  { value: 'integer', label: '整数' },
  { value: 'boolean', label: '开关' },
  { value: 'object', label: 'JSON' },
]
const asset = () => ({
  type: 'object',
  properties: { assetId: { type: 'string' } },
  required: ['assetId'],
  additionalProperties: false,
})
const kind = (field: FieldSchema) =>
  field.properties?.assetId
    ? 'image'
    : field.items?.properties?.assetId
      ? 'images'
      : field.type || 'string'
function patch(key: string, field: FieldSchema) {
  emit('update:modelValue', {
    ...props.modelValue,
    properties: { ...props.modelValue.properties, [key]: field },
  })
}
function changeType(key: string, value: string) {
  emit('checkpoint')
  patch(key, {
    ...(value === 'image'
      ? asset()
      : value === 'images'
        ? { type: 'array', items: asset() }
        : { type: value }),
    title: props.modelValue.properties?.[key]?.title,
  })
}
function add() {
  const key = name.value.trim()
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key) || props.modelValue.properties?.[key]) {
    problem.value = '字段名无效或重复'
    return
  }
  emit('checkpoint')
  patch(key, { type: 'string', title: key })
  adding.value = false
  name.value = ''
  problem.value = ''
}
function required(key: string, value: boolean) {
  emit('checkpoint')
  const entries = new Set(props.modelValue.required || [])
  if (value) entries.add(key)
  else entries.delete(key)
  emit('update:modelValue', { ...props.modelValue, required: [...entries] })
}
function remove(key: string) {
  emit('checkpoint')
  const properties = { ...props.modelValue.properties }
  delete properties[key]
  emit('update:modelValue', {
    ...props.modelValue,
    properties,
    required: props.modelValue.required?.filter((name) => name !== key),
  })
  emit('remove', key)
}
function advanced(event: Event) {
  try {
    const schema = JSON.parse((event.target as HTMLTextAreaElement).value)
    if (schema?.type !== 'object') throw new Error()
    emit('checkpoint')
    emit('update:modelValue', schema)
    problem.value = ''
  } catch {
    problem.value = 'Schema 无效'
  }
}
</script>
<template>
  <div class="workflow-fields">
    <div v-for="(field, key) in modelValue.properties" :key="key" class="workflow-interface-field">
      <header>
        <code>{{ key }}</code>
        <label class="workflow-checkbox">
          <input
            type="checkbox"
            :checked="modelValue.required?.includes(String(key))"
            @change="required(String(key), ($event.target as HTMLInputElement).checked)"
          />
          必填
        </label>
        <button class="icon-button" aria-label="删除字段" @click="remove(String(key))">
          <Icon name="close" :size="13" />
        </button>
      </header>
      <input
        :value="field.title || key"
        aria-label="显示名称"
        @focus="emit('checkpoint')"
        @input="patch(String(key), { ...field, title: ($event.target as HTMLInputElement).value })"
      />
      <PictoriaSelect
        :model-value="kind(field)"
        :options="options"
        @update:model-value="changeType(String(key), $event)"
      />
    </div>
    <div v-if="adding" class="workflow-new-field">
      <input v-model="name" placeholder="字段名" maxlength="128" @keydown.enter.prevent="add" />
      <button class="text-button" @click="add">添加</button>
    </div>
    <button v-else class="text-button" @click="adding = true">
      <Icon name="plus" :size="13" />
      添加字段
    </button>
    <details class="workflow-advanced">
      <summary>Schema</summary>
      <textarea
        :value="JSON.stringify(modelValue, null, 2)"
        rows="8"
        aria-label="JSON Schema"
        @change="advanced"
      />
    </details>
    <small v-if="problem" class="workflow-field-error">{{ problem }}</small>
  </div>
</template>
