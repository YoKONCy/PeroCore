<script setup lang="ts">
/**
 * Pet3DView — 宠物互动页面 (双模式)
 *
 * 通过 route prop `standalone` 支持两种布局:
 * - `standalone=false` (默认): 面板模式，带侧边栏状态/动作面板
 * - `standalone=true` (/pet-3d): 独立窗口模式，全屏透明 + 悬浮 UI
 *
 * 按 S05 §1 规范拆分:
 * - View 层: 模板 + composable 组装 (~120 行 script)
 * - usePetState.ts: 状态管理
 * - usePetBubble.ts: 对话气泡
 * - usePetTexts.ts: 台词系统 + 空闲消息 + 分时段欢迎
 * - usePetInteraction.ts: 点击/悬停/动作交互
 * - usePetWindow.ts: Electron 窗口交互
 * - usePetGateway.ts: Gateway 对话同步
 * - usePetVoice.ts: 语音采集
 * - usePetAudio.ts: TTS 播放 + 唇同步
 * - PetOverlayUI.vue: 独立窗口悬浮 UI
 *
 * @module packages/frontend/src/views/Pet3DView
 */
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { Marked } from 'marked'
import BedrockAvatar from '../components/avatar/BedrockAvatar.vue'
import FeatureControls from '../components/avatar/FeatureControls.vue'
import PetOverlayUI from '../components/pet/PetOverlayUI.vue'
import { LyricOverlay } from '../components/overlays'
import PixelIcon from '../components/pixel/PixelIcon.vue'
import { usePetState } from '../composables/pet/usePetState'
import { usePetBubble } from '../composables/pet/usePetBubble'
import { usePetWindow } from '../composables/pet/usePetWindow'
import { usePetGateway } from '../composables/pet/usePetGateway'
import { usePetVoice } from '../composables/pet/usePetVoice'
import { usePetAudio } from '../composables/pet/usePetAudio'
import { usePetTexts } from '../composables/pet/usePetTexts'
import { usePetInteraction } from '../composables/pet/usePetInteraction'
import { voiceApi } from '../api/modules/voiceApi'
import { useNotificationStore } from '../stores'

// ── Markdown 渲染器 (气泡内容解析) ──
const marked = new Marked({ breaks: true, gfm: true })
function renderMd(text: string): string {
  return marked.parse(text) as string
}

defineOptions({ name: 'Pet3DView' })

// ═══ 模式判定 ═══
const route = useRoute()
const isStandalone = computed(() => !!route.meta.standalone)

// ═══ 组装 composables ═══
const {
  stats,
  petName: defaultPetName,
  lastInteraction,
  moodLabels,
  moodEmoji,
  actionLabels,
  affectionLevel,
  setAction,
  pat,
  feed,
} = usePetState()

const {
  bubbleText,
  isBubbleVisible,
  bubbleKey,
  isBubbleExpanded,
  isBubbleOverflow,
  bubbleStyle,
  showBubble,
  toggleExpand,
} = usePetBubble()

// ── 气泡 Markdown 渲染 ──
const bubbleHtml = computed(() => renderMd(bubbleText.value))

const { globalMouse, isDragging, onInteractableEnter, onInteractableLeave } = usePetWindow()

// ── TTS 音频播放 + 唇同步 ──
const { isPlaying: isSpeaking, mouthOpen, receiveAudioChunk } = usePetAudio()

// ── Gateway 对话同步 ──
const { chatState, sendChat } = usePetGateway({
  onAudioChunk: (data) => receiveAudioChunk(data),
})

// ── 语音采集 (VAD + PTT) → HTTP ASR ──
const sendVoiceToAsr = async (audioData: ArrayBuffer) => {
  try {
    const result = await voiceApi.recognize(audioData)
    if (result.text?.trim()) {
      sendChat(result.text)
      showBubble(`🎤 ${result.text}`, 3000)
    }
  } catch {
    showBubble('语音识别失败了...😿', 3000)
  }
}
const {
  mode: voiceMode,
  setMode: setVoiceMode,
  pttDown,
  pttUp,
  isRecording,
  audioLevel,
} = usePetVoice(sendVoiceToAsr, isSpeaking)

