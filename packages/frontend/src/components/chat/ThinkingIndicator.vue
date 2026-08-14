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
  name: '助手',
})
</script>

<template>
  <div class="thinking-indicator">
    <span class="thinking-dot" />
    <span class="thinking-dot thinking-dot-2" />
    <span class="thinking-dot thinking-dot-3" />
    <span class="thinking-text">{{ name }} 正在思考...</span>
  </div>
</template>

<style scoped>
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 4px;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  background: var(--color-moe-pink);
  animation: think-bounce 1s infinite;
}

.thinking-text {
  margin-left: 6px;
  color: var(--color-moe-pink);
  font-size: 12px;
  font-weight: 900;
}

@keyframes think-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-4px);
  }
}

.thinking-dot-2 {
  animation-delay: 0.1s;
}
.thinking-dot-3 {
  animation-delay: 0.2s;
}
</style>
