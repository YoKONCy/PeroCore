<script setup lang="ts">
/**
 * ThinkingIndicator — 思考中动画指示器
 *
 * AI 正在生成内容时显示的弹跳圆点 + 文字提示。
 */

interface Props {
  /** 显示的名称 */
  name?: string
}

withDefaults(defineProps<Props>(), {
  name: 'Pero',
})
</script>

<template>
  <div class="flex items-center gap-1 h-6 px-1">
    <span class="w-1.5 h-1.5 bg-sky-300 think-dot" />
    <span class="w-1.5 h-1.5 bg-sky-300 think-dot think-dot-2" />
    <span class="w-1.5 h-1.5 bg-sky-300 think-dot think-dot-3" />
    <span class="text-xs font-bold text-sky-300 ml-2">{{ name }} 正在思考...</span>
  </div>
</template>

<style scoped>
@keyframes think-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

.think-dot {
  animation: think-bounce 1s infinite;
}
.think-dot-2 {
  animation-delay: 0.1s;
}
.think-dot-3 {
  animation-delay: 0.2s;
}
</style>
