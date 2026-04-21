<script setup lang="ts">
/**
 * PetOverlayUI — 桌宠独立窗口的悬浮控制层
 *
 * 仅在 standalone 模式 (透明窗口) 下渲染。
 * 包含:
 * - 悬浮光球触发器 (展开/收起 UI)
 * - 状态标签 (心情/氛围/想法)
 * - 聊天输入框
 * - 工具按钮 (外观/刷新/尺寸/面板/最小化)
 *
 * 全部 UI 元素标记 -webkit-app-region: no-drag
 * 以确保在全局拖拽模式下仍可交互。
 *
 * @module packages/frontend/src/components/pet/PetOverlayUI
 */
import { ref, computed } from 'vue'
import { invoke } from '../../utils/ipcAdapter'

interface Props {
  /** 宠物名称 */
  petName?: string
  /** 心情文本 */
  moodText?: string
  /** 氛围文本 */
  vibeText?: string
  /** 想法文本 */
  mindText?: string
  /** 是否正在思考 */
  isThinking?: boolean
  /** 语音模式 */
  voiceMode?: 'off' | 'vad' | 'ptt'
  /** 是否正在录制 */
  isRecording?: boolean
  /** 音频级别 (0~1) */
  audioLevel?: number
}

const props = withDefaults(defineProps<Props>(), {
  petName: 'Pero',
  moodText: '开心',
  vibeText: '平静',
  mindText: '...',
  isThinking: false,
  voiceMode: 'off',
  isRecording: false,
  audioLevel: 0,
})

const emit = defineEmits<{
  (e: 'send-message', text: string): void
  (e: 'ui-enter'): void
  (e: 'ui-leave'): void
  (e: 'voice-mode', mode: 'off' | 'vad' | 'ptt'): void
  (e: 'ptt-down'): void
  (e: 'ptt-up'): void
}>()

// ── 展开/收起 ──
const showUI = ref(false)
const userInput = ref('')

function toggleUI() {
  showUI.value = !showUI.value
}

function sendMessage() {
  const text = userInput.value.trim()
  if (!text) return
  emit('send-message', text)
  userInput.value = ''
}

// ── UI Scale (适应窗口大小) ──
const uiScale = computed(() => {
  if (typeof window === 'undefined') return 1
  const w = window.innerWidth
  if (w < 400) return 0.7
  if (w < 600) return 0.85
  return 1
})

// ── 窗口操作 ──
function openDashboard() {
  invoke('open-dashboard').catch(() => {})
}

function minimizeToTray() {
  invoke('hide-pet-window').catch(() => {})
}

// ── 语音模式切换 ──
const voiceModeLabels: Record<string, string> = {
  off: '🔇',
  vad: '🎙️',
  ptt: '🎤',
}
function cycleVoiceMode() {
  const modes: Array<'off' | 'vad' | 'ptt'> = ['off', 'vad', 'ptt']
  const currentIdx = modes.indexOf(props.voiceMode ?? 'off')
  const next = modes[(currentIdx + 1) % modes.length]!
  emit('voice-mode', next)
}
</script>

