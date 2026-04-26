<script setup lang="ts">
/**
 * PetOverlayUI — 桌宠独立窗口的悬浮控制层 (v1 体素风)
 *
 * 还原 v1 完整交互：
 * - 光球触发器 → 展开/收起所有 UI
 * - 状态标签 (心情/氛围/内心)
 * - 聊天输入框
 * - 工具栏 (8个按钮，竖排)
 * - 外观菜单 (角色选择/服装/动画)
 * - PTT 悬浮按钮
 * - 窗口大小循环切换
 * - displayMode 持久化
 * - uiScale 自适应缩放
 *
 * @module packages/frontend/src/components/pet/PetOverlayUI
 */
import { ref, computed, onMounted, onUnmounted, watch, type ComponentPublicInstance } from 'vue'
import { invoke } from '../../utils/ipcAdapter'
import PixelIcon from '../pixel/PixelIcon.vue'

interface Props {
  petName?: string
  moodText?: string
  vibeText?: string
  mindText?: string
  isThinking?: boolean
  voiceMode?: 'off' | 'vad' | 'ptt'
  isRecording?: boolean
  audioLevel?: number
  /** BedrockAvatar 组件引用 (用于外观菜单) */
  avatarRef?: ComponentPublicInstance | null
}

const props = withDefaults(defineProps<Props>(), {
  petName: 'Pero',
  moodText: '开心',
  vibeText: '轻松',
  mindText: '发呆',
  isThinking: false,
  voiceMode: 'off',
  isRecording: false,
  audioLevel: 0,
  avatarRef: null,
})

const emit = defineEmits<{
  (e: 'send-message', text: string): void
  (e: 'ui-enter'): void
  (e: 'ui-leave'): void
  (e: 'voice-mode', mode: 'off' | 'vad' | 'ptt'): void
  (e: 'ptt-down'): void
  (e: 'ptt-up'): void
  (e: 'model-change', manifestPath: string): void
}>()

// ── 展开/收起 (v1: showInput) ──
const showUI = ref(false)
const userInput = ref('')
const showAppearanceMenu = ref(false)

function toggleUI() {
  showUI.value = !showUI.value
  if (!showUI.value) {
    showAppearanceMenu.value = false
  }
}

function toggleAppearanceMenu() {
  showAppearanceMenu.value = !showAppearanceMenu.value
}

function sendMessage() {
  const text = userInput.value.trim()
  if (!text) return
  emit('send-message', text)
  userInput.value = ''
}

// ── UI Scale (v1: minDim/800, 0.5~1.3) ──
const uiScale = ref(1)

function updateScale() {
  const minDim = Math.min(window.innerWidth, window.innerHeight)
  const s = minDim / 800
  uiScale.value = Math.min(Math.max(s, 0.5), 1.3)
}

onMounted(() => {
  updateScale()
  window.addEventListener('resize', updateScale)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScale)
})

// ── 窗口大小无极调整模式 ──
const isResizeMode = ref(false)
const currentWindowSize = ref(800) // 当前窗口边长

function toggleResizeMode() {
  isResizeMode.value = !isResizeMode.value
}

/** 滚轮缩放窗口 (仅在 resizeMode 开启时生效) */
function onResizeWheel(e: WheelEvent) {
  if (!isResizeMode.value) return
  e.preventDefault()
  e.stopPropagation()
  // 滚轮上滚放大，下滚缩小，每次步进 40px
  const delta = e.deltaY < 0 ? 40 : -40
  currentWindowSize.value = Math.min(Math.max(currentWindowSize.value + delta, 300), 1600)
  invoke('resize-pet-window', {
    width: currentWindowSize.value,
    height: currentWindowSize.value,
  }).catch(() => {})
}

// 进入/退出 resize 模式时绑定/解绑全局 wheel
watch(isResizeMode, (active) => {
  if (active) {
    window.addEventListener('wheel', onResizeWheel, { passive: false })
  } else {
    window.removeEventListener('wheel', onResizeWheel)
  }
})

onUnmounted(() => {
  window.removeEventListener('wheel', onResizeWheel)
})

// ── 窗口导航 (IPC 通道名与 ipcBridge.ts 对应) ──
function reloadPet() {
  window.location.reload()
}

function openChatWindow() {
  // 打开 IDE/工作台窗口 (含 ChatView)
  invoke('open-ide-window').catch(() => {})
}

