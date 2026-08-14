<script setup lang="ts">
/**
 * AgentWorkBadge — 角色工作状态徽章（M05-B1）
 *
 * 常驻聊天区顶部，实时显示当前角色的后台任务状态：
 * - 有进行中任务时显示 "后台任务进行中 ×N"，轻量脉冲动效
 * - 点击跳转任务中心（待办提醒 Tab）
 *
 * 数据源（M05 篇2-4）：taskCenterStore，由 Gateway 事件实时维护；
 * REST refreshActive 作为兜底（挂载时已在 MainView 首次拉取）。
 *
 * @props agentId - 当前对话 Agent ID
 */
import { computed } from 'vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import { useTaskCenterStore } from '../../stores/taskCenterStore'
import { useMainNav } from '../../composables/main/useMainNav'

const props = defineProps<{
  /** 当前对话 Agent ID */
  agentId: string
}>()

const taskCenter = useTaskCenterStore()
const { setTab } = useMainNav()

/** 当前角色的活跃任务数（Gateway 实时驱动） */
const activeCount = computed(() => taskCenter.activeCountOf(props.agentId))

/** 点击跳转任务中心 */
function goTaskCenter() {
  setTab('tasks')
}

/** 徽章可见性：有活跃任务才显示，平时完全隐藏不占位 */
const visible = computed(() => activeCount.value > 0)
</script>

<template>
  <Transition name="badge-fade">
    <button
      v-if="visible"
      class="agent-work-badge pixel-border-moe"
      type="button"
      title="查看任务中心"
      @click="goTaskCenter"
    >
      <span class="badge-dot" aria-hidden="true"></span>
      <PixelIcon name="activity" size="xs" />
      <span class="badge-text">后台任务进行中 ×{{ activeCount }}</span>
      <PixelIcon name="chevron-right" size="xs" />
    </button>
  </Transition>
</template>

<style scoped>
.agent-work-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  cursor: pointer;
  background: rgba(255, 252, 249, 0.86);
  backdrop-filter: blur(6px);
  color: var(--color-moe-cocoa);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.02em;
  transition:
    transform 0.16s ease,
    background 0.16s ease;
}

.agent-work-badge:hover {
  background: rgba(249, 168, 212, 0.16);
  transform: translateY(-1px);
}

.badge-text {
  white-space: nowrap;
}

/* 状态点：天蓝脉冲，呼应任务运行中的呼吸感 */
.badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-moe-sky, #7dd3fc);
  animation: badge-pulse 1.6s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%,
  100% {
    opacity: 1;
    box-shadow: 0 0 0 0 rgba(125, 211, 252, 0.5);
  }
  50% {
    opacity: 0.6;
    box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.12);
  }
}

.badge-fade-enter-active,
.badge-fade-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.badge-fade-enter-from,
.badge-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