// ── 语音配置前置检查 ──
const notif = useNotificationStore()

const handlePttDown = async () => {
  try {
    const status = await voiceApi.getStatus()
    if (!status?.data?.asr?.available) {
      notif.toast('未配置 ASR，请先在控制台配置语音识别服务', {
        type: 'warning',
        title: '缺少配置',
      })
      return
    }
    pttDown()
  } catch {
    notif.toast('无法获取语音服务状态', { type: 'error', title: '错误' })
  }
}

const handleSetVoiceMode = async (mode: 'ptt' | 'vad' | 'off') => {
  if (mode !== 'off') {
    try {
      const status = await voiceApi.getStatus()
      if (!status?.data?.asr?.available) {
        notif.toast('未配置 ASR，请先在控制台配置语音识别服务', {
          type: 'warning',
          title: '缺少配置',
        })
        return
      }
    } catch {
      notif.toast('无法获取语音服务状态', { type: 'error', title: '错误' })
      return
    }
  }
  setVoiceMode(mode)
}

// ── 台词系统 ──
const { agentName, startIdleTimer, getClickText } = usePetTexts({
  showBubble,
  isThinking: computed(() => chatState.value.isThinking),
  isSpeaking,
})
// petName 优先级: 动态获取的 agentName > usePetState 默认名 > 'Pero'
const petName = computed(() => agentName.value || defaultPetName.value || 'Pero')

// ── 角色引用 ──
const avatarRef = ref<InstanceType<typeof BedrockAvatar> | null>(null)

// ── 交互处理 ──
const { onPet, onHoverStart, onHoverEnd, handlePat, handleFeed, handleDance, handleThink } =
  usePetInteraction({
    avatarRef,
    showBubble,
    getClickText,
    startIdleTimer,
    pat,
    feed,
    setAction,
    onInteractableEnter,
    onInteractableLeave,
  })

// ── Gateway 流式回复 → 气泡 ──
watch(
  () => chatState.value.currentText,
  (text) => {
    if (text) showBubble(text, 0)
  },
)

watch(
  () => chatState.value.isThinking,
  (thinking) => {
    if (thinking) showBubble(chatState.value.thinkingMessage, 0)
  },
)

// ── 唇同步 → 角色嘴巴 ──
watch(mouthOpen, (val) => {
  if (avatarRef.value && 'setMouthOpen' in avatarRef.value) {
    ;(avatarRef.value as { setMouthOpen: (v: number) => void }).setMouthOpen(val)
  }
})

// ── 全局鼠标 → 视线跟随 ──
watch(globalMouse, (pos) => {
  if (avatarRef.value && 'setGlobalMouse' in avatarRef.value) {
    ;(avatarRef.value as { setGlobalMouse: (x: number, y: number) => void }).setGlobalMouse(
      pos.x,
      pos.y,
    )
  }
})

// ── 悬浮 UI 消息 ──
function onOverlaySendMessage(text: string) {
  sendChat(text)
  startIdleTimer()
}

// ── PetOverlayUI 引用 (读取 displayMode) ──
const overlayUIRef = ref<InstanceType<typeof PetOverlayUI> | null>(null)
const displayMode = computed(() => {
  const ui = overlayUIRef.value as { displayMode?: { value: string } } | null
  return ui?.displayMode?.value ?? 'bubble'
})

// ── 全局快捷键 ──
function handleGlobalKeydown(e: KeyboardEvent) {
  // Alt+V: 切换语音模式 (off → vad → ptt → off)
  if (e.altKey && e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    const modes: Array<'off' | 'vad' | 'ptt'> = ['off', 'vad', 'ptt']
    const idx = modes.indexOf(voiceMode.value)
    const next = modes[(idx + 1) % modes.length] ?? 'off'
    setVoiceMode(next)
    showBubble(
      `语音模式: ${next === 'off' ? '关闭' : next === 'vad' ? '自动感应' : '按住说话'}`,
      2000,
    )
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleGlobalKeydown)
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})

