<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { ref, watch } from 'vue'
import type { KnowledgeDocumentInfo } from '@infos/shared'
import { PButton, PDialog, PixelIcon } from '../pixel'
import { knowledgeApi } from '../../api/modules/knowledgeApi'

const props = defineProps<{ modelValue: boolean; target?: KnowledgeDocumentInfo | null }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  imported: [value: KnowledgeDocumentInfo]
}>()
const kind = ref<'file' | 'text' | 'url'>('file')
const title = ref('')
const content = ref('')
const url = ref('')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref('')
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    title.value = props.target?.title ?? ''
    kind.value = props.target?.sourceKind === 'url' ? 'url' : 'file'
    url.value = props.target?.sourceKind === 'url' ? props.target.source : ''
    content.value = ''
    file.value = null
    error.value = ''
  },
)
function chooseFile(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  if (!title.value && file.value) title.value = file.value.name
}
async function submit(): Promise<void> {
  if (busy.value) return
  error.value = ''
  if (kind.value === 'file' && !file.value) {
    error.value = '请选择文本文件'
    return
  }
  if (kind.value === 'text' && !content.value.trim()) {
    error.value = '请输入正文'
    return
  }
  if (kind.value === 'url' && !url.value.trim()) {
    error.value = '请输入网页地址'
    return
  }
  busy.value = true
  try {
    const response =
      kind.value === 'file'
        ? await knowledgeApi.uploadDocument(file.value!, title.value, props.target?.id)
        : await knowledgeApi.importDocument({
            kind: kind.value,
            title: title.value,
            content: kind.value === 'text' ? content.value : undefined,
            url: kind.value === 'url' ? url.value.trim() : undefined,
            replaceId: props.target?.id,
          })
    if (response.data) emit('imported', response.data)
    emit('update:modelValue', false)
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <PDialog
    :model-value="modelValue"
    :title="target ? __t('ui.knowledge', '更新资料') : __t('ui.knowledge', '导入资料')"
    width="620px"
    @update:model-value="!busy && emit('update:modelValue', $event)"
  >
    <form class="knowledge-import" @submit.prevent="submit">
      <nav class="import-kinds" :aria-label="__t('ui.knowledge', '资料来源')">
        <button
          v-for="item in [
            ['file', __t('ui.knowledge', '文本文件'), 'file'],
            ['text', __t('ui.knowledge', '粘贴文本'), 'edit'],
            ['url', __t('ui.knowledge', '网页'), 'globe'],
          ] as const"
          :key="item[0]"
          type="button"
          :class="{ active: kind === item[0] }"
          :disabled="busy"
          @click="kind = item[0]"
        >
          <PixelIcon :name="item[2]" size="sm" />
          {{ item[1] }}
        </button>
      </nav>
      <label>
        {{ __t('ui.knowledge', '名称') }}
        <input
          v-model="title"
          maxlength="200"
          :placeholder="__t('ui.knowledge', '可选，留空使用来源名称')"
          :disabled="busy"
        />
      </label>
      <label v-if="kind === 'file'" class="file-picker">
        <PixelIcon name="file" size="lg" />
        <b>{{ file?.name || __t('ui.knowledge', '选择文本文件') }}</b>
        <span>
          {{ __t('ui.knowledge', 'TXT / Markdown / JSON / CSV 等 UTF-8 文本 · 最多 8 MiB') }}
        </span>
        <input
          type="file"
          accept="text/*,.md,.markdown,.json,.csv,.tsv,.yaml,.yml,.log,.xml,.toml,.ini"
          :disabled="busy"
          @change="chooseFile"
        />
      </label>
      <label v-else-if="kind === 'text'">
        {{ __t('ui.knowledge', '正文') }}
        <textarea
          v-model="content"
          rows="9"
          :placeholder="__t('ui.knowledge', '粘贴要保存的资料……')"
          :disabled="busy"
        />
      </label>
      <label v-else>
        {{ __t('ui.knowledge', '网页地址') }}
        <input v-model="url" type="url" placeholder="https://…" :disabled="busy" />
        <small>{{ __t('ui.knowledge', '读取网页正文，不包含需登录或由脚本加载的内容。') }}</small>
      </label>
      <p class="import-note">
        {{
          __t('ui.knowledge', '最多 400K Token，超出请分批导入。整理模型可在「任务指派」中设置。')
        }}
      </p>
      <p v-if="target" class="import-note">
        {{ __t('ui.knowledge', '更新后重新整理；整理期间这份资料暂不参与检索。') }}
      </p>
      <p v-if="error" class="knowledge-error" role="alert">{{ error }}</p>
    </form>
    <template #footer>
      <PButton variant="secondary" :disabled="busy" @click="emit('update:modelValue', false)">
        {{ __t('ui.knowledge', '取消') }}
      </PButton>
      <PButton :loading="busy" @click="submit">
        {{ target ? __t('ui.knowledge', '更新') : __t('ui.knowledge', '导入') }}
      </PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.knowledge-import {
  display: grid;
  gap: 18px;
  color: var(--ui-text-primary);
}
.import-kinds {
  display: flex;
  border-bottom: 1px solid var(--ui-border-subtle);
  gap: 6px;
}
.import-kinds button {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 12px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ui-text-secondary);
  cursor: pointer;
}
.import-kinds button.active {
  color: var(--ui-success);
  border-bottom-color: currentColor;
  background: var(--ui-bg-hover);
}
label {
  display: grid;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
input:not([type='file']),
textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ui-border-default);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  padding: 10px 12px;
  font: inherit;
  font-weight: 400;
  resize: vertical;
}
input:focus-visible,
textarea:focus-visible {
  outline: 1px solid var(--ui-success);
  outline-offset: 2px;
}
.file-picker {
  position: relative;
  justify-items: center;
  border: 1px dashed var(--ui-border-default);
  background: var(--ui-bg-hover);
  padding: 26px 16px;
  overflow: hidden;
  cursor: pointer;
}
.file-picker input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  cursor: pointer;
}
.file-picker span,
small,
.import-note {
  color: var(--ui-text-tertiary);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.7;
  margin: 0;
}
.knowledge-error {
  margin: 0;
  font-size: 13px;
  color: var(--ui-danger);
  overflow-wrap: anywhere;
}
</style>
