<script setup lang="ts">
import './task-pixel.css'
/**
 * TaskToast — 任务中心专属单条 toast
 *
 * 使用任务界面的像素材质与双主题语义令牌，
 * 渲染一条独立的 toast 卡片（容器由外部管理）。
 */
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { TaskToastItem } from './index'

interface Props {
  toast: TaskToastItem
  onDismiss: (id: string) => void
  autoDismiss?: boolean
  paused?: boolean
}

const props = withDefaults(defineProps<Props>(), { autoDismiss: true, paused: false })
const emit = defineEmits<{ hover: [id: string, hovered: boolean] }>()

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
  stopTimer()
  if (isPersistent.value || !props.autoDismiss || props.paused || isHovered.value) return
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
  emit('hover', props.toast.id, true)
}

function onMouseLeave() {
  isHovered.value = false
  emit('hover', props.toast.id, false)
  startTimer()
}

onMounted(() => startTimer())
watch([isPersistent, () => props.autoDismiss, () => props.paused], startTimer)
onBeforeUnmount(() => {
  stopTimer()
  if (isHovered.value) emit('hover', props.toast.id, false)
})

// ── 类型 → 色彩映射 ──
// 使用双主题语义色区分任务状态
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
    :class="['task-toast', 'task-pixel-surface', typeClass]"
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
  background: var(--task-fill);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);

  /* ---- 细边框与硬边厚度 ---- */
  border-radius: 0;

  box-shadow: var(--task-raised);

  user-select: none;

  border: 1px solid var(--ui-border-default);

  font-family: var(--ui-font-pixel);

  color: var(--ui-text-primary);

  box-sizing: border-box;

  max-width: calc(100vw - 32px);
}

/* ── 类型主题着色：通过左侧色条区分 ── */

.task-toast::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  border-radius: 0;
}

/* task_started — 天蓝 */
.task-toast--task_started::before {
  background: var(--ui-accent-sky);
}

/* task_progress — 主强调色 */
.task-toast--task_progress::before {
  background: var(--ui-accent-primary);
}

/* task_approval_requested — 待确认高亮 */
.task-toast--task_approval_requested::before {
  background: var(--ui-warning);
}

/* task_completed — 翠绿 */
.task-toast--task_completed::before {
  background: var(--ui-success);
}

/* task_failed — 红 */
.task-toast--task_failed::before {
  background: var(--ui-danger);
}

/* info — 中性灰蓝 */
.task-toast--info::before {
  background: var(--ui-accent-sky);
}

/* ── 头像 ── */
.task-toast__avatar {
  width: 32px;
  height: 32px;
  border-radius: 0;
  flex-shrink: 0;
  object-fit: cover;
  /* 头像框与卡片使用同一像素材质 */
  box-shadow: var(--task-control);
  border: 1px solid var(--ui-border-default);
  padding: 2px;
  background: var(--task-fill);
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
  color: var(--ui-accent-primary);
  background: var(--ui-accent-primary-soft);
  padding: 1px 5px;
  border-radius: 0;
  line-height: 1.2;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--ui-accent-primary) 30%, transparent);
}

.task-toast__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-toast__message {
  font-size: 12px;
  color: var(--ui-text-secondary);
  opacity: 1;
  line-height: 1.5;
  word-break: break-word;
}

/* ── 进度条 ── */
.task-toast__progress-track {
  margin-top: 8px;
  height: 5px;
  border-radius: 0;
  background: var(--ui-bg-hover);
  overflow: hidden;
  box-shadow: var(--task-inset);
}

.task-toast__progress-bar {
  height: 100%;
  border-radius: 0;
  background: var(--ui-accent-primary);
  transition: width 0.24s steps(6, end);
  /* 微光泽 */
  box-shadow: inset 0 1px 0 var(--task-highlight);
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0 6px,
    var(--task-highlight) 6px 8px
  );
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
  color: var(--ui-text-tertiary);
  opacity: 0.45;
  border-radius: 0;
  transition:
    opacity 0.15s,
    background-color 0.15s;
}

.task-toast__close:hover {
  opacity: 1;
  background: var(--ui-bg-hover);
}
</style>