function openDashboard() {
  // 注意：IPC 通道是 open-dashboard-window 不是 open-dashboard
  invoke('open-dashboard-window').catch(() => {})
}

function minimizeToTray() {
  invoke('hide-pet-window').catch(() => {})
}

// ── 语音模式切换 ──
const voiceModeIcons: Record<string, string> = {
  off: 'volume-x',
  vad: 'mic',
  ptt: 'hand',
}

const voiceModeTitles: Record<string, string> = {
  off: '语音对话: 已关闭',
  vad: '语音对话: 自动感应 (VAD)',
  ptt: '语音对话: 按住说话 (PTT)',
}

function cycleVoiceMode() {
  const modes: Array<'off' | 'vad' | 'ptt'> = ['off', 'vad', 'ptt']
  const idx = modes.indexOf(props.voiceMode ?? 'off')
  emit('voice-mode', modes[(idx + 1) % modes.length] ?? 'off')
}

// ── 显示模式 (气泡/歌词) + localStorage 持久化 ──
const displayMode = ref(
  (typeof localStorage !== 'undefined' && localStorage.getItem('ppc.display_mode')) || 'bubble',
)

function toggleDisplayMode() {
  displayMode.value = displayMode.value === 'bubble' ? 'lyric' : 'bubble'
  localStorage.setItem('ppc.display_mode', displayMode.value)
}

// ── 外观菜单: 获取 avatar 数据 ──
const avatarClothingState = computed(() => {
  const av = props.avatarRef as Record<string, unknown> | null
  return (av?.clothingState ?? {}) as Record<string, boolean>
})

const avatarFeatureButtons = computed(() => {
  const av = props.avatarRef as Record<string, unknown> | null
  return (av?.featureButtons ?? []) as Array<{ id: string; label: string }>
})

const avatarAnimList = computed(() => {
  const av = props.avatarRef as Record<string, unknown> | null
  return (av?.animList ?? []) as string[]
})

function setAvatarAnimation(animName: string) {
  const av = props.avatarRef as Record<string, unknown> | null
  if (av && typeof av.setAnimation === 'function') {
    ;(av.setAnimation as (n: string) => void)(animName)
  }
}

function updateAvatarClothing() {
  const av = props.avatarRef as Record<string, unknown> | null
  if (av && typeof av.updateClothing === 'function') {
    ;(av.updateClothing as () => void)()
  }
}

// ── 角色选择网格 (v1: scan-3d-models IPC) ──
interface ModelInfo {
  name: string
  path: string
  thumbnail?: string
}

const availableModels = ref<ModelInfo[]>([])
const currentModelName = ref('')
const isLoadingModels = ref(false)

/** 扫描可用 3D 模型 */
async function scanModels() {
  if (isLoadingModels.value) return
  isLoadingModels.value = true
  try {
    const models = (await invoke('scan-3d-models')) as ModelInfo[]
    if (Array.isArray(models)) {
      availableModels.value = models
    }
  } catch {
    // 扫描失败不影响核心功能
  } finally {
    isLoadingModels.value = false
  }
}

/** 选择模型 */
async function selectModel(model: ModelInfo) {
  try {
    const loadPath = (await invoke('get-model-load-path', model)) as string
    if (loadPath) {
      currentModelName.value = model.name
      emit('model-change', loadPath)
    }
  } catch {
    // 模型加载失败
  }
}

// 外观菜单打开时扫描模型
watch(showAppearanceMenu, (v: boolean) => {
  if (v && availableModels.value.length === 0) {
    scanModels()
  }
})

// ── 暴露给父组件 ──
defineExpose({ displayMode })
</script>

