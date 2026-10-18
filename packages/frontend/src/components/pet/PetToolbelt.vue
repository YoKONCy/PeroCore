<script lang="ts">
export type PetPanel = 'chat' | 'voice' | 'appearance' | 'more'
</script>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PetControlSettings } from '@infos/shared'
import type BedrockAvatar from '../avatar/BedrockAvatar.vue'
import PetHudIcon from './PetHudIcon.vue'
import PetAppearancePanel from './PetAppearancePanel.vue'

const props = defineProps<{
  panel: PetPanel
  petName: string
  message: string
  thinking?: boolean
  speaking?: boolean
  voiceReady?: boolean
  recording?: boolean
  attention?: string
  mindText?: string
  settings: PetControlSettings
  avatarRef?: InstanceType<typeof BedrockAvatar> | null
}>()
const emit = defineEmits<{
  (e: 'select-panel', panel: PetPanel): void
  (e: 'update:message', text: string): void
  (e: 'send-message'): void
  (e: 'close'): void
  (e: 'voice-mode', mode: PetControlSettings['voiceMode']): void
  (e: 'ptt-down'): void
  (e: 'ptt-up', cancelled?: boolean): void
  (e: 'open-conversation'): void
  (e: 'open-section', section: string): void
  (e: 'stop-speech'): void
  (e: 'model-change', path: string, complete: (success: boolean, message?: string) => void): void
}>()
const actions: Array<{ id: PetPanel; label: string; icon: string }> = [
  { id: 'chat', label: '对话', icon: 'chat' },
  { id: 'voice', label: '语音', icon: 'mic' },
  { id: 'appearance', label: '互动', icon: 'sparkle' },
  { id: 'more', label: '更多', icon: 'settings' },
]
const heading = computed(
  () =>
    ({
      chat: '和 ' + props.petName + ' 说句话',
      voice: '语音对话',
      appearance: props.petName + ' 的小天地',
      more: '桌宠设置',
    })[props.panel],
)
const content = ref<HTMLElement | null>(null)
const inputElement = ref<HTMLTextAreaElement | null>(null)
const contentHeight = ref(0)
let observer: ResizeObserver | undefined
let heldPointer: number | null = null
let heldElement: HTMLElement | null = null
let heldKey = false

function measureContent() {
  if (content.value) contentHeight.value = content.value.offsetHeight
}
// 只测量内容自身的布局高度；切换期间保留旧高度，避免面板先塌陷再展开。
watch(
  content,
  (element) => {
    observer?.disconnect()
    if (!element) return
    measureContent()
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measureContent)
      observer.observe(element)
    }
  },
  { flush: 'post' },
)
function focusInput() {
  if (props.panel === 'chat') inputElement.value?.focus()
}
function sendOnEnter(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  emit('send-message')
}
function releasePtt(cancelled = false) {
  if (heldPointer === null && !heldKey) return
  const pointer = heldPointer
  const element = heldElement
  heldPointer = null
  heldElement = null
  heldKey = false
  if (pointer !== null && element?.hasPointerCapture(pointer))
    element.releasePointerCapture(pointer)
  emit('ptt-up', cancelled)
}
function beginPtt(event: PointerEvent) {
  if (event.button !== 0 || !props.voiceReady || heldPointer !== null || heldKey) return
  heldElement = event.currentTarget as HTMLElement
  heldPointer = event.pointerId
  heldElement.setPointerCapture(event.pointerId)
  emit('ptt-down')
}
function endPtt(event: PointerEvent, cancelled = false) {
  if (event.pointerId === heldPointer) releasePtt(cancelled)
}
function beginKeyPtt(event: KeyboardEvent) {
  if (![' ', 'Enter'].includes(event.key)) return
  event.preventDefault()
  if (event.repeat || !props.voiceReady || heldKey || heldPointer !== null) return
  heldKey = true
  emit('ptt-down')
}
function endKeyPtt(event: KeyboardEvent) {
  if (heldKey && [' ', 'Enter'].includes(event.key)) {
    event.preventDefault()
    releasePtt()
  }
}
watch(
  () => props.panel,
  () => {
    releasePtt(true)
    void nextTick(focusInput)
  },
)
watch(
  () => [props.settings.voiceMode, props.voiceReady],
  () => {
    if (props.settings.voiceMode !== 'ptt' || !props.voiceReady) releasePtt(true)
  },
)
onUnmounted(() => {
  observer?.disconnect()
  releasePtt(true)
})
onMounted(() => {
  void nextTick(focusInput)
})
</script>

