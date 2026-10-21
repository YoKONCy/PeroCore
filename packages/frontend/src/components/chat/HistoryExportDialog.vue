<script setup lang="ts">
import { t as __t } from '../../i18n/index'

/** 三大聊天页共用的历史导出选项弹窗。 */
import { computed, ref, watch } from 'vue'
import { PButton, PCheckbox, PDialog, PixelIcon } from '../pixel'
import type { HistoryExportOptions } from '../../utils/historyExport'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    allowStructuredContent?: boolean
    disabled?: boolean
  }>(),
  {
    title: undefined,
    allowStructuredContent: true,
    disabled: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [options: HistoryExportOptions]
}>()

const includeThinking = ref(false)
const displayTitle = computed(() => props.title ?? __t('ui.chat', '导出历史记录'))
const includeTools = ref(true)

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible) return
    includeThinking.value = false
    includeTools.value = true
  },
)

function confirm(): void {
  emit('confirm', {
    includeThinking: props.allowStructuredContent && includeThinking.value,
    includeTools: props.allowStructuredContent && includeTools.value,
  })
}
</script>

<template>
  <PDialog
    :model-value="modelValue"
    :title="displayTitle"
    width="420px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="history-export-dialog">
      <div class="history-export-dialog__intro">
        <PixelIcon name="download" size="md" />
        <div>
          <strong>{{ __t('ui.chat', '导出当前会话为 Markdown') }}</strong>
          <p>{{ __t('ui.chat', '文件直接保存到客户端，不会在服务端创建副本。') }}</p>
        </div>
      </div>
      <template v-if="allowStructuredContent">
        <PCheckbox v-model="includeThinking" :label="__t('ui.chat', '导出思考内容')" />
        <PCheckbox v-model="includeTools" :label="__t('ui.chat', '导出工具调用参数与结果')" />
      </template>
      <p v-else class="history-export-dialog__hint">
        {{ __t('ui.chat', '据点房间历史当前只持久化发言正文，没有思考块与工具调用记录。') }}
      </p>
    </div>

    <template #footer>
      <PButton variant="secondary" size="sm" @click="emit('update:modelValue', false)">
        {{ __t('ui.chat', '取消') }}
      </PButton>
      <PButton size="sm" :disabled="disabled" @click="confirm">
        <PixelIcon name="download" size="xs" />
        {{ __t('ui.chat', '导出 Markdown') }}
      </PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.history-export-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.history-export-dialog__intro {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  color: var(--ui-text-primary);
  background: var(--dash-panel-soft);
  border: 1px solid var(--ui-border-default);
}

.history-export-dialog__intro p,
.history-export-dialog__hint {
  margin: 4px 0 0;
  color: var(--ui-text-secondary);
  font-size: 12px;
  line-height: 1.6;
}
</style>