<template>
  <div class="overlay-root" @mouseenter="emit('ui-enter')" @mouseleave="emit('ui-leave')">
    <!-- 状态标签 (左上角, v1 位置) -->
    <Transition name="fade">
      <div
        v-show="showUI"
        class="status-tags"
        :style="{ transform: `scale(${uiScale})`, transformOrigin: 'top left' }"
      >
        <div class="status-tag mood" :title="'情绪: ' + moodText">
          <PixelIcon name="heart" size="xs" />
          {{ moodText }}
        </div>
        <div class="status-tag vibe" :title="'氛围: ' + vibeText">
          <PixelIcon name="sparkle" size="xs" />
          {{ vibeText }}
        </div>
        <div class="status-tag mind" :title="'内心: ' + mindText">
          <PixelIcon name="thought" size="xs" />
          {{ mindText }}
        </div>
      </div>
    </Transition>

    <!-- 可缩放 UI 容器 (v1: ui-scalable-wrapper) -->
    <div class="ui-scalable-wrapper" :style="{ transform: `scale(${uiScale})` }">
      <!-- 悬浮触发器 (v1 光球方块, 角色右侧) -->
      <div
        class="floating-trigger"
        :class="{ active: showUI }"
        style="-webkit-app-region: no-drag"
        @click.stop="toggleUI"
        @mouseenter="emit('ui-enter')"
        @mouseleave="emit('ui-leave')"
      >
        <div class="trigger-core">
          <div class="pulse-ring" />
          <div class="core-dot" />
        </div>
      </div>

      <!-- 输入框 (v1: input-overlay, 底部居中) -->
      <div
        v-show="showUI"
        class="input-overlay"
        style="-webkit-app-region: no-drag"
        @mouseenter="emit('ui-enter')"
      >
        <input
          v-model="userInput"
          class="chat-input"
          :placeholder="isThinking ? '思考中...' : `跟 ${petName} 对话...`"
          :disabled="isThinking"
          style="-webkit-app-region: no-drag"
          @keyup.enter="sendMessage"
        />
      </div>

      <!-- 工具栏 (v1: pet-tools, 右侧竖排, 8个按钮) -->
      <div
        v-show="showUI"
        class="pet-tools"
        style="-webkit-app-region: no-drag"
        @mouseenter="emit('ui-enter')"
      >
        <button
          class="tool-btn"
          title="外观设置"
          :class="{ active: showAppearanceMenu }"
          @click.stop="toggleAppearanceMenu"
        >
          <PixelIcon name="palette" size="sm" />
        </button>
        <button class="tool-btn" title="重载" @click.stop="reloadPet">
          <PixelIcon name="refresh" size="sm" />
        </button>
        <button
          class="tool-btn"
          :class="{ active: isResizeMode }"
          title="调整大小 (滚轮缩放)"
          @click.stop="toggleResizeMode"
        >
          <PixelIcon name="desktop" size="sm" />
        </button>
        <button
          class="tool-btn voice-btn"
          :class="{
            active: voiceMode !== 'off',
            'mode-vad': voiceMode === 'vad',
            'mode-ptt': voiceMode === 'ptt',
          }"
          :title="voiceModeTitles[voiceMode]"
          @click.stop="cycleVoiceMode"
        >
          <PixelIcon :name="voiceModeIcons[voiceMode] ?? 'volume-x'" size="sm" />
        </button>
        <button
          class="tool-btn"
          :title="displayMode === 'bubble' ? '切换到歌词模式' : '切换到气泡模式'"
          @click.stop="toggleDisplayMode"
        >
          <PixelIcon :name="displayMode === 'bubble' ? 'mic' : 'chat'" size="sm" />
        </button>
        <button class="tool-btn" title="聊天" @click.stop="openChatWindow">
          <PixelIcon name="chat" size="sm" />
        </button>
        <button class="tool-btn" title="面板" @click.stop="openDashboard">
          <PixelIcon name="settings" size="sm" />
        </button>
        <button class="tool-btn" title="最小化到托盘" @click.stop="minimizeToTray">
          <PixelIcon name="minus" size="sm" />
        </button>
      </div>

      <!-- 调整大小模式提示气泡 -->
      <Transition name="fade">
        <div v-if="isResizeMode" class="resize-hint" style="-webkit-app-region: no-drag">
          <div class="resize-hint-inner">
            <PixelIcon name="desktop" size="sm" />
            <span>🖱️ 滚轮缩放 · 再次点击退出</span>
            <span class="resize-hint-size">{{ currentWindowSize }}px</span>
          </div>
        </div>
      </Transition>

      <!-- PTT 悬浮按钮 (v1 体素风) -->
      <Transition name="fade">
        <div
          v-if="voiceMode === 'ptt'"
          class="ptt-voxel-container"
          style="-webkit-app-region: no-drag"
          @mousedown.stop="emit('ptt-down')"
          @mouseup.stop="emit('ptt-up')"
          @mouseleave.stop="emit('ptt-up')"
        >
          <div class="ptt-voxel-btn" :class="{ recording: isRecording }" title="按住说话">
            <span class="ptt-icon"><PixelIcon name="mic" size="lg" /></span>
            <span v-if="isRecording" class="ptt-text">正在聆听...</span>
          </div>
        </div>
      </Transition>

      <!-- 外观菜单 (v1: appearance-menu, 角色左侧) -->
      <Transition name="fade">
        <div
          v-if="showAppearanceMenu && showUI"
          class="appearance-menu"
          @mouseenter="emit('ui-enter')"
        >
          <div class="menu-header">
            <span>外观控制</span>
            <button class="close-mini-btn" @click="showAppearanceMenu = false">×</button>
          </div>

          <!-- 角色选择网格 (v1 还原: scan-3d-models) -->
          <div v-if="availableModels.length > 0" class="menu-section">
            <div class="menu-label">角色选择</div>
            <div class="model-grid">
              <button
                v-for="model in availableModels"
                :key="model.name"
                class="model-card"
                :class="{ active: currentModelName === model.name }"
                :title="model.name"
                @click="selectModel(model)"
              >
                <div class="model-thumb">
                  <img
                    v-if="model.thumbnail"
                    :src="model.thumbnail"
                    :alt="model.name"
                    class="model-thumb-img"
                  />
                  <span v-else class="model-thumb-icon"><PixelIcon name="user" size="xl" /></span>
                </div>
                <span class="model-name">{{ model.name }}</span>
              </button>
            </div>
            <button
              class="tool-btn"
              style="margin-top: 6px; width: 100%"
              :disabled="isLoadingModels"
              @click="scanModels"
            >
              <template v-if="isLoadingModels">
                <PixelIcon name="loader" size="sm" animation="spin" />
                扫描中...
              </template>
              <template v-else>
                <PixelIcon name="refresh" size="sm" />
                重新扫描
              </template>
            </button>
          </div>

          <!-- 服装部件 -->
          <div v-if="avatarFeatureButtons.length > 0" class="menu-section">
            <div class="menu-label">服装部件</div>
            <label v-for="btn in avatarFeatureButtons" :key="btn.id" class="voxel-checkbox">
              <input
                v-model="avatarClothingState[btn.id]"
                type="checkbox"
                @change="updateAvatarClothing"
              />
              <span class="checkmark" />
              {{ btn.label }}
            </label>
          </div>

          <!-- 动作调试 -->
          <div v-if="avatarAnimList.length > 0" class="menu-section">
            <div class="menu-label">动作调试</div>
            <select
              class="voxel-select"
              @change="(e) => setAvatarAnimation((e.target as HTMLSelectElement).value)"
            >
              <option value="">-- 选择动作 --</option>
              <option value="__NONE__">-- 无动画 --</option>
              <option v-for="anim in avatarAnimList" :key="anim" :value="anim">
                {{ anim }}
              </option>
            </select>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
