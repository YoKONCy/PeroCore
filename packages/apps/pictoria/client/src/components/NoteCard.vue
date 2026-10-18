<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import Icon from './PictoriaIcon.vue'
const props = defineProps<{ title: string; text: string; selected?: boolean }>()
const emit = defineEmits<{ save: [value: { title: string; text: string }]; remove: [] }>()
const editing = ref(false),
  titleDraft = ref(''),
  textDraft = ref(''),
  input = ref<HTMLInputElement | null>(null)
async function edit() {
  titleDraft.value = props.title
  textDraft.value = props.text
  editing.value = true
  await nextTick()
  input.value?.focus()
}
function save() {
  emit('save', { title: titleDraft.value.trim() || '备注', text: textDraft.value.trim() })
  editing.value = false
}
watch(
  () => props.selected,
  (value) => {
    if (!value) editing.value = false
  },
)
</script>
<template>
  <section class="note-card" :class="{ 'is-editing': editing }" @dblclick.stop="!editing && edit()">
    <header>
      <Icon name="note" :size="15" />
      <strong>{{ title }}</strong>
      <button
        type="button"
        class="icon-button"
        data-ui
        title="编辑备注"
        aria-label="编辑备注"
        @pointerdown.stop
        @click="edit"
      >
        <Icon name="edit" :size="14" />
      </button>
      <button
        type="button"
        class="icon-button note-card-delete"
        data-ui
        title="删除备注"
        aria-label="删除备注"
        @pointerdown.stop
        @click="emit('remove')"
      >
        <Icon name="trash" :size="14" />
      </button>
    </header>
    <div v-if="!editing" class="note-card-text" data-canvas-scroll>{{ text }}</div>
    <Transition name="float">
      <form
        v-if="editing"
        class="note-card-editor floating-panel"
        data-ui
        @pointerdown.stop
        @submit.prevent="save"
        @keydown.esc.stop="editing = false"
        @keydown.ctrl.enter.prevent.stop="save"
        @keydown.meta.enter.prevent.stop="save"
      >
        <input ref="input" v-model="titleDraft" maxlength="100" aria-label="备注标题" />
        <textarea v-model="textDraft" maxlength="4000" rows="6" aria-label="备注内容" />
        <footer>
          <button type="button" class="text-button danger-button" @click="emit('remove')">
            删除
          </button>
          <span />
          <button type="button" class="text-button" @click="editing = false">取消</button>
          <button type="submit" class="create-button">保存</button>
        </footer>
      </form>
    </Transition>
  </section>
</template>
<style scoped>
.note-card {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--accent) 23%, var(--line));
  border-radius: 13px;
  background: color-mix(in srgb, var(--panel) 94%, var(--accent));
  box-shadow: 0 4px 18px #0000000a;
  cursor: grab;
  user-select: none;
  transition:
    border-color 0.18s,
    box-shadow 0.18s,
    background 0.25s;
}
.note-card > header {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 13px 15px 9px;
  color: var(--accent);
  cursor: grab;
}
.note-card > header strong {
  flex: 1;
  font-size: 13px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-card > header .icon-button {
  width: 25px;
  height: 25px;
  color: var(--muted);
}
.note-card > header .note-card-delete:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.note-card-text {
  min-height: 0;
  overflow: auto;
  padding: 0 15px 16px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--muted);
  line-height: 1.7;
  font-size: 13px;
}
.note-card-editor {
  position: absolute;
  z-index: 60;
  top: 0;
  left: 0;
  width: max(100%, 320px);
  padding: 14px;
  border-radius: 13px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.note-card-editor :is(input, textarea) {
  width: 100%;
  padding: 9px 11px;
  border-radius: 8px;
  border: 1px solid var(--line-bright);
  background: var(--field);
  color: var(--text);
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  user-select: text;
  cursor: text;
}
.note-card-editor :is(input, textarea):focus {
  outline: 2px solid var(--accent-soft);
  border-color: var(--accent);
}
.note-card-editor footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.note-card-editor footer span {
  flex: 1;
}
</style>
