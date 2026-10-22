<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { t as __t } from '../../i18n/index'
import { copyClientText } from '../../lib/clientPlatform'
import { PixelIcon } from '../pixel'

const props = defineProps<{
  modelValue: boolean
  report: string
  dark: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const copyState = ref<'idle' | 'copying' | 'copied' | 'failed'>('idle')
let pointerOutside = false
const copyLabel = computed(() =>
  copyState.value === 'copied' ? __t('ui.launcher', '已复制') : __t('ui.launcher', '复制诊断信息'),
)

watch(
  () => props.modelValue,
  async () => {
    copyState.value = 'idle'
    await nextTick()
    const element = dialog.value
    if (!element) return
    // 原生模态框负责焦点约束、Esc 关闭和关闭后的焦点恢复。
    if (props.modelValue && !element.open) element.showModal()
    else if (!props.modelValue && element.open) element.close()
  },
  { immediate: true },
)

onBeforeUnmount(() => dialog.value?.close())

function close(): void {
  emit('update:modelValue', false)
}

function outside(event: MouseEvent): boolean {
  const box = dialog.value?.getBoundingClientRect()
  return (
    !!box &&
    (event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom)
  )
}

function backdropClick(event: MouseEvent): void {
  if (pointerOutside && outside(event)) close()
  pointerOutside = false
}

function backdropPointerDown(event: PointerEvent): void {
  pointerOutside = outside(event)
}

async function copyReport(): Promise<void> {
  if (copyState.value === 'copying') return
  copyState.value = 'copying'
  try {
    await copyClientText(props.report, dialog.value ?? undefined)
    copyState.value = 'copied'
  } catch {
    copyState.value = 'failed'
  }
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="startup-diagnostic"
      :class="{ 'is-dark': dark }"
      aria-labelledby="startup-diagnostic-title"
      aria-describedby="startup-diagnostic-description"
      @cancel.prevent="close"
      @close="close"
      @pointerdown="backdropPointerDown"
      @click="backdropClick"
    >
      <header class="diagnostic-header">
        <span class="diagnostic-icon" aria-hidden="true">
          <PixelIcon name="terminal" size="sm" />
        </span>
        <div>
          <h2 id="startup-diagnostic-title">{{ __t('ui.launcher', '启动诊断') }}</h2>
          <p id="startup-diagnostic-description">
            {{ __t('ui.launcher', '可复制以下信息，提供给开发者排查。') }}
          </p>
        </div>
        <button
          type="button"
          class="diagnostic-close"
          autofocus
          :aria-label="__t('ui.launcher', '关闭诊断')"
          @click="close"
        >
          <PixelIcon name="close" size="sm" />
        </button>
      </header>
      <div class="diagnostic-body">
        <div class="diagnostic-caption">
          <span>{{ __t('ui.launcher', '技术详情') }}</span>
          <span>{{ __t('ui.launcher', '仅本次启动') }}</span>
        </div>
        <pre tabindex="0" :aria-label="__t('ui.launcher', '技术详情')">{{ report }}</pre>
      </div>
      <footer class="diagnostic-footer">
        <p role="status" aria-live="polite">
          {{ copyState === 'failed' ? __t('ui.launcher', '复制未完成，请选中文字手动复制。') : '' }}
        </p>
        <button
          type="button"
          class="diagnostic-copy"
          :disabled="!report || copyState === 'copying'"
          @click="copyReport"
        >
          <PixelIcon :name="copyState === 'copied' ? 'check' : 'copy'" size="xs" />
          {{ copyLabel }}
        </button>
      </footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.startup-diagnostic {
  --diagnostic-bg: #fffdfd;
  --diagnostic-panel: #faf6f9;
  --diagnostic-text: #413747;
  --diagnostic-muted: #83758b;
  --diagnostic-edge: #d1c1d0;
  --diagnostic-accent: #935772;
  --diagnostic-tint: #f8e7f0;
  width: min(720px, calc(100vw - 32px));
  max-width: calc(100vw - 32px);
  height: min(540px, calc(100dvh - 72px));
  max-height: calc(100dvh - 72px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 2px solid var(--diagnostic-edge);
  border-radius: 4px;
  background: var(--diagnostic-bg);
  color: var(--diagnostic-text);
  box-shadow:
    5px 5px 0 rgba(25, 15, 35, 0.18),
    0 24px 80px rgba(0, 0, 0, 0.2);
  font-family: var(--ui-font-sans);
}
.startup-diagnostic[open] {
  display: flex;
  flex-direction: column;
}
.startup-diagnostic::backdrop {
  background: rgba(12, 11, 20, 0.58);
  backdrop-filter: blur(3px);
}
.startup-diagnostic.is-dark {
  --diagnostic-bg: #201d28;
  --diagnostic-panel: #16151e;
  --diagnostic-text: #e8e0ee;
  --diagnostic-muted: #ab9db4;
  --diagnostic-edge: #514659;
  --diagnostic-accent: #efacd0;
  --diagnostic-tint: #372835;
  color-scheme: dark;
}
.diagnostic-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--diagnostic-edge);
}
.diagnostic-header > div {
  min-width: 0;
  flex: 1;
}
.diagnostic-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border: 1px solid var(--diagnostic-edge);
  border-radius: 3px;
  background: var(--diagnostic-tint);
  color: var(--diagnostic-accent);
}
.diagnostic-header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}
.diagnostic-header p {
  margin: 4px 0 0;
  color: var(--diagnostic-muted);
  font-size: 12px;
  line-height: 1.5;
}
.diagnostic-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--diagnostic-muted);
  cursor: pointer;
}
.diagnostic-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 16px 20px;
}
.diagnostic-caption {
  display: flex;
  flex-shrink: 0;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  color: var(--diagnostic-muted);
  font-size: 11px;
}
.diagnostic-body pre {
  min-width: 0;
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 14px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--diagnostic-edge);
  border-radius: 3px;
  background: var(--diagnostic-panel);
  color: var(--diagnostic-text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  user-select: text;
  font: 11px/1.75 var(--ui-font-mono);
}
.diagnostic-footer {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--diagnostic-edge);
}
.diagnostic-footer p {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--diagnostic-muted);
  font-size: 11px;
}
.diagnostic-copy {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px solid var(--diagnostic-edge);
  border-radius: 3px;
  background: var(--diagnostic-tint);
  color: var(--diagnostic-accent);
  font: 700 12px var(--ui-font-sans);
  cursor: pointer;
}
.diagnostic-copy:disabled {
  opacity: 0.6;
  cursor: default;
}
.diagnostic-close:hover {
  background: var(--diagnostic-tint);
}
.diagnostic-copy:hover:not(:disabled) {
  filter: brightness(1.06);
}
.diagnostic-close:focus-visible,
.diagnostic-copy:focus-visible,
.diagnostic-body pre:focus-visible {
  outline: 2px solid var(--diagnostic-accent);
  outline-offset: 3px;
}
@media (max-width: 480px) {
  .diagnostic-header {
    padding: 14px;
  }
  .diagnostic-body {
    padding: 12px 14px;
  }
  .diagnostic-footer {
    padding: 12px 14px;
    flex-wrap: wrap;
  }
}
</style>