/* ═══ v1 体素(Voxel)深色风格 ═══ */

.overlay-root {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  font-family: 'Consolas', 'Monaco', monospace;
}

.overlay-root > * {
  pointer-events: auto;
  -webkit-app-region: no-drag;
}

.ui-scalable-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: center center;
  display: flex;
  justify-content: center;
  align-items: center;
}

.ui-scalable-wrapper > * {
  pointer-events: auto;
}

/* ── 状态标签 (v1 位置: left:40px, top:160px) ── */
.status-tags {
  position: absolute;
  left: 40px;
  top: 160px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
  pointer-events: auto;
}

.status-tag {
  background: rgba(20, 20, 20, 0.85);
  padding: 8px 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  color: #ffffff;
  border: 2px solid #e0e0e0;
  white-space: nowrap;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s;
  cursor: default;
  text-shadow: 1px 1px 0 #000;
}

.status-tag:hover {
  transform: translateX(5px);
  background: rgba(40, 40, 40, 0.95);
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  border-color: #ffffff;
}

.status-tag.mood {
  border-color: #ff88aa;
  color: #ffccdd;
}
.status-tag.vibe {
  border-color: #88ccff;
  color: #cceeff;
}
.status-tag.mind {
  border-color: #88ffaa;
  color: #ccffdd;
  white-space: normal;
  max-width: 180px;
  word-break: break-all;
  line-height: 1.4;
  align-items: flex-start;
}

