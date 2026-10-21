<script setup lang="ts">
import { t as __t } from '../i18n'

import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{ text?: string; selected: boolean }>()
const emit = defineEmits<{ save: [text: string] }>()
const editing = ref(false),
  draft = ref(''),
  input = ref<HTMLTextAreaElement | null>(null)
const root = ref<HTMLElement | null>(null)
async function edit() {
  draft.value = String(props.text || '')
  editing.value = true
  await nextTick()
  input.value?.focus()
}
function save() {
  const value = draft.value.trim()
  if (value !== (props.text || '')) emit('save', value)
  editing.value = false
}
watch(
  () => props.selected,
  (value) => {
    if (!value) editing.value = false
  },
)
function outside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) editing.value = false
}
watch(editing, (value) => {
  if (value) window.addEventListener('pointerdown', outside, true)
  else window.removeEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => window.removeEventListener('pointerdown', outside, true))
</script>
<template>
  <div
    ref="root"
    class="node-annotation"
    :class="{ 'has-comment': text, editing, selected }"
    data-ui
    @pointerdown.stop
    @dblclick.stop
  >
    <button
      class="annotation-label"
      :title="text || __t('apps.pictoria.ui', '添加备注')"
      :aria-label="text ? __t('apps.pictoria.ui', '编辑备注') : __t('apps.pictoria.ui', '添加备注')"
      @click="editing ? (editing = false) : edit()"
    >
      <Icon name="note" :size="13" />
      <span v-if="text">{{ text }}</span>
    </button>
    <Transition name="float">
      <div
        v-if="editing"
        class="annotation-editor floating-panel"
        @keydown.esc.stop="editing = false"
      >
        <textarea
          ref="input"
          v-model="draft"
          maxlength="2000"
          rows="3"
          :placeholder="__t('apps.pictoria.ui', '备注（可选）')"
          :aria-label="__t('apps.pictoria.ui', '节点备注')"
          @keydown.ctrl.enter.prevent.stop="save"
          @keydown.meta.enter.prevent.stop="save"
        />
        <footer>
          <button
            v-if="text"
            class="text-button"
            @click="
              () => {
                draft = ''
                save()
              }
            "
          >
            {{ __t('apps.pictoria.ui', '清空') }}
          </button>
          <span />
          <button class="text-button" @click="editing = false">
            {{ __t('apps.pictoria.ui', '取消') }}
          </button>
          <button class="create-button" @click="save">{{ __t('apps.pictoria.ui', '保存') }}</button>
        </footer>
      </div>
    </Transition>
  </div>
</template>
