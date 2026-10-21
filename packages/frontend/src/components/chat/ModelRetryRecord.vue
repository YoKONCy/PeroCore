<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed } from 'vue'
import type { ModelRetrySurfaceProps } from '@infos/shared'

const props = defineProps<{ record: ModelRetrySurfaceProps; active: boolean }>()
const moving = computed(() => props.active && ['waiting', 'retrying'].includes(props.record.state))
// 回连只结束动画；原始提示、原因、次数和等待时长始终保持不变。
const delayText = computed(() =>
  __t('ui.chat', '{0} 秒后重试', [(props.record.delayMs / 1000).toFixed(1)]),
)
</script>

<template>
  <div
    class="model-retry"
    :class="{ 'model-retry--moving': moving }"
    :data-retry-id="record.retryId"
    role="note"
  >
    <svg class="model-retry__motion" viewBox="0 0 48 28" fill="none" aria-hidden="true">
      <path
        class="model-retry__wire model-retry__wire--left"
        d="M2 14h8m0-5h6v10h-6zM16 11h5m-5 6h5"
      />
      <path
        class="model-retry__wire model-retry__wire--right"
        d="M46 14h-8m0-5h-6v10h6zM32 11h-5m5 6h-5"
      />
      <path class="model-retry__spark" d="m25 3-3 6h4l-3 6" />
      <circle class="model-retry__dot" cx="24" cy="23" r="1.2" fill="currentColor" stroke="none" />
    </svg>
    <div class="model-retry__body">
      <div class="model-retry__heading">
        <span>
          {{
            record.modelLevel && record.modelLevel > 1 && record.modelAttempt === 1
              ? __t('ui.chat', '上游连接异常，切换回退模型')
              : __t('ui.chat', '上游连接异常，正在重试')
          }}
        </span>
        <b>{{ record.attempt }}/{{ record.maxRetries }}</b>
        <small>{{ delayText }}</small>
        <small v-if="record.modelId">
          {{ record.modelId }} {{ __t('ui.chat', '· 第') }} {{ record.modelLevel }}/{{
            record.modelLevels
          }}
          {{ __t('ui.chat', '级 · 尝试') }} {{ record.modelAttempt }}/2
        </small>
      </div>
      <p class="model-retry__reason">{{ record.reason }}</p>
    </div>
  </div>
</template>

<style scoped>
.model-retry {
  display: flex;
  align-items: center;
  gap: 9px;
  width: fit-content;
  max-width: 100%;
  margin: 10px 0;
  padding: 8px 12px 8px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 28%, var(--ui-border-default));
  border-left: 2px solid var(--ui-accent-purple);
  border-radius: 3px;
  background: color-mix(in srgb, var(--ui-accent-purple-soft) 28%, var(--ui-bg-elevated));
  color: var(--ui-text-primary);
}
.model-retry__motion {
  flex: 0 0 42px;
  width: 42px;
  height: 28px;
  color: var(--ui-accent-purple);
}
.model-retry__wire,
.model-retry__spark {
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.model-retry__body {
  min-width: 0;
}
.model-retry__heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 12px;
}
.model-retry__heading b {
  color: var(--ui-accent-purple);
  font-variant-numeric: tabular-nums;
}
.model-retry__heading small {
  font-size: 10px;
  color: var(--ui-text-muted);
}
.model-retry__reason {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ui-text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.model-retry--moving .model-retry__wire--left {
  animation: retry-link-left 1.6s ease-in-out infinite;
}
.model-retry--moving .model-retry__wire--right {
  animation: retry-link-right 1.6s ease-in-out infinite;
}
.model-retry--moving .model-retry__spark,
.model-retry--moving .model-retry__dot {
  animation: retry-link-pulse 1.6s ease-in-out infinite;
}
@keyframes retry-link-left {
  50% {
    transform: translateX(3px);
  }
}
@keyframes retry-link-right {
  50% {
    transform: translateX(-3px);
  }
}
@keyframes retry-link-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .model-retry--moving * {
    animation: none !important;
  }
}
</style>