// 初始气泡已由 usePetTexts.showTimeBasedWelcome() 自动显示
</script>

<template>
  <div :class="['pet-view', { 'pet-view--standalone': isStandalone }]">
    <!-- 渲染区 -->
    <div :class="['pet-canvas-area', { 'pet-canvas-area--standalone': isStandalone }]">
      <BedrockAvatar
        ref="avatarRef"
        :is-dragging="isDragging"
        @pet="onPet"
        @hover-start="onHoverStart"
        @hover-end="onHoverEnd"
      />

      <!-- 对话气泡 -->
      <Transition name="bubble">
        <div
          v-if="isBubbleVisible"
          :key="bubbleKey"
          class="pet-bubble"
          :class="{ 'pet-bubble--expanded': isBubbleExpanded }"
          :style="bubbleStyle"
          @click.stop="isBubbleOverflow ? toggleExpand() : undefined"
        >
          <div
            ref="bubbleContentRef"
            class="pet-bubble-content"
            :class="{ 'pet-bubble-content--expanded': isBubbleExpanded }"
            v-html="bubbleHtml"
          />
          <button
            v-if="isBubbleOverflow || isBubbleExpanded"
            class="pet-bubble-toggle"
            @click.stop="toggleExpand"
          >
            {{ isBubbleExpanded ? '▲ 收起' : '▼ 展开' }}
          </button>
          <div class="pet-bubble-tail" />
        </div>
      </Transition>

      <p v-if="!isStandalone" class="pet-click-hint">点击角色可以互动~</p>
    </div>

    <!-- 独立模式: 悬浮 UI -->
    <PetOverlayUI
      v-if="isStandalone"
      ref="overlayUIRef"
      :pet-name="petName"
      :mood-text="moodLabels[stats.mood]"
      :vibe-text="chatState.vibe"
      :mind-text="chatState.mind"
      :is-thinking="chatState.isThinking"
      :voice-mode="voiceMode"
      :is-recording="isRecording"
      :audio-level="audioLevel"
      :avatar-ref="avatarRef as any"
      @send-message="onOverlaySendMessage"
      @ui-enter="onInteractableEnter"
      @ui-leave="onInteractableLeave"
      @voice-mode="handleSetVoiceMode"
      @ptt-down="handlePttDown"
      @ptt-up="pttUp"
    />

    <!-- 歌词模式浮层 (独立模式 + displayMode=lyric) -->
    <LyricOverlay
      v-if="isStandalone && displayMode === 'lyric'"
      :text="chatState.currentText"
      :is-thinking="chatState.isThinking"
      :thinking-message="chatState.thinkingMessage"
    />

    <!-- 面板模式: 右侧控制面板 -->
    <div v-if="!isStandalone" class="pet-panel">
      <div class="pet-panel-header">
        <h2 class="pet-name">{{ petName }}</h2>
        <span class="pet-action-label">{{ actionLabels[stats.currentAction] }}</span>
      </div>

      <div class="pet-stats">
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">
              <PixelIcon name="heart" size="sm" class="stat-icon stat-icon-pink" />
              好感度
            </span>
            <span class="pet-stat-value">{{ stats.affection }}% · {{ affectionLevel }}</span>
          </div>
          <div class="pet-stat-bar">
            <div class="pet-stat-fill stat-fill-pink" :style="{ width: stats.affection + '%' }" />
          </div>
        </div>
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">
              <PixelIcon name="flash" size="sm" class="stat-icon stat-icon-yellow" />
              能量
            </span>
            <span class="pet-stat-value">{{ stats.energy }}%</span>
          </div>
          <div class="pet-stat-bar">
            <div class="pet-stat-fill stat-fill-yellow" :style="{ width: stats.energy + '%' }" />
          </div>
        </div>
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">心情</span>
            <span class="pet-stat-value">
              {{ moodEmoji[stats.mood] }} {{ moodLabels[stats.mood] }}
            </span>
          </div>
        </div>
      </div>

      <div class="pet-actions-section">
        <h3 class="pet-section-title">互动</h3>
        <div class="pet-actions-grid">
          <button class="pet-action-btn" @click="handlePat">
            <span class="pet-action-icon"><PixelIcon name="hand" size="lg" /></span>
            <span>摸头</span>
          </button>
          <button class="pet-action-btn" @click="handleFeed">
            <span class="pet-action-icon"><PixelIcon name="cake" size="lg" /></span>
            <span>投喂</span>
          </button>
          <button class="pet-action-btn" @click="handleDance">
            <span class="pet-action-icon"><PixelIcon name="music" size="lg" /></span>
            <span>跳舞</span>
          </button>
          <button class="pet-action-btn" @click="handleThink">
            <span class="pet-action-icon"><PixelIcon name="thought" size="lg" /></span>
            <span>思考</span>
          </button>
        </div>
      </div>

      <div v-if="avatarRef?.featureButtons?.length" class="pet-actions-section">
        <h3 class="pet-section-title">外观</h3>
        <FeatureControls
          v-if="avatarRef"
          v-model="avatarRef.clothingState"
          :feature-buttons="avatarRef.featureButtons"
        />
      </div>

      <div class="pet-recent">
        <h3 class="pet-section-title">最近活动</h3>
        <p class="pet-recent-text">{{ lastInteraction }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ 根容器 (v1 体素风) ═══ */
.pet-view {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  font-family: 'Consolas', 'Monaco', monospace;
}

.pet-view--standalone {
  background: transparent;
}

/* ═══ 渲染区 ═══ */
.pet-canvas-area {
  flex: 1;
  position: relative;
  background: transparent;
  overflow: hidden;
}

.pet-canvas-area--standalone {
  background: transparent;
}

/* ═══ 对话气泡 (v1 体素风) ═══ */
.pet-bubble {
  position: absolute;
  top: 15%;
  left: 50%;
  background-color: rgba(20, 20, 20, 0.85);
  border: 2px solid #e0e0e0;
  border-radius: 4px;
  padding: 12px 16px;
  max-width: 280px;
  z-index: 100;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  pointer-events: auto;
  animation: bubble-float 3s infinite ease-in-out;
  display: flex;
  flex-direction: column;
  transition: all 0.2s steps(4);
  color: #ffffff;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 14px;
  line-height: 1.5;
  text-shadow: 1px 1px 0 #000;
}

.pet-bubble:hover {
  background-color: rgba(30, 30, 30, 0.95);
  border-color: #ffffff;
  z-index: 110;
}

.pet-bubble--expanded {
  max-width: 400px;
}

.pet-bubble-tail {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid #e0e0e0;
}

.pet-bubble-tail::after {
  content: '';
  position: absolute;
  top: -9px;
  left: -4px;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 4px solid rgba(20, 20, 20, 0.85);
}

/* ── Markdown 渲染 ── */
.pet-bubble-content {
  max-height: 120px;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.pet-bubble-content--expanded {
  max-height: 400px;
  overflow-y: auto;
}

.pet-bubble-content--expanded::-webkit-scrollbar {
  width: 3px;
}
.pet-bubble-content--expanded::-webkit-scrollbar-thumb {
  background: #666;
}

.pet-bubble-content :deep(p) {
  margin: 0 0 4px;
}
.pet-bubble-content :deep(p:last-child) {
  margin-bottom: 0;
}
.pet-bubble-content :deep(code) {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 4px;
  border: 1px solid #555;
  font-size: 12px;
}
.pet-bubble-content :deep(pre) {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid #555;
  padding: 6px 8px;
  overflow-x: auto;
  margin: 4px 0;
  font-size: 11px;
}
.pet-bubble-content :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
}
.pet-bubble-content :deep(ul),
.pet-bubble-content :deep(ol) {
  margin: 4px 0;
  padding-left: 16px;
}
.pet-bubble-content :deep(blockquote) {
  border-left: 3px solid #888;
  margin: 4px 0;
  padding: 2px 8px;
  color: #aaa;
}
.pet-bubble-content :deep(strong) {
  color: #ffcc44;
}

/* ── 展开按钮 ── */
.pet-bubble-toggle {
  background: none;
  border: none;
  border-top: 1px dashed #555;
  color: #aaa;
  font-size: 10px;
  font-family: 'Consolas', monospace;
  padding: 3px 0 0;
  margin-top: 4px;
  cursor: pointer;
  text-align: center;
  width: 100%;
}
.pet-bubble-toggle:hover {
  color: #fff;
}

.pet-click-hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: #888;
  font-weight: 700;
  opacity: 0.5;
  letter-spacing: 0.1em;
  text-shadow: 1px 1px 0 #000;
}