/* ── 悬浮触发器 (v1: 角色右侧) ── */
.floating-trigger {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(140px, -50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 100;
}

.trigger-core {
  position: relative;
  width: 24px;
  height: 24px;
  transition: all 0.3s ease;
  animation: core-idle 4s infinite ease-in-out;
}

.core-dot {
  position: absolute;
  width: 100%;
  height: 100%;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  transition: all 0.2s ease;
  box-shadow:
    0 0 15px rgba(255, 255, 255, 0.6),
    2px 2px 0px rgba(0, 0, 0, 0.3);
  border: 2px solid #fff;
}

.pulse-ring {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-radius: 4px;
  opacity: 0;
  animation: pulse-ring-smooth 2s infinite cubic-bezier(0.215, 0.61, 0.355, 1);
  box-sizing: border-box;
}

@keyframes core-idle {
  0% {
    transform: translateY(0) rotate(0deg);
  }
  25% {
    transform: translateY(-3px) rotate(15deg);
  }
  50% {
    transform: translateY(0) rotate(0deg);
  }
  75% {
    transform: translateY(3px) rotate(-15deg);
  }
  100% {
    transform: translateY(0) rotate(0deg);
  }
}

@keyframes pulse-ring-smooth {
  0% {
    transform: scale(0.8) rotate(0deg);
    opacity: 0.8;
    border-width: 2px;
  }
  50% {
    opacity: 0.5;
  }
  100% {
    transform: scale(2.4) rotate(90deg);
    opacity: 0;
    border-width: 0;
  }
}

.floating-trigger:hover .trigger-core {
  animation-play-state: paused;
  transform: scale(1.1) rotate(45deg);
}
.floating-trigger:hover .core-dot {
  background: #ffffff;
  box-shadow:
    0 0 20px rgba(255, 255, 255, 1),
    0 0 40px rgba(255, 255, 255, 0.6);
}
.floating-trigger.active .trigger-core {
  transform: rotate(45deg);
}
.floating-trigger.active .core-dot {
  background: #ff88aa;
  border-color: #ffccdd;
  box-shadow: 0 0 15px rgba(255, 136, 170, 0.6);
}
.floating-trigger.active .pulse-ring {
  border-color: rgba(255, 136, 170, 0.5);
  animation-duration: 1.5s;
}

/* ── 聊天输入框 (v1: 底部居中) ── */
.input-overlay {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
}

.chat-input {
  background: rgba(20, 20, 20, 0.85);
  backdrop-filter: blur(4px);
  border: 2px solid #e0e0e0;
  border-radius: 4px;
  padding: 10px 16px;
  width: 240px;
  outline: none;
  font-size: 14px;
  font-weight: 500;
  color: #ffffff;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  transition: all 0.2s;
  font-family: 'Consolas', monospace;
}

.chat-input::placeholder {
  color: #888;
  font-weight: 400;
}
.chat-input:focus {
  width: 280px;
  background: rgba(30, 30, 30, 0.95);
  border-color: #ffffff;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  transform: translateY(-2px);
}
.chat-input:disabled {
  opacity: 0.5;
}

/* ── 工具栏 (v1: 右侧竖排, 角色更右侧) ── */
.pet-tools {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(200px, -50%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* 去除原来的笨重容器背景和边框，让按钮像左侧标签一样独立悬浮 */
  background: transparent;
  padding: 8px 0;
}

.tool-btn {
  background: rgba(20, 20, 20, 0.85);
  border: 2px solid #e0e0e0;
  width: 42px;
  height: 42px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.2s;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  color: #ffffff;
  text-shadow: 1px 1px 0px #000;
}

.tool-btn:hover,
.tool-btn.active {
  transform: translateX(-5px); /* 向内滑动，与左侧标签从左向右滑动对称 */
  background: rgba(40, 40, 40, 0.95);
  border-color: #ffffff;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  color: #ffffff;
}

.tool-btn:active {
  transform: translateX(-3px) translateY(2px);
  box-shadow: 2px 2px 0px rgba(0, 0, 0, 0.6);
}

.voice-btn.active.mode-vad {
  color: #ff99cc;
  border-color: #ff99cc;
}
.voice-btn.active.mode-ptt {
  color: #5fb878;
  border-color: #5fb878;
}

/* ── PTT 按钮 ── */
.ptt-voxel-container {
  position: absolute;
  left: 50%;
  bottom: 70px;
  transform: translateX(-220px);
  z-index: 100;
}

.ptt-voxel-btn {
  background: rgba(40, 40, 40, 0.9);
  border: 2px solid #888;
  border-radius: 50%;
  width: 64px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 4px 4px 0px rgba(0, 0, 0, 0.5);
  transition: all 0.1s;
  color: #ddd;
}

.ptt-voxel-btn:hover {
  transform: translate(-1px, -1px);
  background: #555;
  border-color: #fff;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
}

.ptt-voxel-btn.recording {
  background: #ff4444;
  border-color: #ffcccc;
  color: white;
  animation: pulse-recording 1.5s infinite;
}

.ptt-icon {
  font-size: 24px;
  line-height: 1;
}
.ptt-text {
  font-size: 9px;
  margin-top: 4px;
  font-weight: bold;
  letter-spacing: 1px;
}

@keyframes pulse-recording {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.7);
  }
  70% {
    transform: scale(1.05);
    box-shadow: 0 0 0 10px rgba(255, 68, 68, 0);
  }
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(255, 68, 68, 0);
  }
}

