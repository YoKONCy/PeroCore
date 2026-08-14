<script setup lang="ts">
/**
 * StoryImportDialog — 故事导入记忆共享弹窗
 *
 * 总览与核心记忆页共用同一表现和同一个 /memories/import 后端入口，
 * 由 MemoryImporter 将长文本拆解为多个长期记忆节点。
 */
import { ref, watch } from 'vue'
import { PixelIcon, PButton, PDialog } from '../pixel'
import { memoryApi } from '../../api/modules/memoryApi'
import { useNotificationStore } from '../../stores'
import { logger } from '../../lib/logger'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    agentId?: string
  }>(),
  {
    agentId: 'pero',
  },
)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  imported: [count: number]
}>()

const notif = useNotificationStore()
const storyText = ref('')
const isImporting = ref(false)

function close(): void {
  if (!isImporting.value) emit('update:modelValue', false)
}

async function importStory(): Promise<void> {
  const text = storyText.value.trim()
  if (!text || isImporting.value) return

  isImporting.value = true
  try {
    const res = await memoryApi.importStory({
      text,
      agentId: props.agentId,
      source: 'import',
    })
    const imported = res.data?.imported ?? 0
    storyText.value = ''
    emit('imported', imported)
    emit('update:modelValue', false)
    notif.toast(`已导入 ${imported} 条记忆`, { type: 'success', title: '故事导入' })
  } catch (error) {
    logger.error('StoryImportDialog', '故事导入失败', error)
    notif.toast('导入失败，请稍后重试', { type: 'error', title: '故事导入' })
  } finally {
    isImporting.value = false
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible && !isImporting.value) storyText.value = ''
  },
)
</script>

<template>
  <PDialog
    :model-value="modelValue"
    title="导入故事生成记忆"
    width="600px"
    @update:model-value="close"
  >
    <div class="story-import-dialog space-y-4">
      <div class="story-import-copy text-sm leading-relaxed space-y-1.5">
        <p>你可以将小说设定、人物背景、日记或长篇回忆录粘贴在这里。</p>
        <p>系统将阅读这些内容，并拆解为一系列关键记忆节点存入长期记忆。</p>
        <p class="story-import-notice mt-2 text-xs font-bold flex items-center gap-1.5 px-3 py-2">
          <PixelIcon name="alert" size="xs" />
          注意：这是一个耗时操作，且会消耗较多 Token。
        </p>
      </div>
      <textarea
        v-model="storyText"
        rows="10"
        placeholder="在此粘贴长文本..."
        class="story-import-input w-full px-4 py-3 border-2 text-sm leading-relaxed resize-none outline-none transition-all duration-300"
      />
    </div>
    <template #footer>
      <PButton variant="secondary" size="sm" :disabled="isImporting" @click="close">取消</PButton>
      <PButton
        variant="primary"
        size="sm"
        :loading="isImporting"
        :disabled="!storyText.trim()"
        @click="importStory"
      >
        开始生成
      </PButton>
    </template>
  </PDialog>
</template>

<style scoped>
/* Teleport 弹窗中的统一语义色。 */
.story-import-dialog {
  color: var(--ui-text-primary);
}
.story-import-copy {
  color: var(--ui-text-secondary);
}
.story-import-notice {
  color: var(--ui-warning);
  background: var(--ui-warning-soft);
  border: 1px solid color-mix(in srgb, var(--ui-warning) 35%, transparent);
}
.story-import-input {
  color: var(--ui-text-primary);
  background: var(--dash-input-bg);
  border-color: var(--dash-input-border);
}
.story-import-input:focus {
  border-color: var(--ui-accent-sky);
}
</style>