/* ═══ 右侧面板 ═══ */
.pet-panel {
  width: 300px;
  border-left: 2px solid #444;
  background: rgba(15, 15, 15, 0.95);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
  color: #e0e0e0;
}

.pet-panel::-webkit-scrollbar {
  width: 6px;
}
.pet-panel::-webkit-scrollbar-track {
  background: #222;
}
.pet-panel::-webkit-scrollbar-thumb {
  background: #555;
  border: 1px solid #000;
}

.pet-panel-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pet-name {
  font-size: 24px;
  font-weight: 800;
  color: #ffffff;
  text-shadow: 1px 1px 0 #000;
}

.pet-action-label {
  font-size: 11px;
  font-weight: 700;
  color: #888;
}

.pet-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pet-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pet-stat-header {
  display: flex;
  justify-content: space-between;
}

.pet-stat-label {
  font-size: 12px;
  font-weight: 700;
  color: #ccc;
}

.pet-stat-value {
  font-size: 11px;
  font-weight: 700;
  color: #888;
}

.pet-stat-bar {
  height: 6px;
  background: #333;
  border: 1px solid #555;
  overflow: hidden;
}

.pet-stat-fill {
  height: 100%;
  transition: width 0.5s ease;
}

.stat-fill-pink {
  background: #ff88aa;
  box-shadow: 0 0 4px rgba(255, 136, 170, 0.4);
}

