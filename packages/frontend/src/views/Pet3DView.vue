<script setup lang="ts">
/**
 * Pet3DView — 宠物互动页面 (双模式)
 *
 * 作为 Electron 独立透明桌宠窗口使用。
 *
 * 按 S05 §1 规范拆分:
 * - View 层: 模板 + composable 组装 (~120 行 script)
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
import BedrockAvatar from '../components/avatar/BedrockAvatar.vue'
import PetOverlayUI from '../components/pet/PetOverlayUI.vue'
import PetBubbleSurface from '../components/pet/PetBubbleSurface.vue'
import { LyricOverlay } from '../components/overlays'
import { usePetBubble } from '../composables/pet/usePetBubble'
import { usePetWindow } from '../composables/pet/usePetWindow'
import { usePetGateway } from '../composables/pet/usePetGateway'
import { usePetVoice } from '../composables/pet/usePetVoice'
import { usePetAudio } from '../composables/pet/usePetAudio'
import { usePetTexts } from '../composables/pet/usePetTexts'
import { usePetInteraction } from '../composables/pet/usePetInteraction'
import { voiceApi } from '../api/modules/voiceApi'
import { useNotificationStore } from '../stores'
import {
  AVATAR_MODEL_STORAGE_KEY,
  DEFAULT_AVATAR_MANIFEST_PATH,
} from '../components/avatar/lib/avatarDefaults'

defineOptions({ name: 'Pet3DView' })

// ═══ 组装 composables ═══
const {
  bubbleText,
  isBubbleVisible,
  bubbleKey,
  isBubbleExpanded,
  isBubbleOverflow,
  bubbleStyle,
  bubbleContentRef,
  showBubble: showLocalBubbleText,
  toggleExpand,
} = usePetBubble()
const localBubbleOverride = ref(false)
function showBubble(text: string, duration?: number): void {
  localBubbleOverride.value = true
  showLocalBubbleText(text, duration)
}

// ── 当前气泡来源：最近触发的本地互动台词可临时覆盖 AI Surface。 ──
const showLocalBubble = computed(() => localBubbleOverride.value || !activeSurface.value)

// ── 歌词文本来自与气泡相同的 AI Surface；本地台词仅作无 AI 内容时的回退。 ──
const filteredLyricText = computed(() =>
  showLocalBubble.value ? bubbleText.value : surfaceText.value || bubbleText.value,
)

// ts-plugin 对 Vue 模板 ref 的误报修复：显式读取一次以消除 "declared but never read" warning
void bubbleContentRef

const { globalMouse, isDragging, onInteractableEnter, onInteractableLeave } = usePetWindow()

// ── TTS 音频播放 + 唇同步 ──
const {
  isPlaying: isSpeaking,
  mouthOpen,
  receiveAudioChunk,
  playAsset,
  stopAll: stopAudioOutput,
} = usePetAudio()
const cancelledAudioPlaybacks = new Set<string>()
let removeAudioPlayListener: (() => void) | undefined
let removeAudioStopListener: (() => void) | undefined

// ── Gateway 对话同步；AI 正文由统一 Surface 提供 ──
const { chatState, activeSurface, surfaceText, sendChat } = usePetGateway({
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
// petName 优先级: 动态获取的 agentName > 'Pero'
const petName = computed(() => agentName.value || 'Pero')

// ── 角色引用 ──
const avatarRef = ref<InstanceType<typeof BedrockAvatar> | null>(null)

// ── 交互处理 ──
const { onPet, onHoverStart, onHoverEnd } = usePetInteraction({
  avatarRef,
  showBubble,
  getClickText,
  startIdleTimer,
  onInteractableEnter,
  onInteractableLeave,
})

watch(isBubbleVisible, (visible) => {
  if (!visible && localBubbleOverride.value && activeSurface.value) {
    localBubbleOverride.value = false
    isBubbleVisible.value = true
  }
})

// ── Gateway Surface → 气泡可见性；正文不再复制到 usePetBubble。 ──
watch(activeSurface, (surface) => {
  if (surface) {
    localBubbleOverride.value = false
    isBubbleVisible.value = true
  }
})

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

// ── 当前模型加载路径；优先恢复用户选择，否则使用全局默认模型 ──
const currentManifestPath = ref(
  typeof localStorage !== 'undefined'
    ? localStorage.getItem(AVATAR_MODEL_STORAGE_KEY) || DEFAULT_AVATAR_MANIFEST_PATH
    : DEFAULT_AVATAR_MANIFEST_PATH,
)

/**
 * 显式调用 BedrockAvatar 切换模型，并通过 complete 把真实结果返回外观菜单。
 * 不再依赖 prop watcher，避免点击事件更新了路径但加载时序未触发。
 */
async function onModelChange(
  manifestPath: string,
  complete: (success: boolean, message?: string) => void,
): Promise<void> {
  const avatar = avatarRef.value as
    | (InstanceType<typeof BedrockAvatar> & {
        loadManifestPath?: (path: string) => Promise<boolean>
      })
    | null
  if (!avatar?.loadManifestPath) {
    complete(false, '模型渲染器尚未就绪')
    return
  }

  try {
    const success = await avatar.loadManifestPath(manifestPath)
    if (success) currentManifestPath.value = manifestPath
    complete(success, success ? undefined : '模型解析或渲染失败')
  } catch (error) {
    complete(false, error instanceof Error ? error.message : String(error))
  }
}
const displayMode = ref<'bubble' | 'lyric'>(
  ((typeof localStorage !== 'undefined' && localStorage.getItem('ppc.display_mode')) ||
    'bubble') as 'bubble' | 'lyric',
)