/* ── 外观菜单 (v1: 角色左侧) ── */
.appearance-menu {
  position: absolute;
  left: 50%;
  top: 55%;
  transform: translate(-320px, -50%);
  background: rgba(20, 20, 20, 0.95);
  border: 2px solid #fff;
  border-radius: 6px;
  padding: 12px;
  width: 200px;
  color: white;
  box-shadow: 6px 6px 0px rgba(0, 0, 0, 0.6);
  z-index: 101;
  max-height: 80vh;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #555 #222;
}

.appearance-menu::-webkit-scrollbar {
  width: 6px;
}
.appearance-menu::-webkit-scrollbar-track {
  background: #222;
}
.appearance-menu::-webkit-scrollbar-thumb {
  background: #555;
  border: 1px solid #000;
}

.menu-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid #444;
  font-weight: bold;
}

.close-mini-btn {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.close-mini-btn:hover {
  color: #fff;
}

.menu-section {
  margin-bottom: 12px;
}

.menu-label {
  font-size: 11px;
  color: #aaa;
  margin-bottom: 6px;
  text-transform: uppercase;
}

/* 体素复选框 */
.voxel-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}

.voxel-checkbox input {
  display: none;
}

.voxel-checkbox .checkmark {
  width: 16px;
  height: 16px;
  background: #333;
  border: 2px solid #888;
  position: relative;
  display: inline-block;
  transition: all 0.1s;
}

.voxel-checkbox:hover .checkmark {
  border-color: #fff;
}

.voxel-checkbox input:checked + .checkmark {
  background: #ff88aa;
  border-color: #fff;
}

.voxel-checkbox input:checked + .checkmark::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

/* 体素下拉框 */
.voxel-select {
  width: 100%;
  padding: 6px;
  background: #333;
  border: 2px solid #888;
  color: white;
  font-family: inherit;
  cursor: pointer;
  outline: none;
}
.voxel-select:hover {
  border-color: #fff;
}

/* ── 过渡 ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── 角色选择网格 ── */
.model-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.model-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  background: rgba(40, 40, 40, 0.8);
  border: 2px solid #555;
  cursor: pointer;
  font-family: inherit;
  color: #ccc;
  transition: all 0.15s;
}

.model-card:hover {
  border-color: #fff;
  background: #444;
  color: #fff;
}

.model-card.active {
  border-color: #ff88aa;
  background: rgba(255, 136, 170, 0.15);
  color: #ff88aa;
}

.model-thumb {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid #444;
  overflow: hidden;
}

.model-thumb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: pixelated;
}

.model-thumb-icon {
  font-size: 24px;
}

.model-name {
  font-size: 10px;
  font-weight: 700;
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

/* ── 调整大小提示气泡 ── */
.resize-hint {
  position: absolute;
  top: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 200;
  animation: resize-hint-breathe 2s infinite ease-in-out;
  /* 确保 Transition 的 opacity 能生效 */
  transition: opacity 0.2s ease;
}

.resize-hint-inner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(20, 20, 20, 0.9);
  border: 2px solid #88ccff;
  border-radius: 4px;
  padding: 8px 16px;
  color: #cceeff;
  font-size: 12px;
  font-weight: bold;
  font-family: 'Consolas', monospace;
  white-space: nowrap;
  box-shadow:
    4px 4px 0px rgba(0, 0, 0, 0.5),
    0 0 12px rgba(136, 204, 255, 0.2);
  text-shadow: 1px 1px 0 #000;
}

.resize-hint-size {
  background: rgba(136, 204, 255, 0.15);
  border: 1px solid #88ccff;
  border-radius: 2px;
  padding: 2px 8px;
  font-size: 11px;
  font-family: 'Consolas', monospace;
  color: #88ccff;
}

@keyframes resize-hint-breathe {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
  }
  50% {
    transform: translateX(-50%) scale(1.02);
  }
}
</style>