<template>
  <section class="pet-toolbelt" aria-label="桌宠操作面">
    <div class="belt-face">
      <div class="belt-body" :style="{ height: contentHeight ? contentHeight + 'px' : undefined }">
        <Transition name="pet-context" mode="out-in" @after-enter="focusInput">
          <div :key="panel" ref="content" class="belt-page">
            <header>
              <strong>{{ heading }}</strong>
            </header>
            <template v-if="panel === 'chat'">
              <p class="muted">完整回复与历史记录在主应用中阅读</p>
              <textarea
                ref="inputElement"
                :value="message"
                rows="2"
                placeholder="说点什么…"
                :disabled="thinking"
                @input="emit('update:message', ($event.target as HTMLTextAreaElement).value)"
                @keydown.enter.exact="sendOnEnter"
              />
              <div class="panel-footer">
                <button type="button" class="text-button" @click="emit('open-conversation')">
                  打开对话
                  <PetHudIcon name="chevron-right" size="xs" />
                </button>
                <button
                  type="button"
                  class="primary"
                  :disabled="!message.trim() || thinking"
                  @click="emit('send-message')"
                >
                  {{ thinking ? '回复中…' : '发送' }}
                </button>
              </div>
            </template>
            <template v-else-if="panel === 'voice'">
              <div class="mode-picker">
                <button
                  v-for="option in [
                    { id: 'off', label: '关闭' },
                    { id: 'ptt', label: '按住说话' },
                    { id: 'vad', label: '自动感应' },
                  ]"
                  :key="option.id"
                  type="button"
                  :class="{ selected: settings.voiceMode === option.id }"
                  :aria-pressed="settings.voiceMode === option.id"
                  @click="emit('voice-mode', option.id as PetControlSettings['voiceMode'])"
                >
                  {{ option.label }}
                </button>
              </div>
              <p class="muted">
                {{
                  settings.voiceMode === 'ptt'
                    ? settings.pttBinding + ' · 按住录音，松开发送'
                    : settings.voiceMode === 'vad'
                      ? '麦克风持续监听，停顿后发送'
                      : '麦克风已关闭'
                }}
              </p>
              <button
                v-if="settings.voiceMode === 'ptt'"
                type="button"
                class="hold-button"
                :class="{ recording }"
                :aria-pressed="!!recording"
                :disabled="!voiceReady"
                @pointerdown.prevent="beginPtt"
                @pointerup="endPtt"
                @pointercancel="endPtt($event, true)"
                @lostpointercapture="endPtt($event, true)"
                @keydown="beginKeyPtt"
                @keyup="endKeyPtt"
                @blur="releasePtt(true)"
              >
                <PetHudIcon name="mic" />
                {{ voiceReady ? '按住这里说话' : '麦克风未就绪' }}
              </button>
              <div class="panel-footer">
                <button
                  type="button"
                  class="text-button"
                  @click="emit('open-section', 'voice_config')"
                >
                  设备与快捷键
                </button>
                <button
                  type="button"
                  class="text-button"
                  :disabled="!speaking"
                  @click="emit('stop-speech')"
                >
                  停止朗读
                </button>
              </div>
            </template>
            <template v-else-if="panel === 'appearance'">
              <PetAppearancePanel
                :avatar-ref="avatarRef"
                @model-change="(path, complete) => emit('model-change', path, complete)"
              />
              <details v-if="mindText" class="character-mind">
                <summary>此刻在想什么</summary>
                <p>{{ mindText }}</p>
              </details>
            </template>
            <template v-else>
              <button type="button" class="menu-item" @click="emit('open-conversation')">
                <PetHudIcon name="chat" size="sm" />
                主应用对话
              </button>
              <button type="button" class="menu-item" @click="emit('open-section', 'tasks')">
                <PetHudIcon name="thought" size="sm" />
                任务与提醒
                <i v-if="attention" class="inline-dot" />
              </button>
              <button type="button" class="menu-item" @click="emit('open-section', 'voice_config')">
                <PetHudIcon name="mic" size="sm" />
                语音与快捷键
              </button>
              <slot name="window-settings" />
            </template>
          </div>
        </Transition>
      </div>
      <nav class="dock" aria-label="桌宠操作">
        <button
          v-for="action in actions"
          :key="action.id"
          type="button"
          :class="{ selected: panel === action.id }"
          :aria-pressed="panel === action.id"
          @click="emit('select-panel', action.id)"
        >
          <PetHudIcon :name="action.icon" size="sm" />
          <span>{{ action.label }}</span>
        </button>
        <button type="button" class="fold-button" aria-label="收起桌宠菜单" @click="emit('close')">
          <PetHudIcon name="close" size="xs" />
          <span>收起</span>
        </button>
      </nav>
    </div>
  </section>
</template>

<style scoped src="./pet-toolbelt.css" />