<template>
  <div class="overlay-root" @mouseenter="emit('ui-enter')" @mouseleave="emit('ui-leave')">
    <!-- 状态标签 (左上角) -->
    <Transition name="fade">
      <div
        v-show="showUI"
        class="status-tags"
        :style="{ transform: `scale(${uiScale})`, transformOrigin: 'top left' }"
      >
        <div class="status-tag" title="心情">❤️ {{ moodText }}</div>
        <div class="status-tag" title="氛围">✨ {{ vibeText }}</div>
        <div class="status-tag" title="想法">💭 {{ mindText }}</div>
      </div>
    </Transition>

    <!-- 悬浮触发器 (光球) -->
    <div
      class="floating-trigger"
      :class="{ active: showUI }"
      :style="{ transform: `scale(${uiScale})` }"
      @click.stop="toggleUI"
      @mouseenter="emit('ui-enter')"
      @mouseleave="emit('ui-leave')"
    >
      <div class="trigger-core">
        <div class="pulse-ring" />
        <div class="core-dot" />
      </div>
    </div>

    <!-- 工具栏 + 输入框 (展开时) -->
    <Transition name="slide-up">
      <div
        v-show="showUI"
        class="bottom-panel"
        :style="{ transform: `scale(${uiScale})`, transformOrigin: 'bottom center' }"
        @mouseenter="emit('ui-enter')"
      >
        <!-- 输入框 -->
        <div class="input-row">
          <input
            v-model="userInput"
            class="chat-input"
            :placeholder="isThinking ? '思考中...' : `跟 ${petName} 说话...`"
            :disabled="isThinking"
            @keyup.enter="sendMessage"
          />
        </div>

        <!-- 工具按钮 -->
        <div class="tool-row">
          <button
            class="tool-btn"
            :class="{ 'tool-btn--active': voiceMode !== 'off' }"
            :title="`语音: ${voiceMode === 'off' ? '关' : voiceMode === 'vad' ? '自动感应' : '按住说话'}`"
            @click.stop="cycleVoiceMode"
          >
            {{ voiceModeLabels[voiceMode] }}
          </button>
          <button
            v-if="voiceMode === 'ptt'"
            class="tool-btn tool-btn--ptt"
            :class="{ 'tool-btn--recording': isRecording }"
            title="按住说话"
            @mousedown.stop="emit('ptt-down')"
            @mouseup.stop="emit('ptt-up')"
            @mouseleave="emit('ptt-up')"
          >
            🎤
          </button>
          <button class="tool-btn" title="控制面板" @click.stop="openDashboard">⚙️</button>
          <button class="tool-btn" title="最小化到托盘" @click.stop="minimizeToTray">➖</button>
        </div>

        <!-- 音量指示器 (VAD/PTT 录音时) -->
        <div v-if="isRecording" class="audio-level-bar">
          <div class="audio-level-fill" :style="{ width: audioLevel * 100 + '%' }" />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.overlay-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 100;
}

/* 所有子元素恢复可交互 */
.overlay-root > * {
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

/* 状态标签 */
.status-tags {
  position: absolute;
  top: 12px;
  left: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-tag {
  display: inline-flex;
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  white-space: nowrap;
}

/* 悬浮触发器 (光球) */
.floating-trigger {
  position: absolute;
  bottom: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  cursor: pointer;
  z-index: 200;
}

.trigger-core {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.core-dot {
  width: 12px;
  height: 12px;
  background: #38bdf8;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
  transition: all 0.3s;
}

.pulse-ring {
  position: absolute;
  width: 28px;
  height: 28px;
  border: 2px solid rgba(56, 189, 248, 0.4);
  animation: pulse 2s infinite;
}

.floating-trigger.active .core-dot {
  background: #f472b6;
  box-shadow: 0 0 12px rgba(244, 114, 182, 0.8);
}

.floating-trigger.active .pulse-ring {
  border-color: rgba(244, 114, 182, 0.4);
}

@keyframes pulse {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.4);
    opacity: 0.4;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* 底部面板 */
.bottom-panel {
  position: absolute;
  bottom: 16px;
  left: 16px;
  right: 64px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-row {
  display: flex;
}

.chat-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  font-family: 'Consolas', 'Monaco', monospace;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  border: 2px solid rgba(56, 189, 248, 0.2);
  outline: none;
  transition: border-color 0.2s;
}

.chat-input:focus {
  border-color: rgba(56, 189, 248, 0.6);
}

.chat-input::placeholder {
  color: rgba(255, 255, 255, 0.3);
}

.chat-input:disabled {
  opacity: 0.4;
}

.tool-row {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.tool-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s;
}

.tool-btn:hover {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.4);
  color: white;
  transform: translateY(-1px);
}

/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active {
  transition: all 0.3s ease-out;
}
.slide-up-leave-active {
  transition: all 0.2s ease-in;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}

/* 语音按钮 */
.tool-btn--active {
  background: rgba(56, 189, 248, 0.25);
  border-color: rgba(56, 189, 248, 0.5);
  color: #38bdf8;
}

.tool-btn--ptt {
  min-width: 48px;
}

.tool-btn--recording {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.6);
  color: #f87171;
  animation: recordPulse 0.8s infinite;
}

@keyframes recordPulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

/* 音量指示器 */
.audio-level-bar {
  height: 3px;
  background: rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.audio-level-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #f97316, #ef4444);
  transition: width 0.05s linear;
}
</style>
