<script setup lang="ts">
/**
 * TaskToast — 任务中心专属单条 toast
 *
 * 依赖全局 .pixel-border-moe 工具类与 --color-moe-* 令牌，
 * 渲染一条独立的 toast 卡片（容器由外部管理）。
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { TaskToastItem } from './index'

interface Props {
  toast: TaskToastItem
  onDismiss: (id: string) => void
}

const props = defineProps<Props>()

// ── 自动消失计时 ──
// progress 类常驻（直到外部 dismiss），其余类型默认 5s 自动关闭
const AUTO_DISMISS_MS = 5000
const timer = ref<ReturnType<typeof setTimeout> | null>(null)

// 悬停时暂停计时
const isHovered = ref(false)

/** 是否为常驻类型（task_progress / task_approval_requested 均不自动消失） */
const isPersistent = computed(() => {
  return props.toast.type === 'task_progress' || props.toast.type === 'task_approval_requested'
})

function startTimer() {
  if (isPersistent.value) return
  stopTimer()
  timer.value = setTimeout(() => {
    props.onDismiss(props.toast.id)
  }, AUTO_DISMISS_MS)
}

function stopTimer() {
  if (timer.value !== null) {
    clearTimeout(timer.value)
    timer.value = null
  }
}

function onMouseEnter() {
  isHovered.value = true
  stopTimer()
}

function onMouseLeave() {
  isHovered.value = false
  startTimer()
}

onMounted(() => startTimer())
onBeforeUnmount(() => stopTimer())

// ── 类型 → 色彩映射 ──
// 使用 --color-moe-* 与 --color-{语义}-face 覆盖，保持视觉语言一致
const typeClass = computed(() => `task-toast--${props.toast.type}`)

// ── 进度条 ──
const showProgress = computed(
  () => props.toast.progress !== null && props.toast.progress !== undefined,
)
const progressValue = computed(() => Math.min(100, Math.max(0, props.toast.progress ?? 0)))

function onClose() {
  props.onDismiss(props.toast.id)
}
</script>

<template>
  <div
    :class="['task-toast', 'pixel-border-moe', typeClass]"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <!-- 角色头像 -->
    <img
      v-if="toast.avatarUrl"
      :src="toast.avatarUrl"
      :alt="toast.actorName ?? 'agent'"
      class="task-toast__avatar"
    />

    <!-- 文字区 -->
    <div class="task-toast__body">
      <!-- actorName 存在时显示在标题前 -->
      <div class="task-toast__title-row">
        <span v-if="toast.actorName" class="task-toast__actor">{{ toast.actorName }}</span>
        <span class="task-toast__title">{{ toast.title }}</span>
      </div>
      <div class="task-toast__message">{{ toast.message }}</div>

      <!-- 进度条 -->
      <div v-if="showProgress" class="task-toast__progress-track">
        <div class="task-toast__progress-bar" :style="{ width: `${progressValue}%` }" />
      </div>
    </div>

    <!-- 关闭按钮 -->
    <button class="task-toast__close" @click="onClose">×</button>
  </div>
</template>

<style scoped>
.task-toast {
  /* ---- 基础布局 ---- */
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 320px;
  padding: 12px 32px 12px 12px; /* 右侧留位给关闭按钮 */
  position: relative;

  /* ---- 毛玻璃 + 背景 ---- */
  background: var(--color-moe-card-bg, rgba(255, 255, 255, 0.85));
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);

  /* ---- 圆角（pixel-border-moe 提供 2px 像素边框阴影，圆角设极小避免冲突） ---- */
  border-radius: 4px;

  /* ---- 柔和阴影 ---- */
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    inset -2px -2px 0 0 rgba(0, 0, 0, 0.06),
    inset 2px 2px 0 0 rgba(255, 255, 255, 0.35),
    0 4px 16px rgba(45, 27, 30, 0.12);

  user-select: none;
}

/* ── 类型主题着色：通过左侧色条区分 ── */

.task-toast::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  border-radius: 4px 0 0 4px;
}

/* task_started — 天蓝 */
.task-toast--task_started::before {
  background: var(--color-sky-face, #38bdf8);
}

/* task_progress — 主强调色（moe pink） */
.task-toast--task_progress::before {
  background: var(--color-moe-pink, #f9a8d4);
}

/* task_approval_requested — 粉橙高亮 */
.task-toast--task_approval_requested::before {
  background: linear-gradient(
    180deg,
    var(--color-moe-pink, #f9a8d4),
    var(--color-orange-face, #fb923c)
  );
}

/* task_completed — 翠绿 */
.task-toast--task_completed::before {
  background: var(--color-emerald-face, #10b981);
}

/* task_failed — 红 */
.task-toast--task_failed::before {
  background: var(--color-red-face, #ef4444);
}

/* info — 中性灰蓝 */
.task-toast--info::before {
  background: var(--color-moe-sky, #a7d8f0);
}

/* ── 头像 ── */
.task-toast__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
  /* 与 moe cocoa 边框呼应的像素环 */
  box-shadow: 0 0 0 2px var(--color-moe-cocoa, #2d1b1e);
}

/* ── 文字区 ── */
.task-toast__body {
  flex: 1;
  min-width: 0;
}

.task-toast__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.task-toast__actor {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-moe-cocoa, #2d1b1e);
  background: var(--color-moe-pink, #f9a8d4);
  padding: 1px 5px;
  border-radius: 3px;
  line-height: 1.2;
  flex-shrink: 0;
}

.task-toast__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-moe-cocoa, #2d1b1e);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-toast__message {
  font-size: 12px;
  color: var(--color-moe-cocoa, #2d1b1e);
  opacity: 0.75;
  line-height: 1.5;
  word-break: break-word;
}

/* ── 进度条 ── */
.task-toast__progress-track {
  margin-top: 8px;
  height: 5px;
  border-radius: 999px;
  background: rgba(45, 27, 30, 0.08);
  overflow: hidden;
}

.task-toast__progress-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--color-moe-pink, #f9a8d4);
  transition: width 0.3s ease;
  /* 微光泽 */
  box-shadow: 0 0 4px rgba(249, 168, 212, 0.5);
}

/* ── 关闭按钮 ── */
.task-toast__close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  color: var(--color-moe-cocoa, #2d1b1e);
  opacity: 0.45;
  border-radius: 3px;
  transition:
    opacity 0.15s,
    background-color 0.15s;
}

.task-toast__close:hover {
  opacity: 1;
  background: rgba(45, 27, 30, 0.08);
}
</style>
