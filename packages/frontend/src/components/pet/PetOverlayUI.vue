<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { PetControlSettings } from '@infos/shared'
import type BedrockAvatar from '../avatar/BedrockAvatar.vue'
import PetHudIcon from './PetHudIcon.vue'
import PetToolbelt, { type PetPanel } from './PetToolbelt.vue'
import PetSpeechBubble from './PetSpeechBubble.vue'
import { useDesktopControl } from '../../composables/useDesktopControl'
import { invoke } from '../../utils/ipcAdapter'

interface Props {
  agentId?: string
  petName: string
  moodText?: string
  vibeText?: string
  mindText?: string
  stage?: string
  thinking?: boolean
  connected?: boolean
  unread?: boolean
  replyNotice?: boolean
  replyText?: string
  resizeMode?: boolean
  windowSize?: number
  reaction?: string
  hint?: string
  subtitle?: string
  speaking?: boolean
  recording?: boolean
  recognizing?: boolean
  preparing?: boolean
  voiceReady?: boolean
  voiceError?: string
  audioLevel?: number
  attention?: string
  attentionKey?: string
  attentionKind?: 'approval' | 'question' | 'task'
  settings: PetControlSettings
  avatarRef?: InstanceType<typeof BedrockAvatar> | null
  bounds: { left: number; right: number; top: number; bottom: number }
  viewport: { width: number; height: number }
}
const props = defineProps<Props>()
const desktop = useDesktopControl()
const desktopVisible = computed(
  () =>
    desktop.supported &&
    desktop.state.value.phase !== 'idle' &&
    (!desktop.state.value.agentId || desktop.state.value.agentId === props.agentId),
)
function openDesktopTask() {
  const state = desktop.state.value
  void invoke('pet-controls:open-conversation', {
    agentId: state.agentId || props.agentId,
    threadId: state.threadId,
    taskId: state.taskId,
  }).catch(() => {})
}
const emit = defineEmits<{
  (e: 'send-message', text: string, complete: (accepted: boolean) => void): void
  (e: 'ui-enter'): void
  (e: 'ui-leave'): void
  (e: 'open-conversation'): void
  (e: 'open-section', section: string): void
  (e: 'voice-mode', mode: PetControlSettings['voiceMode']): void
  (e: 'ptt-down'): void
  (e: 'ptt-up', cancelled?: boolean): void
  (e: 'cancel-voice'): void
  (e: 'stop-speech'): void
  (e: 'toggle-resize'): void
  (e: 'dismiss-hint'): void
  (e: 'model-change', path: string, complete: (success: boolean, message?: string) => void): void
}>()
const panel = ref<PetPanel>('chat')
const expanded = ref(false)
const input = ref('')
const root = ref<HTMLElement | null>(null)
const dismissedAttention = ref(new Set<string>())
let hideTimer: ReturnType<typeof setTimeout> | undefined
const scale = computed(() => Math.min(1, Math.max(0.78, props.viewport.width / 650)))
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