function onDisplayModeChange(mode: 'bubble' | 'lyric') {
  displayMode.value = mode
  localStorage.setItem('ppc.display_mode', mode)
}

// ── 歌词模式: 追踪上一次可见内容 (切换模式时丝滑过渡) ──
const lastLyricText = ref('')
watch(filteredLyricText, (text) => {
  if (text) lastLyricText.value = text
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
  removeAudioPlayListener = window.electron?.on('audio-output:play', (...args: unknown[]) => {
    const payload = args[0] as { playbackId?: unknown; assetUrl?: unknown }
    const playbackId = String(payload.playbackId ?? '')
    const assetUrl = String(payload.assetUrl ?? '')
    if (!playbackId || !assetUrl.startsWith('/api/assets/audio/')) return
    void playAsset(playbackId, assetUrl)
      .then(() => {
        window.electron?.send('audio-output:receipt', { playbackId, state: 'completed' })
      })
      .catch(() => {
        window.electron?.send('audio-output:receipt', { playbackId, state: 'cancelled' })
      })
  })
  removeAudioStopListener = window.electron?.on('audio-output:stop', (...args: unknown[]) => {
    const payload = args[0] as { playbackId?: unknown }
    const playbackId = String(payload.playbackId ?? '')
    if (!playbackId) return
    cancelledAudioPlaybacks.add(playbackId)
    stopAudioOutput()
    window.electron?.send('audio-output:receipt', { playbackId, state: 'cancelled' })
  })
})
onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
  removeAudioPlayListener?.()
  removeAudioStopListener?.()
})

// 初始气泡已由 usePetTexts.showTimeBasedWelcome() 自动显示
</script>

<template>
  <div class="pet-view">
    <!-- 渲染区 -->
    <div class="pet-canvas-area">
      <BedrockAvatar
        ref="avatarRef"
        :is-dragging="isDragging"
        :manifest-path="currentManifestPath"
        @pet="onPet"
        @hover-start="onHoverStart"
        @hover-end="onHoverEnd"
      />

      <!-- 对话气泡 (歌词模式下隐藏，避免与歌词浮层重叠) -->
      <Transition name="bubble">
        <div
          v-if="isBubbleVisible && displayMode === 'bubble'"
          :key="bubbleKey"
          class="pet-bubble"
          :class="{ 'pet-bubble--expanded': isBubbleExpanded }"
          :style="bubbleStyle"
        >
          <div
            ref="bubbleContentRef"
            class="pet-bubble-content"
            :class="{ 'pet-bubble-content--expanded': isBubbleExpanded }"
          >
            <template v-if="showLocalBubble">{{ bubbleText }}</template>
            <PetBubbleSurface v-else-if="activeSurface" :surface="activeSurface" />
          </div>
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
    </div>

    <!-- 独立模式: 悬浮 UI -->
    <PetOverlayUI
      :pet-name="petName"
      :mood-text="chatState.mood"
      :vibe-text="chatState.vibe"
      :mind-text="chatState.mind"
      :is-thinking="chatState.isThinking"
      :voice-mode="voiceMode"
      :is-recording="isRecording"
      :display-mode="displayMode"
      :avatar-ref="avatarRef as any"
      @send-message="onOverlaySendMessage"
      @ui-enter="onInteractableEnter"
      @ui-leave="onInteractableLeave"
      @voice-mode="handleSetVoiceMode"
      @ptt-down="handlePttDown"
      @ptt-up="pttUp"
      @model-change="onModelChange"
      @display-mode-change="onDisplayModeChange"
    />

    <!-- 歌词模式浮层 (独立模式 + displayMode=lyric) -->
    <LyricOverlay
      v-if="displayMode === 'lyric'"
      :text="lastLyricText || (chatState.isThinking ? '' : filteredLyricText)"
      :is-thinking="chatState.isThinking"
      :thinking-message="chatState.thinkingMessage"
      :eager="!!lastLyricText"
      @ui-enter="onInteractableEnter"
      @ui-leave="onInteractableLeave"
    />
  </div>
</template>

<style scoped>
/* ═══ 根容器 (v1 体素风) ═══ */
.pet-view {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: transparent;
  font-family: 'Consolas', 'Monaco', monospace;
}

/* ═══ 渲染区 ═══ */
.pet-canvas-area {
  flex: 1;
  position: relative;
  background: transparent;
  overflow: hidden;
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
  pointer-events: none;
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

/* ── 气泡内容（纯文本，保留换行） ── */
.pet-bubble-content {
  max-height: 120px;
  overflow-y: hidden;
  scrollbar-width: thin;
  pointer-events: none;
  white-space: pre-wrap;
  word-break: break-word;
}

.pet-bubble-content--expanded {
  max-height: 400px;
  overflow-y: auto;
  pointer-events: auto;
}

.pet-bubble-content--expanded::-webkit-scrollbar {
  width: 3px;
}
.pet-bubble-content--expanded::-webkit-scrollbar-thumb {
  background: #666;
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
  /* 父级 .pet-bubble 设了 pointer-events:none，按钮需单独恢复点击 */
  pointer-events: auto;
}
.pet-bubble-toggle:hover {
  color: #fff;
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
