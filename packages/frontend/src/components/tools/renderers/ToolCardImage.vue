<script setup lang="ts">
import { computed } from 'vue'
import { imagePreviewsFromToolResult } from '@infos/shared'
import ToolImagePreview from './ToolImagePreview.vue'

const props = withDefaults(
  defineProps<{
    result?: string
    isError?: boolean
    active?: boolean
    toolName?: string
  }>(),
  { active: false, result: undefined, toolName: 'read_image' },
)
const emit = defineEmits<{ interact: [] }>()
const previews = computed(() => imagePreviewsFromToolResult(props.toolName, props.result))
const errors = computed(() => {
  if (!props.result) return []
  try {
    const value = JSON.parse(props.result) as {
      error?: string
      errors?: Array<{ source?: string; error?: string }>
      screenshots?: Array<{ previewError?: string }>
    }
    const items = Array.isArray(value.errors)
      ? value.errors.map((item) => `${item?.source ?? '图片'}：${item?.error ?? '读取失败'}`)
      : []
    if (typeof value.error === 'string') items.unshift(value.error)
    for (const [index, screenshot] of (value.screenshots ?? []).entries()) {
      if (typeof screenshot.previewError === 'string')
        items.push(`截图 ${index + 1}：${screenshot.previewError}`)
    }
    if (props.isError && !items.length) items.push('图片读取失败')
    return items
  } catch {
    return props.isError ? [props.result] : []
  }
})
</script>

<template>
  <div class="tool-image-gallery" :class="{ 'tool-image-gallery--batch': previews.length > 1 }">
    <p v-if="previews.length > 1" class="tool-image-gallery__note">
      {{ previews.length }} 张图片 · 按获取顺序排列 · 点击图片放大观察
    </p>
    <p v-for="(error, index) in errors" :key="index" class="tool-image-gallery__error">
      {{ error }}
    </p>
    <ToolImagePreview
      v-for="preview in previews"
      :key="preview.id"
      :preview="preview"
      :active="active"
      @interact="emit('interact')"
    />
    <p v-if="!previews.length && !errors.length" class="tool-image-gallery__note">
      {{ result === undefined ? '正在读取图片…' : '未保存图片预览' }}
    </p>
  </div>
</template>

<style scoped>
.tool-image-gallery {
  display: grid;
  gap: 10px;
}
.tool-image-gallery--batch {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
}
.tool-image-gallery__note,
.tool-image-gallery__error {
  grid-column: 1 / -1;
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
}
.tool-image-gallery__note {
  color: var(--ui-text-tertiary);
}
.tool-image-gallery__error {
  color: var(--ui-danger);
}
</style>