.stat-fill-yellow {
  background: #ffcc44;
  box-shadow: 0 0 4px rgba(255, 204, 68, 0.4);
}

.pet-section-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #888;
  margin-bottom: 8px;
}

.pet-actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pet-action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 12px;
  border: 2px solid #666;
  background: rgba(40, 40, 40, 0.8);
  cursor: pointer;
  font-weight: 700;
  font-size: 11px;
  color: #ccc;
  transition: all 0.15s;
  box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.5);
  font-family: 'Consolas', monospace;
}

.pet-action-btn:hover {
  border-color: #fff;
  transform: translate(-1px, -1px);
  background: #555;
  color: #fff;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.6);
}

.pet-action-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 0px 0px 0px rgba(0, 0, 0, 0.5);
}

.pet-action-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ccc;
  transition: color 0.15s;
}

.pet-action-btn:hover .pet-action-icon {
  color: #fff;
}

/* ── 状态条图标 ── */
.stat-icon {
  display: inline-flex;
  vertical-align: middle;
}
.stat-icon-pink {
  color: #ff88aa;
}
.stat-icon-yellow {
  color: #ffcc44;
}

.pet-recent-text {
  font-size: 12px;
  color: #888;
  line-height: 1.6;
}

/* ═══ 动画 ═══ */
@keyframes bubble-float {
  0%,
  100% {
    transform: translateX(-50%) translateY(0);
  }
  50% {
    transform: translateX(-50%) translateY(-4px);
  }
}

.bubble-enter-active {
  transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.bubble-leave-active {
  transition: opacity 0.1s ease-out;
  position: absolute;
}

.bubble-enter-from {
  opacity: 0;
  transform: translateX(-50%) scale(0.8) translateY(10px);
}

.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) scale(1.1);
}
</style>
