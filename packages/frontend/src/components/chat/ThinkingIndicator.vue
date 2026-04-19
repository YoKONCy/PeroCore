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
  gap: 4px;
  height: 24px;
  padding: 0 4px;
}

.thinking-dot {
  width: 6px;
  height: 6px;
  background: var(--color-blue-400);
  animation: dot-bounce 1s infinite;
}
.thinking-dot-2 { animation-delay: 0.1s; }
.thinking-dot-3 { animation-delay: 0.2s; }

.thinking-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-blue-400);
  margin-left: 8px;
}

@keyframes dot-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
</style>
