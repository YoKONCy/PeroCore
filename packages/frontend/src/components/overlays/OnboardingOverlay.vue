<script setup lang="ts">
/**
 * OnboardingOverlay — 新手引导遮罩
 *
 * 拆分为 OnboardingOverlay + SpotlightMask。
 * 打字机对话框 + 聚光灯高亮 + 角色立绘占位。
 *
 * @props visible - 是否显示
 * @props steps - 引导步骤
 * @emits finish - 引导完成
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { PixelIcon, PButton } from '../pixel'
import SpotlightMask from './SpotlightMask.vue'

export interface OnboardingStep {
  /** 说话者名称 */
  speaker?: string
  /** 对话文本 */
  text: string
  /** 表情标识 (用于立绘/图标) */
  expression?: string
  /** 聚焦元素 CSS 选择器 */
  focusSelector?: string | null
  /** 选择按钮 */
  choices?: { label: string; value: string }[]
}

interface Props {
  visible: boolean
  steps: OnboardingStep[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  finish: []
  'update:visible': [val: boolean]
  choice: [value: string]
}>()

const currentIndex = ref(0)
const displayedText = ref('')
const isTypingDone = ref(false)
const isAppearing = ref(false)

let typeTimer: ReturnType<typeof setInterval> | null = null

const currentStep = computed(() => props.steps[currentIndex.value])

/** 开始打字机效果 */
function startTyping() {
  if (typeTimer) clearInterval(typeTimer)
  const text = currentStep.value?.text ?? ''
  displayedText.value = ''
  isTypingDone.value = false
  let i = 0
  typeTimer = setInterval(() => {
    if (i < text.length) {
      displayedText.value += text[i]
      i++
    } else {
      isTypingDone.value = true
      if (typeTimer) clearInterval(typeTimer)
    }
  }, 35)
}

/** 跳到完整文本 / 下一步 */
function handleNext() {
  if (!isTypingDone.value) {
    // 跳过打字，直接显示完整文本
    if (typeTimer) clearInterval(typeTimer)
    displayedText.value = currentStep.value?.text ?? ''
    isTypingDone.value = true
    return
  }
  if (currentStep.value?.choices) return // 有选择项时不自动跳转
  advance()
}

/** 前进一步 */
function advance() {
  if (currentIndex.value < props.steps.length - 1) {
    currentIndex.value++
    startTyping()
  } else {
    // 完成
    isAppearing.value = false
    setTimeout(() => {
      emit('finish')
      emit('update:visible', false)
    }, 400)
  }
}

/** 选择 */
function handleChoice(value: string) {
  emit('choice', value)
  advance()
}

// 监听显示变化
watch(
  () => props.visible,
  (v) => {
    if (v) {
      currentIndex.value = 0
      setTimeout(() => {
        isAppearing.value = true
        startTyping()
      }, 200)
    } else {
      isAppearing.value = false
      if (typeTimer) clearInterval(typeTimer)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (typeTimer) clearInterval(typeTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="onb-fade">
      <div
        v-if="visible"
        :class="['onb-overlay', { 'onb-visible': isAppearing }]"
        @click.self="handleNext"
      >
        <!-- 聚光灯 -->
        <SpotlightMask :selector="currentStep?.focusSelector ?? null" />

        <!-- 角色占位 (立绘 TODO: P5 接入资源) -->
        <div v-if="currentStep?.expression !== 'none'" class="onb-character">
          <div class="onb-char-placeholder">
            <PixelIcon name="heart" size="3xl" />
          </div>
        </div>

        <!-- 对话框 -->
        <div :class="['onb-dialog', { 'onb-dialog-visible': isAppearing }]" @click="handleNext">
          <!-- 名称标签 -->
          <div class="onb-name-tag">
            {{ currentStep?.speaker ?? 'Pero' }}
          </div>

          <!-- 文本 -->
          <div class="onb-text">
            <span>{{ displayedText }}</span>
            <span v-if="isTypingDone" class="onb-cursor">▼</span>
          </div>

          <!-- 选择按钮 -->
          <div v-if="currentStep?.choices && isTypingDone" class="onb-choices">
            <PButton
              v-for="choice in currentStep.choices"
              :key="choice.value"
              variant="primary"
              @click.stop="handleChoice(choice.value)"
            >
              {{ choice.label }}
            </PButton>
          </div>

          <!-- 继续提示 -->
          <div v-if="!currentStep?.choices && isTypingDone" class="onb-hint">点击此处继续喵...</div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.onb-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding: 48px;
  background: rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.5s;
  pointer-events: auto;
}
.onb-visible {
  opacity: 1;
}

/* 角色 */
.onb-character {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}
.onb-char-placeholder {
  width: 200px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-sky-light);
  opacity: 0.3;
}

/* 对话框 */
.onb-dialog {
  width: 100%;
  max-width: 800px;
  padding: 40px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-sky-500);
  box-shadow: 0 20px 60px rgba(56, 189, 248, 0.15);
  position: relative;
  z-index: 20;
  cursor: pointer;
  transform: translateY(20px);
  opacity: 0;
  transition: all 0.5s;
}
.onb-dialog-visible {
  transform: translateY(0);
  opacity: 1;
}

.onb-name-tag {
  position: absolute;
  top: -20px;
  left: 24px;
  padding: 8px 24px;
  background: var(--color-sky-500);
  color: white;
  font-weight: 800;
  font-size: 16px;
  letter-spacing: 0.15em;
  border: 2px solid var(--color-sky-shadow);
}

.onb-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.8;
  min-height: 80px;
}

.onb-cursor {
  display: inline-block;
  margin-left: 8px;
  color: var(--color-sky-hover);
  animation: bounce 1s infinite;
}

.onb-choices {
  display: flex;
  gap: 16px;
  margin-top: 24px;
}

.onb-hint {
  position: absolute;
  bottom: 16px;
  right: 24px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3em;
  animation: pulse 2s infinite;
}

/* Transition */
.onb-fade-enter-active,
.onb-fade-leave-active {
  transition: opacity 0.5s;
}
.onb-fade-enter-from,
.onb-fade-leave-to {
  opacity: 0;
}

@keyframes bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(4px);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