// 光点只按自身范围定位，内容高度和过渡动画均不能改变入口或模型位置。
const anchor = computed(() => {
  const size = 44 * scale.value
  return {
    left: clamp(props.bounds.right + 8, 12, props.viewport.width - size - 12),
    top: clamp(
      props.bounds.top + (props.bounds.bottom - props.bounds.top) * 0.55 - size / 2,
      12,
      props.viewport.height - size - 12,
    ),
  }
})
const placement = computed(() => ({
  left: anchor.value.left + 'px',
  top: anchor.value.top + 'px',
  transform: 'scale(' + scale.value + ')',
}))
// 操作面的底部固定在角色脚边；窗口空间不足时限制内容高度，内部滚动。
const beltPlacement = computed(() => {
  const s = scale.value
  const width = Math.min(440, Math.max(0, (props.viewport.width - 24) / s))
  const bottom = Math.max(12, props.viewport.height - props.bounds.bottom - 176 * s)
  const maxHeight = Math.min(420, Math.max(0, (props.viewport.height - bottom - 12) / s))
  const left = clamp(
    (props.bounds.left + props.bounds.right - width * s) / 2,
    12,
    props.viewport.width - width * s - 12,
  )
  return {
    left: left + 'px',
    bottom: bottom + 'px',
    width: width + 'px',
    transform: 'scale(' + s + ')',
    '--belt-content-max': Math.max(0, maxHeight - 90) + 'px',
  }
})
const identityPlacement = computed(() => ({
  left: clamp(props.bounds.right + 16, 12, props.viewport.width - 140 * scale.value - 12) + 'px',
  top:
    clamp(
      props.bounds.top + (props.bounds.bottom - props.bounds.top) * 0.2,
      12,
      props.viewport.height - 82 * scale.value - 12,
    ) + 'px',
  transform: 'scale(' + scale.value + ')',
}))
// 必要状态独立放在角色上方，不随操作面切换，也不被收起菜单隐藏。
const noticePlacement = computed(() => {
  const s = scale.value
  const width = Math.min(264, Math.max(0, (props.viewport.width - 24) / s))
  const above = props.bounds.top - 20
  return {
    left:
      clamp(
        (props.bounds.left + props.bounds.right - width * s) / 2,
        12,
        props.viewport.width - width * s - 12,
      ) + 'px',
    width: width + 'px',
    top: above < 48 * s ? '12px' : undefined,
    bottom: above >= 48 * s ? props.viewport.height - props.bounds.top + 8 + 'px' : undefined,
    transform: 'scale(' + s + ')',
    transformOrigin: above >= 48 * s ? 'bottom left' : 'top left',
    maxHeight:
      Math.max(0, Math.min(320, (above >= 48 * s ? above : props.viewport.height - 24) / s)) + 'px',
  }
})
const occupied = computed(() => props.recording || props.recognizing || props.preparing)
const bubbleText = computed(() => {
  if (expanded.value || occupied.value) return ''
  if (props.speaking && props.settings.subtitlesEnabled) return props.subtitle || ''
  if (props.speaking || props.thinking) return ''
  if (props.replyNotice && props.unread) return props.replyText || '回复好了'
  if (props.attention) return ''
  return props.reaction || ''
})
const showAttention = computed(
  () =>
    !!props.attention &&
    !!props.attentionKey &&
    !dismissedAttention.value.has(props.attentionKey) &&
    !occupied.value &&
    !expanded.value,
)
function dismissAttention() {
  if (!props.attentionKey) return
  dismissedAttention.value.add(props.attentionKey)
  if (dismissedAttention.value.size > 100)
    dismissedAttention.value.delete(dismissedAttention.value.values().next().value!)
}
const voiceLabel = computed(() =>
  props.preparing
    ? '正在准备麦克风'
    : props.recording
      ? '正在听，松开发送'
      : props.recognizing
        ? '正在识别'
        : props.voiceError || '',
)
const markTitle = computed(
  () =>
    props.attention ||
    (props.unread
      ? '有新消息'
      : props.thinking
        ? props.stage || '正在处理'
        : props.connected
          ? props.petName
          : '连接已断开'),
)
function enter() {
  clearTimeout(hideTimer)
  emit('ui-enter')
}
function toggleMenu() {
  if (expanded.value) close()
  else {
    panel.value = 'chat'
    expanded.value = true
    enter()
  }
}
function leave() {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (
      root.value?.contains(document.activeElement) &&
      document.activeElement?.matches('textarea,input,select,[contenteditable=true]')
    )
      return
    close()
  }, 650)
}
function close() {
  if (root.value?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur()
  clearTimeout(hideTimer)
  expanded.value = false
  void nextTick(() => emit('ui-leave'))
}
function selectPanel(id: PetPanel) {
  panel.value = id
  enter()
}
function sendMessage() {
  const text = input.value.trim()
  if (!text || props.thinking) return
  emit('send-message', text, (accepted) => {
    if (accepted && input.value.trim() === text) input.value = ''
  })
  close()
}
watch(
  () => props.recording,
  (recording) => {
    if (recording && (!expanded.value || panel.value !== 'voice')) close()
  },
)
onUnmounted(() => clearTimeout(hideTimer))
</script>

<template>
  <div ref="root" class="pet-hud" @focusin="enter" @focusout="leave" @keydown.esc.stop="close">
    <Transition name="pet-speech" :css="!expanded">
      <PetSpeechBubble
        v-if="bubbleText"
        :text="bubbleText"
        :pet-name="petName"
        :bounds="bounds"
        :viewport="viewport"
        :speaking="speaking"
        :conversation="speaking || (replyNotice && unread)"
        @ui-enter="enter"
        @ui-leave="leave"
        @open-conversation="emit('open-conversation')"
        @stop-speech="emit('stop-speech')"
      />
    </Transition>
    <div
      data-pet-ui
      class="hud-anchor"
      :style="placement"
      @pointerenter="enter"
      @pointerleave="leave"
    >
      <button
        type="button"
        class="floating-trigger"
        :class="{ active: expanded }"
        :title="markTitle"
        :aria-label="markTitle + '，展开桌宠菜单'"
        :aria-expanded="expanded"
        @click="toggleMenu"
      >
        <span class="trigger-core" aria-hidden="true">
          <span class="pulse-ring" />
          <span class="core-dot" />
        </span>
      </button>
    </div>
    <Transition name="pet-identity">
      <div v-if="expanded" class="pet-identity" :style="identityPlacement">
        <div>
          {{ petName }}
          <PetHudIcon name="heart" size="xs" />
        </div>
        <small v-if="moodText || vibeText">
          {{ [moodText, vibeText].filter(Boolean).join(' · ') }}
        </small>
      </div>
    </Transition>
    <Transition name="pet-belt">
      <div
        v-if="expanded"
        data-pet-ui
        class="hud-belt"
        :style="beltPlacement"
        @pointerenter="enter"
        @pointerleave="leave"
      >
        <PetToolbelt
          v-model:message="input"
          :panel="panel"
          :pet-name="petName"
          :thinking="thinking"
          :speaking="speaking"
          :voice-ready="voiceReady"
          :recording="recording"
          :attention="attention"
          :mind-text="mindText"
          :settings="settings"
          :avatar-ref="avatarRef"
          @select-panel="selectPanel"
          @close="close"
          @send-message="sendMessage"
          @voice-mode="emit('voice-mode', $event)"
          @ptt-down="emit('ptt-down')"
          @ptt-up="emit('ptt-up', $event)"
          @open-conversation="emit('open-conversation')"
          @open-section="emit('open-section', $event)"
          @stop-speech="emit('stop-speech')"
          @model-change="(path, complete) => emit('model-change', path, complete)"
        >
          <template #window-settings><slot name="window-settings" /></template>
        </PetToolbelt>
      </div>
    </Transition>
    <div
      data-pet-ui
      class="hud-notices"
      :style="noticePlacement"
      @pointerenter="enter"
      @pointerleave="leave"
    >
      <Transition name="pet-status">
        <div v-if="desktopVisible && !occupied" class="stage" role="status" aria-live="polite">
          <PetHudIcon name="thought" size="sm" />
          <button type="button" class="text-button" @click="openDesktopTask">
            {{ desktop.state.value.phase === 'running' ? '正在操作桌面' : '桌面操作已暂停' }}
          </button>
          <button
            v-if="desktop.state.value.phase === 'running'"
            type="button"
            class="icon-button"
            title="暂停桌面操作"
            @click="desktop.control('pause')"
          >
            <PetHudIcon name="close" size="xs" />
          </button>
        </div>
      </Transition>
      <Transition name="pet-status">
        <div v-if="thinking && !occupied" class="stage" role="status" aria-live="polite">
          <PetHudIcon name="thought" size="sm" />
          <span>{{ stage || '正在思考' }}</span>
          <span class="stage-pixels" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      </Transition>
      <div v-if="resizeMode && (!expanded || panel !== 'more')" class="resize-strip" role="status">
        <span>{{ windowSize }}px · 滚轮调整大小，Esc 退出</span>
        <button
          type="button"
          class="icon-button"
          title="结束调节"
          aria-label="结束调节"
          @click="emit('toggle-resize')"
        >
          <PetHudIcon name="close" size="xs" />
        </button>
      </div>
      <Transition name="pet-status">
        <div
          v-if="voiceLabel"
          class="voice-strip"
          :class="{ recording, failed: !!voiceError }"
          role="status"
        >
          <PetHudIcon
            :name="recording ? 'mic' : recognizing || preparing ? 'thought' : 'alert'"
            size="sm"
          />
          <span>{{ voiceLabel }}</span>
          <div v-if="recording" class="meter">
            <i :style="{ width: Math.min(100, (audioLevel || 0) * 700) + '%' }" />
          </div>
          <button
            v-if="recording || recognizing"
            type="button"
            class="icon-button"
            title="丢弃这次语音"
            @click="emit('cancel-voice')"
          >
            <PetHudIcon name="close" size="xs" />
          </button>
        </div>
      </Transition>
      <Transition name="pet-status">
        <div v-if="showAttention" class="attention-card" role="status" aria-live="polite">
          <div class="attention-card__heading">
            <PetHudIcon :name="attentionKind === 'approval' ? 'check' : 'thought'" size="sm" />
            <strong>
              {{
                attentionKind === 'approval'
                  ? '需要你确认'
                  : attentionKind === 'question'
                    ? '有事想问你'
                    : '有待处理事项'
              }}
            </strong>
            <button
              class="icon-button"
              type="button"
              aria-label="暂时收起，相同事项不再弹出"
              @click="dismissAttention"
            >
              <PetHudIcon name="close" size="xs" />
            </button>
          </div>
          <p class="attention-card__summary">{{ attention }}</p>
          <button type="button" class="text-button" @click="emit('open-section', 'tasks')">
            在主应用中处理
            <PetHudIcon name="chevron-right" size="xs" />
          </button>
        </div>
      </Transition>
      <div v-if="hint && !occupied && !expanded && !showAttention" class="hint-strip" role="status">
        <span>{{ hint }}</span>
        <button
          type="button"
          class="icon-button"
          aria-label="收起提示"
          @click="emit('dismiss-hint')"
        >
          <PetHudIcon name="close" size="xs" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped src="./pet-hud.css" />
