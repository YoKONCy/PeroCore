<script setup lang="ts">
/**
 * Pet3DView — 宠物互动页面 (双模式)
 *
 * 通过 route prop `standalone` 支持两种布局:
 * - `standalone=false` (默认): 面板模式，带侧边栏状态/动作面板
 * - `standalone=true` (/pet-3d): 独立窗口模式，全屏透明 + 悬浮 UI
 *
 * 按 06_FILE_SIZE_LIMITS.md 规范拆分:
 * - View 层: ~150 行模板 + 组装
 * - usePetState.ts: 状态管理
 * - usePetBubble.ts: 对话气泡
 * - usePetWindow.ts: Electron 窗口交互
 * - PetOverlayUI.vue: 独立窗口悬浮 UI
 *
 * @module packages/frontend/src/views/Pet3DView
 */
import { ref, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import BedrockAvatar from '../components/avatar/BedrockAvatar.vue'
import FeatureControls from '../components/avatar/FeatureControls.vue'
import PetOverlayUI from '../components/pet/PetOverlayUI.vue'
import { usePetState } from '../composables/pet/usePetState'
import { usePetBubble } from '../composables/pet/usePetBubble'
import { usePetWindow } from '../composables/pet/usePetWindow'
import { usePetGateway } from '../composables/pet/usePetGateway'
import { usePetVoice } from '../composables/pet/usePetVoice'
import { usePetAudio } from '../composables/pet/usePetAudio'
import { isElectron } from '../utils/ipcAdapter'
import { voiceApi } from '../api/modules/voiceApi'
import type { PetEvent } from '../composables/avatar'

defineOptions({ name: 'Pet3DView' })

// ═══ 模式判定 ═══
// 独立模式: 路由 meta.standalone=true + Electron 环境
// Browser 下即使访问 /pet-3d 也降级为面板模式
const route = useRoute()
const isStandalone = computed(() => {
  return !!route.meta.standalone && isElectron()
})

// ═══ composables ═══
const {
  stats,
  petName,
  lastInteraction,
  moodLabels,
  moodEmoji,
  actionLabels,
  affectionLevel,
  setAction,
  pat,
  feed,
} = usePetState()

const { bubbleText, isBubbleVisible, showBubble } = usePetBubble()

const { globalMouse, onInteractableEnter, onInteractableLeave } = usePetWindow()

// ═══ TTS 音频播放 + 唇同步 ═══
const { isPlaying: isSpeaking, mouthOpen, receiveAudioChunk } = usePetAudio()

// ═══ Gateway 对话同步 ═══
const { chatState, sendChat } = usePetGateway({
  onAudioChunk: (data) => receiveAudioChunk(data),
})

// ═══ 语音采集 (VAD + PTT) → HTTP ASR ═══
const sendVoiceToAsr = async (audioData: ArrayBuffer) => {
  try {
    console.log(`[PetVoice] 发送音频到 ASR (${(audioData.byteLength / 1024).toFixed(1)}KB)`)
    const result = await voiceApi.recognize(audioData)
    if (result.text && result.text.trim()) {
      console.log(`[PetVoice] ASR 识别结果: ${result.text}`)
      // 识别结果作为聊天消息发送
      sendChat(result.text)
      showBubble(`🎤 ${result.text}`, 3000)
    } else {
      console.log('[PetVoice] ASR 识别为空')
    }
  } catch (e) {
    console.error('[PetVoice] ASR 请求失败:', e)
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

// Gateway 流式回复 → 气泡显示
watch(
  () => chatState.value.currentText,
  (text) => {
    if (text) {
      showBubble(text, 0) // duration=0: 流式推送期间不自动消失
    }
  },
)

// 思考状态 → 思考气泡
watch(
  () => chatState.value.isThinking,
  (thinking) => {
    if (thinking) {
      showBubble(chatState.value.thinkingMessage, 0)
    }
  },
)

// 唇同步 → 角色嘴巴动画
watch(mouthOpen, (val) => {
  if (avatarRef.value && 'setMouthOpen' in avatarRef.value) {
    ;(avatarRef.value as { setMouthOpen: (v: number) => void }).setMouthOpen(val)
  }
})

// ═══ 角色引用 ═══
const avatarRef = ref<InstanceType<typeof BedrockAvatar> | null>(null)

// 全局鼠标 → 角色视线跟随
watch(globalMouse, (pos) => {
  if (avatarRef.value && 'setGlobalMouse' in avatarRef.value) {
    ;(avatarRef.value as { setGlobalMouse: (x: number, y: number) => void }).setGlobalMouse(
      pos.x,
      pos.y,
    )
  }
})

// ═══ 交互处理 ═══
function onPet(event: PetEvent) {
  pat()
  const reactions: Record<string, string> = {
    head: '嘿嘿，摸摸好舒服喵~ ☺️',
    body: '唔…不要乱摸啦！///>_<///',
    arm: '牵手…好害羞…🫣',
    leg: '哇！不要碰那里啦！😳',
  }
  showBubble(reactions[event.type] || '嘿嘿~', 4000)
}

/** 鼠标进入角色 → 关闭穿透 */
function onHoverStart() {
  onInteractableEnter()
}

/** 鼠标离开角色 → 恢复穿透 */
function onHoverEnd() {
  onInteractableLeave()
}

// ═══ 动作按钮 (面板模式) ═══
function handlePat() {
  pat()
  showBubble('嘿嘿，摸摸好舒服喵~ ☺️', 4000)
}

function handleFeed() {
  feed()
  showBubble('谢谢主人！能量充满了！✨', 4000)
}

function handleDance() {
  setAction('dance')
  avatarRef.value?.playAnimation('dance')
  showBubble('来跳个舞吧！💃', 3000)
  setTimeout(() => {
    setAction('idle')
    avatarRef.value?.resetAnimation()
  }, 3000)
}

function handleThink() {
  setAction('think')
  showBubble('让我想想... 🤔', 3000)
  setTimeout(() => setAction('idle'), 3000)
}

// ═══ 悬浮 UI 消息 (独立模式) ═══
function onOverlaySendMessage(text: string) {
  sendChat(text)
}

// ═══ 初始气泡 ═══
showBubble('主人好！今天也要加油哦~ ✨', 5000)
</script>

<template>
  <!--
    根容器:
    - 面板模式: flex 布局, 左渲染区 + 右面板
    - 独立模式: 全屏透明, 纯渲染区 + 悬浮 UI
  -->
  <div :class="['pet-view', { 'pet-view--standalone': isStandalone }]">
    <!-- 渲染区 (两种模式共用) -->
    <div :class="['pet-canvas-area', { 'pet-canvas-area--standalone': isStandalone }]">
      <!-- 3D 角色 -->
      <BedrockAvatar
        ref="avatarRef"
        @pet="onPet"
        @hover-start="onHoverStart"
        @hover-end="onHoverEnd"
      />

      <!-- 对话气泡 -->
      <Transition name="bubble">
        <div v-if="isBubbleVisible" class="pet-bubble">
          <p>{{ bubbleText }}</p>
          <div class="pet-bubble-tail" />
        </div>
      </Transition>

      <!-- 点击提示 (仅面板模式) -->
      <p v-if="!isStandalone" class="pet-click-hint">点击角色可以互动~</p>
    </div>

    <!-- ═══ 独立模式: 悬浮 UI 覆盖层 ═══ -->
    <PetOverlayUI
      v-if="isStandalone"
      :pet-name="petName"
      :mood-text="moodLabels[stats.mood]"
      :vibe-text="chatState.vibe"
      :mind-text="chatState.mind"
      :is-thinking="chatState.isThinking"
      :voice-mode="voiceMode"
      :is-recording="isRecording"
      :audio-level="audioLevel"
      @send-message="onOverlaySendMessage"
      @ui-enter="onInteractableEnter"
      @ui-leave="onInteractableLeave"
      @voice-mode="(m) => setVoiceMode(m)"
      @ptt-down="pttDown"
      @ptt-up="pttUp"
    />

    <!-- ═══ 面板模式: 右侧控制面板 ═══ -->
    <div v-if="!isStandalone" class="pet-panel">
      <!-- 宠物名称 -->
      <div class="pet-panel-header">
        <h2 class="pet-name">{{ petName }}</h2>
        <span class="pet-action-label">{{ actionLabels[stats.currentAction] }}</span>
      </div>

      <!-- 状态条 -->
      <div class="pet-stats">
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">❤️ 好感度</span>
            <span class="pet-stat-value">{{ stats.affection }}% · {{ affectionLevel }}</span>
          </div>
          <div class="pet-stat-bar">
            <div class="pet-stat-fill stat-fill-pink" :style="{ width: stats.affection + '%' }" />
          </div>
        </div>
        <div class="pet-stat">
          <div class="pet-stat-header">
            <span class="pet-stat-label">⚡ 能量</span>
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

      <!-- 动作按钮 -->
      <div class="pet-actions-section">
        <h3 class="pet-section-title">互动</h3>
        <div class="pet-actions-grid">
          <button class="pet-action-btn" @click="handlePat">
            <span class="pet-action-icon">✋</span>
            <span>摸头</span>
          </button>
          <button class="pet-action-btn" @click="handleFeed">
            <span class="pet-action-icon">🍰</span>
            <span>投喂</span>
          </button>
          <button class="pet-action-btn" @click="handleDance">
            <span class="pet-action-icon">💃</span>
            <span>跳舞</span>
          </button>
          <button class="pet-action-btn" @click="handleThink">
            <span class="pet-action-icon">💭</span>
            <span>思考</span>
          </button>
        </div>
      </div>

      <!-- 服装控制 -->
      <div v-if="avatarRef?.featureButtons?.length" class="pet-actions-section">
        <h3 class="pet-section-title">外观</h3>
        <FeatureControls
          v-if="avatarRef"
          v-model="avatarRef.clothingState"
          :feature-buttons="avatarRef.featureButtons"
        />
      </div>

      <!-- 最近互动 -->
      <div class="pet-recent">
        <h3 class="pet-section-title">最近活动</h3>
        <p class="pet-recent-text">{{ lastInteraction }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══ 根容器 ═══ */
.pet-view {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.pet-view--standalone {
  background: transparent;
}

/* ═══ 渲染区 ═══ */
.pet-canvas-area {
  flex: 1;
  position: relative;
  background: var(--color-bg-primary);
  overflow: hidden;
}

.pet-canvas-area--standalone {
  background: transparent;
}

/* ═══ 对话气泡 ═══ */
.pet-bubble {
  position: absolute;
  top: 15%;
  left: 50%;
  transform: translateX(-30%);
  background: var(--color-bg-primary, rgba(15, 23, 42, 0.85));
  border: 2px solid var(--color-border, rgba(56, 189, 248, 0.15));
  padding: 12px 16px;
  max-width: 240px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary, #e2e8f0);
  line-height: 1.5;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
  z-index: 10;
}

/* 独立模式: 半透明玻璃气泡 */
.pet-view--standalone .pet-bubble {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(12px);
  border-color: rgba(56, 189, 248, 0.2);
  color: rgba(255, 255, 255, 0.9);
}

.pet-bubble-tail {
  position: absolute;
  bottom: -10px;
  left: 20px;
  width: 12px;
  height: 12px;
  background: var(--color-bg-primary, rgba(15, 23, 42, 0.85));
  border-right: 2px solid var(--color-border, rgba(56, 189, 248, 0.15));
  border-bottom: 2px solid var(--color-border, rgba(56, 189, 248, 0.15));
  transform: rotate(45deg);
}

.pet-view--standalone .pet-bubble-tail {
  background: rgba(0, 0, 0, 0.5);
  border-color: rgba(56, 189, 248, 0.2);
}

.pet-click-hint {
  position: absolute;
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  color: var(--color-text-muted);
  font-weight: 700;
  opacity: 0.5;
  letter-spacing: 0.1em;
}

/* ═══ 右侧面板 (面板模式) ═══ */
.pet-panel {
  width: 300px;
  border-left: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
}

.pet-panel::-webkit-scrollbar {
  width: 4px;
}
.pet-panel::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.pet-panel-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pet-name {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.pet-action-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
}

/* 状态条 */
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
  color: var(--color-text-secondary);
}

.pet-stat-value {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.pet-stat-bar {
  height: 6px;
  background: var(--color-bg-primary);
  overflow: hidden;
}

.pet-stat-fill {
  height: 100%;
  transition: width 0.5s ease;
}

.stat-fill-pink {
  background: var(--color-pink-face, #ec4899);
}

.stat-fill-yellow {
  background: var(--color-yellow-500, #eab308);
}

/* 动作按钮 */
.pet-section-title {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--color-text-muted);
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
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  cursor: pointer;
  font-weight: 700;
  font-size: 11px;
  color: var(--color-text-secondary);
  transition: all 0.2s;
}

.pet-action-btn:hover {
  border-color: var(--color-sky-light);
  transform: translateY(-2px);
  color: var(--color-sky-500);
}

.pet-action-btn:active {
  transform: scale(0.95);
}

.pet-action-icon {
  font-size: 20px;
}

/* 最近互动 */
.pet-recent-text {
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.6;
}

/* ═══ 动画 ═══ */
.bubble-enter-active {
  transition: all 0.3s ease-out;
}

.bubble-leave-active {
  transition: all 0.2s ease-in;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-30%) translateY(8px);
}
</style>
