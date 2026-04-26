<script setup lang="ts">
/**
 * OnboardingOverlay — 新手引导遮罩
 *
 * 还原 v1 完整实现：打字机对话框 + 聚光灯高亮 + 表情-立绘映射。
 * 立绘资源位于 /assets/onboarding/ 目录。
 *
 * @props visible - 是否显示
 * @props steps - 引导步骤
 * @emits finish - 引导完成
 */
import { ref, computed, watch, onUnmounted } from 'vue'
import { PixelIcon, PButton } from '../pixel'
import SpotlightMask from './SpotlightMask.vue'
import { logger } from '../../lib/logger'

export interface OnboardingStep {
  /** 说话者名称 */
  speaker?: string
  /** 对话文本 */
  text: string
  /** 表情标识 (用于立绘切换): 'normal' | 'proud' | 'none' */
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

/** 当前步骤是否有聚光灯 */
const hasSpotlight = computed(() => !!currentStep.value?.focusSelector)

// ── 表情-立绘映射 (还原 v1) ──

interface ExpressionInfo {
  icon: string
  label: string
  image: string
}

const expressions: Record<string, ExpressionInfo> = {
  normal: {
    icon: 'cat',
    label: '乖巧的 Pero',
    image: '/assets/onboarding/pero_normal.png',
  },
  proud: {
    icon: 'sparkle',
    label: '得意的 Pero',
    image: '/assets/onboarding/pero_proud.png',
  },
}

/** 当前表情对应的图标 */
const currentExpressionIcon = computed(
  () => expressions[currentStep.value?.expression ?? '']?.icon ?? 'cat',
)

/** 当前表情对应的标签 */
const currentExpressionLabel = computed(
  () => expressions[currentStep.value?.expression ?? '']?.label ?? 'Pero',
)

/** 当前表情对应的立绘路径 */
const currentExpressionImage = computed(
  () => expressions[currentStep.value?.expression ?? '']?.image ?? null,
)

// ── 立绘预加载 ──

const preloadedImages = ref(new Set<string>())

/** 预加载所有立绘资源 */
function preloadOnboardingImages() {
  const imageUrls = Object.values(expressions)
    .map((e) => e.image)
    .filter(Boolean)

  imageUrls.forEach((url) => {
    if (preloadedImages.value.has(url)) return
    const img = new Image()
    img.src = url
    img.onload = () => {
      preloadedImages.value.add(url)
      logger.info('Onboarding', `立绘预加载成功: ${url}`)
    }
    img.onerror = () => {
      logger.error('Onboarding', `立绘预加载失败: ${url}`)
    }
  })
}

/** 当前立绘是否已就绪 */
const isImageReady = computed(() => {
  const url = currentExpressionImage.value
  return url != null && preloadedImages.value.has(url)
})

// ── 打字机效果 ──

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
    if (typeTimer) clearInterval(typeTimer)
    displayedText.value = currentStep.value?.text ?? ''
    isTypingDone.value = true
    return
  }
  if (currentStep.value?.choices) return
  advance()
}

/** 前进一步 */
function advance() {
  if (currentIndex.value < props.steps.length - 1) {
    currentIndex.value++
    startTyping()
  } else {
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
      preloadOnboardingImages()
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
        :class="[
          'fixed inset-0 z-[10000] flex flex-col items-center justify-end p-12 transition-all duration-[600ms] pointer-events-none',
          isAppearing ? 'opacity-100' : 'opacity-0',
          hasSpotlight ? 'bg-transparent' : 'bg-black/40 backdrop-blur-[12px]',
        ]"
        @click.self="handleNext"
      >
        <!-- 聚光灯 -->
        <SpotlightMask :selector="currentStep?.focusSelector ?? null" />

        <!-- Pero 的 2D 立绘 (还原 v1) -->
        <div
          v-if="currentStep?.expression !== 'none'"
          :class="[
            'absolute bottom-0 left-1/2 z-10 transition-all duration-1000 ease-out',
            isAppearing
              ? '-translate-x-1/2 translate-y-0 opacity-100'
              : '-translate-x-1/2 translate-y-10 opacity-0',
          ]"
        >
          <div class="relative group">
            <!-- 发光效果 -->
            <div class="absolute inset-0 bg-sky-400/15 blur-[120px] rounded-full onb-glow-pulse" />

            <!-- 立绘容器 -->
            <div class="w-[500px] h-[700px] flex items-end justify-center relative">
              <!-- 立绘图片 (带淡入淡出) -->
              <Transition name="fade">
                <img
                  v-if="isImageReady"
                  :key="currentExpressionImage!"
                  :src="currentExpressionImage!"
                  :alt="currentExpressionLabel"
                  class="max-w-full max-h-full object-contain z-10 drop-shadow-[0_20px_50px_rgba(14,165,233,0.3)]"
                />
              </Transition>

              <!-- 占位符 (立绘未加载) -->
              <div
                v-if="!isImageReady"
                class="w-[450px] h-[650px] flex items-center justify-center border-2 border-sky-400 bg-white/5 backdrop-blur-[20px] relative overflow-hidden"
              >
                <div class="flex flex-col items-center gap-8 onb-float">
                  <div
                    class="p-10 bg-white/10 border-2 border-sky-400 text-sky-400 shadow-[8px_8px_0_0_rgba(14,165,233,0.2)]"
                  >
                    <PixelIcon :name="currentExpressionIcon" size="3xl" />
                  </div>
                  <div
                    class="px-8 py-3 bg-white border-2 border-sky-400 text-sky-400 font-black text-2xl shadow-[8px_8px_0_0_rgba(14,165,233,0.2)]"
                  >
                    {{ currentExpressionLabel }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 对话框 -->
        <div
          :class="[
            'w-full max-w-[800px] p-10 bg-white border-2 border-sky-500 shadow-[0_30px_60px_rgba(14,165,233,0.15)] relative z-20 cursor-pointer pointer-events-auto transition-all duration-500',
            isAppearing ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0',
          ]"
          @click="handleNext"
        >
          <!-- 名称标签 -->
          <div
            class="absolute -top-5 left-6 px-6 py-2 bg-sky-500 text-white font-black text-base tracking-[0.15em] border-2 border-sky-600"
          >
            {{ currentStep?.speaker ?? 'Pero' }}
          </div>

          <!-- 文本 -->
          <div class="text-lg font-bold text-slate-800 leading-[1.8] min-h-[80px]">
            <span>{{ displayedText }}</span>
            <span v-if="isTypingDone" class="inline-block ml-2 text-sky-300 onb-bounce">▼</span>
          </div>

          <!-- 选择按钮 -->
          <div v-if="currentStep?.choices && isTypingDone" class="flex gap-4 mt-6">
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
          <div
            v-if="!currentStep?.choices && isTypingDone"
            class="absolute bottom-4 right-6 text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em] onb-hint-pulse"
          >
            点击此处继续喵...
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 过渡动画 */
.onb-fade-enter-active,
.onb-fade-leave-active {
  transition: opacity 0.5s;
}

.onb-fade-enter-from,
.onb-fade-leave-to {
  opacity: 0;
}

/* 立绘淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 关键帧动画 — Tailwind 无法表达 */
@keyframes onb-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(4px);
  }
}

.onb-bounce {
  animation: onb-bounce 1s infinite;
}

@keyframes onb-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.onb-hint-pulse {
  animation: onb-pulse 2s infinite;
}

.onb-glow-pulse {
  animation: onb-pulse 3s ease-in-out infinite;
}

@keyframes onb-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

.onb-float {
  animation: onb-float 3s ease-in-out infinite;
}
</style>
