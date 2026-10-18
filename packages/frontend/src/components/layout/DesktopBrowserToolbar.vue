<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { DesktopTab } from '@infos/shared'
import { PixelIcon } from '../pixel'

const props = defineProps<{ tab: DesktopTab; focusRequest: number }>()
const emit = defineEmits<{ navigate: [value: string]; action: [value: string] }>()
const address = ref(props.tab.url ?? '')
const input = ref<HTMLInputElement | null>(null)
const editing = ref(false)
watch(
  () => [props.tab.id, props.tab.url],
  () => {
    if (!editing.value) address.value = props.tab.url ?? ''
  },
)
watch(
  () => props.tab.id,
  () => {
    editing.value = false
    address.value = props.tab.url ?? ''
  },
)
watch(
  () => props.focusRequest,
  async () => {
    await nextTick()
    input.value?.focus()
    input.value?.select()
  },
)
function navigate(): void {
  if (!address.value.trim() || props.tab.locked) return
  editing.value = false
  input.value?.blur()
  emit('navigate', address.value)
}
function cancelEdit(): void {
  address.value = props.tab.url ?? ''
  input.value?.blur()
}
</script>

<template>
  <form class="desktop-browser-toolbar" aria-label="浏览器导航" @submit.prevent="navigate">
    <button
      type="button"
      title="后退"
      aria-label="后退"
      :disabled="!tab.canGoBack || tab.locked"
      @click="emit('action', 'back')"
    >
      <PixelIcon name="chevron-left" size="sm" />
    </button>
    <button
      type="button"
      title="前进"
      aria-label="前进"
      :disabled="!tab.canGoForward || tab.locked"
      @click="emit('action', 'forward')"
    >
      <PixelIcon name="chevron-right" size="sm" />
    </button>
    <button
      type="button"
      :title="tab.loading ? '停止加载' : '刷新网页'"
      :aria-label="tab.loading ? '停止加载' : '刷新网页'"
      :disabled="tab.locked"
      @click="emit('action', tab.loading ? 'stop' : 'reload')"
    >
      <PixelIcon :name="tab.loading ? 'close' : 'refresh'" size="sm" />
    </button>
    <div class="desktop-browser-address">
      <PixelIcon name="globe" size="xs" />
      <input
        ref="input"
        v-model="address"
        :disabled="tab.locked"
        aria-label="网址或搜索内容"
        placeholder="输入网址或搜索内容"
        autocomplete="off"
        spellcheck="false"
        @focus="editing = true"
        @blur="editing = false"
        @keydown.esc="cancelEdit"
      />
    </div>
    <span v-if="tab.locked" class="desktop-browser-lock">
      <PixelIcon name="sparkle" size="xs" />
      Agent 操作中
    </span>
  </form>
</template>

<style scoped>
.desktop-browser-toolbar {
  display: flex;
  align-items: center;
  flex: 0 0 44px;
  gap: 5px;
  height: 44px;
  padding: 6px 12px;
  box-sizing: border-box;
  background: var(--ui-bg-surface);
  border-bottom: 1px solid var(--ui-border-default);
}
button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 29px;
  height: 29px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--ui-text-secondary);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard),
    transform var(--ui-duration-instant) var(--ui-ease-standard);
}
button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ui-accent-purple) 12%, transparent);
  color: var(--ui-text-primary);
}
button:active:not(:disabled) {
  transform: translateY(1px);
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
.desktop-browser-address {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  height: 30px;
  margin-left: 4px;
  padding: 0 11px;
  border: 1px solid var(--ui-border-default);
  border-radius: 8px;
  background: var(--ui-bg-canvas);
  color: var(--ui-text-secondary);
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard);
}
.desktop-browser-address:focus-within {
  border-color: var(--ui-accent-purple);
  box-shadow: 0 0 0 2px var(--ui-accent-purple-soft);
}
.desktop-browser-address :deep(.pixel-icon),
.desktop-browser-lock {
  flex-shrink: 0;
}
input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-primary);
  caret-color: var(--ui-accent-purple);
  font-size: 12px;
}
.desktop-browser-lock {
  display: flex;
  align-items: center;
  gap: 5px;
  padding-left: 8px;
  color: var(--ui-accent-purple);
  font-size: 11px;
  white-space: nowrap;
}
button:focus-visible {
  outline: 2px solid var(--ui-accent-purple);
}
</style>
