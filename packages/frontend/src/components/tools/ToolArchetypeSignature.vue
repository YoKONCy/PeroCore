<script setup lang="ts">
/**
 * ToolArchetypeSignature.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import type { ToolVisualSignature } from './toolSignatures'

const props = defineProps<{
  signature: ToolVisualSignature
  icon: string
  label: string
  summary: string
  state: 'running' | 'error' | 'ok'
}>()

const variantMark = computed(() =>
  props.signature.variant.split('-').slice(-1)[0]?.slice(0, 2).toUpperCase(),
)
const signatureVars = computed(() => {
  let hash = 0
  for (const char of props.signature.variant) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return {
    '--tas-tilt': `${(hash % 5) - 2}deg`,
    '--tas-shift': `${hash % 4}px`,
    '--tas-delay': `${hash % 420}ms`,
    '--tas-mark-size': `${3 + (hash % 4)}px`,
  }
})
</script>

<template>
  <span
    class="tas"
    :class="[`tas-${signature.archetype}`, `tas-state-${state}`, `tas-motion-${signature.motion}`]"
    :style="signatureVars"
    aria-hidden="true"
  >
    <span class="tas-stage">
      <PixelIcon :name="icon" size="xs" />
      <i class="tas-part tas-part-a" />
      <i class="tas-part tas-part-b" />
      <i class="tas-part tas-part-c" />
    </span>
    <small>{{ variantMark }}</small>
  </span>
</template>

<style scoped>
.tas {
  position: relative;
  display: grid;
  width: 38px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  color: var(--ta-accent);
}
.tas-stage {
  position: relative;
  display: grid;
  width: 25px;
  height: 22px;
  place-items: center;
  background: var(--ta-face-raised);
  filter: drop-shadow(2px 2px 0 var(--ta-shadow));
  transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
  transform: translateX(var(--tas-shift)) rotate(var(--tas-tilt));
}
.tas-stage :deep(.pixel-icon) {
  position: relative;
  z-index: 2;
}
.tas > small {
  position: absolute;
  right: -1px;
  bottom: -1px;
  color: var(--ui-text-muted);
  font:
    6px var(--font-mono),
    monospace;
  opacity: 0.7;
}
.tas-part {
  position: absolute;
  display: block;
  background: var(--ta-accent);
}
.tas-part-a {
  width: var(--tas-mark-size);
  height: var(--tas-mark-size);
  right: -2px;
  top: 3px;
}
.tas-part-b {
  width: 3px;
  height: 3px;
  left: 2px;
  bottom: -2px;
  opacity: 0.55;
}
.tas-part-c {
  display: none;
}

.tas-file-paper .tas-stage {
  clip-path: polygon(0 0, 75% 0, 100% 25%, 100% 100%, 0 100%);
}
.tas-file-paper .tas-part-a {
  width: 7px;
  height: 7px;
  right: 0;
  top: 0;
  background: var(--ta-highlight);
}
.tas-edit-splice .tas-stage {
  clip-path: polygon(
    0 0,
    46% 0,
    46% 18%,
    54% 18%,
    54% 0,
    100% 0,
    100% 100%,
    54% 100%,
    54% 82%,
    46% 82%,
    46% 100%,
    0 100%
  );
}
.tas-search-radar .tas-stage {
  border-radius: 50%;
  background: transparent;
  border: 2px dotted var(--ta-accent);
}
.tas-search-radar .tas-part-a {
  inset: 50% auto auto 50%;
  width: 10px;
  height: 1px;
  transform-origin: left;
}
.tas-terminal-tape .tas-stage {
  width: 29px;
  clip-path: polygon(0 4px, 4px 4px, 4px 0, 100% 0, 100% 18px, 25px 18px, 25px 22px, 0 22px);
}
.tas-terminal-tape .tas-part-a,
.tas-terminal-tape .tas-part-b {
  width: 5px;
  height: 5px;
  top: 8px;
  border-radius: 50%;
  background: var(--ta-edge);
}
.tas-terminal-tape .tas-part-a {
  left: 3px;
}
.tas-terminal-tape .tas-part-b {
  right: 3px;
  left: auto;
  bottom: auto;
}
.tas-browser-space .tas-stage {
  width: 30px;
  clip-path: polygon(0 4px, 4px 4px, 4px 0, 26px 0, 26px 3px, 30px 3px, 30px 22px, 0 22px);
}
.tas-browser-space .tas-part-a {
  width: 22px;
  height: 1px;
  left: 4px;
  top: 5px;
  opacity: 0.4;
}
.tas-vision-frame .tas-stage {
  background: transparent;
  border: 2px solid var(--ta-accent);
  clip-path: polygon(
    0 0,
    35% 0,
    35% 2px,
    65% 2px,
    65% 0,
    100% 0,
    100% 35%,
    98% 35%,
    98% 65%,
    100% 65%,
    100% 100%,
    65% 100%,
    65% 98%,
    35% 98%,
    35% 100%,
    0 100%,
    0 65%,
    2px 65%,
    2px 35%,
    0 35%
  );
}
.tas-desktop-motion .tas-stage {
  transform: perspective(40px) rotateY(-8deg);
  clip-path: polygon(0 3px, 4px 3px, 4px 0, 100% 0, 100% 19px, 21px 19px, 21px 22px, 0 22px);
}
.tas-time-ticket .tas-stage {
  clip-path: polygon(
    0 0,
    100% 0,
    100% 38%,
    92% 50%,
    100% 62%,
    100% 100%,
    0 100%,
    0 62%,
    8% 50%,
    0 38%
  );
}
.tas-stronghold-scene .tas-stage {
  clip-path: polygon(
    0 6px,
    6px 6px,
    6px 2px,
    11px 2px,
    11px 0,
    18px 0,
    18px 3px,
    25px 3px,
    25px 22px,
    0 22px
  );
}
.tas-system-module .tas-stage {
  transform: rotate(45deg) scale(0.78);
  clip-path: polygon(0 5px, 5px 5px, 5px 0, 100% 0, 100% 17px, 17px 17px, 17px 22px, 0 22px);
}
.tas-system-module .tas-stage :deep(.pixel-icon) {
  transform: rotate(-45deg);
}
.tas-web-sheet .tas-stage {
  width: 28px;
  clip-path: polygon(0 0, 100% 0, 100% 18px, 22px 18px, 22px 22px, 0 22px);
}
.tas-script-circuit .tas-stage {
  background: transparent;
  border: 1px solid var(--ta-edge);
}
.tas-script-circuit .tas-part-a {
  width: 8px;
  height: 1px;
  right: -6px;
  top: 5px;
  box-shadow:
    0 6px 0 var(--ta-accent),
    0 12px 0 var(--ta-accent);
}
.tas-social-signal .tas-stage {
  border-radius: 10px 10px 10px 2px;
}

.tas-state-running .tas-stage {
  animation: tas-bob 1.15s steps(6, end) infinite;
  animation-delay: var(--tas-delay);
}
.tas-state-running.tas-search-radar .tas-part-a {
  animation: tas-scan 1s linear infinite;
}
.tas-state-running.tas-browser-space .tas-part-b {
  animation: tas-blink 0.8s steps(1, end) infinite;
}
.tas-state-error .tas-stage {
  transform: rotate(-4deg);
  filter: drop-shadow(2px 2px 0 var(--ui-danger));
}
.tas-state-error .tas-part-a {
  background: var(--ui-danger);
}

@keyframes tas-bob {
  50% {
    transform: translateY(-2px) rotate(1deg);
  }
}
@keyframes tas-scan {
  to {
    transform: rotate(360deg);
  }
}
@keyframes tas-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tas-stage,
  .tas-part {
    animation: none !important;
    transition: none !important;
  }
}
</style>
