<script setup lang="ts">
/**
 * TaskDetailModal — 任务详情弹窗（M05 §7.4）
 *
 * 处于 M05 基础版：以系统消息对话框展示任务概览（基本信息 + 阶段 + 结果/错误 + 关联 Thread 元信息 + 工具调用统计）。
 * 阶段 4（实时进度推送）后升级为 ReAct 组数时间线。
 *
 * @props task — 任务信息；为 null 时不渲染
 * @emits close
 */
import type { BackgroundTaskProjectionSnapshot, KernelExecutionWaitReason } from '@infos/shared'
import type { CompositorSurface } from '../../stores'
import { PButton } from '../pixel'
import PDialog from '../pixel/PDialog.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import TaskStatusBadge from './TaskStatusBadge.vue'
import ConversationSurface from '../compositor/ConversationSurface.vue'
import type { BackgroundTaskInfo } from '../../api/modules/backgroundTasksApi'
import { backgroundTasksApi } from '../../api/modules/backgroundTasksApi'
import { computed, watch } from 'vue'
import { useCompositorStore } from '../../stores'

const props = defineProps<{
  task: BackgroundTaskInfo | null
  /** Agent 头像 URL（可选） */
  avatarUrl?: string | null
  /** Agent 显示名（可选） */
  agentName?: string | null
}>()

const compositor = useCompositorStore()
const projection = computed<
  (Omit<BackgroundTaskProjectionSnapshot, 'surfaces'> & { surfaces: CompositorSurface[] }) | null
>(() =>
  props.task
    ? {
        protocolVersion: 1,
        taskId: props.task.id,
        threadId: props.task.threadId,
        principalId: props.task.agentId,
        revision: 0,
        generatedAt: '',
        surfaces: [...compositor.surfaces.values()].filter(
          (surface) => surface.scopeId === `background-task:${props.task?.id}`,
        ),
      }
    : null,
)

const emit = defineEmits<{
  close: []
}>()

function waitReasonLabel(reason?: KernelExecutionWaitReason): string {
  const labels: Record<string, string> = {
    scheduler_capacity: '等待系统执行容量',
    class_capacity: '等待同类任务容量',
    resource_locked: '等待Agent资源释放',
    backpressure: '系统负载保护',
    io: '等待I/O',
    approval: '等待批准',
    paused: '已暂停',
  }
  return reason ? (labels[reason] ?? reason) : '—'
}

/** 格式化时间 */
function fmt(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso.replace(' ', 'T'))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

watch(
  () => [props.task?.id, props.task?.updatedAt] as const,
  async ([taskId], previous) => {
    const previousTaskId = previous?.[0]
    if (previousTaskId) compositor.disposeScope(`background-task:${previousTaskId}`)
    if (!taskId) return
    const response = await backgroundTasksApi.projection(taskId)
    if (response.data) {
      compositor.replaceScope(`background-task:${taskId}`, response.data.surfaces)
    }
  },
  { immediate: true },
)
</script>

<template>
  <PDialog
    v-if="task"
    :model-value="true"
    title="任务详情"
    mode="confirm"
    :confirm-text="'关闭'"
    @update:model-value="emit('close')"
    @confirm="emit('close')"
    @cancel="emit('close')"
  >
    <div class="task-detail">
      <!-- 基本信息 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="book" size="xs" />
          基本信息
        </h4>
        <div class="detail-row">
          <span class="detail-label">标题</span>
          <span class="detail-value">{{ task.title }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">执行者</span>
          <span class="detail-value">{{ agentName ?? task.agentId }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态</span>
          <span class="detail-value"><TaskStatusBadge :status="task.status" /></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">当前阶段</span>
          <span class="detail-value">{{ task.currentStage ?? '—' }}</span>
        </div>
      </div>

      <!-- 后台任务与专属 Thread 的全部可见内容统一由 Projection Surface 渲染。 -->
      <div v-if="projection?.surfaces.length" class="detail-section task-surfaces">
        <ConversationSurface
          v-for="surface in projection.surfaces"
          :key="surface.surfaceId"
          :surface="surface"
        />
      </div>

      <!-- 时间统计 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="clock" size="xs" />
          时间
        </h4>
        <div class="detail-row">
          <span class="detail-label">创建</span>
          <span class="detail-value">{{ fmt(task.createdAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">开始</span>
          <span class="detail-value">{{ fmt(task.startedAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">结束</span>
          <span class="detail-value">{{ fmt(task.completedAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">更新</span>
          <span class="detail-value">{{ fmt(task.updatedAt) }}</span>
        </div>
      </div>

      <!-- 执行统计 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="terminal" size="xs" />
          执行统计
        </h4>
        <div class="detail-row">
          <span class="detail-label">工具调用</span>
          <span class="detail-value">×{{ task.toolCallCount }}</span>
        </div>
        <template v-if="task.execution">
          <div class="detail-row">
            <span class="detail-label">Execution状态</span>
            <span class="detail-value">{{ task.execution.state }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">等待原因</span>
            <span class="detail-value">{{ waitReasonLabel(task.execution.waitReason) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">LLM / Tool</span>
            <span class="detail-value">
              {{ task.execution.usage.llmCalls }} / {{ task.execution.usage.toolCalls }}
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Token输入 / 输出</span>
            <span class="detail-value">
              {{ task.execution.usage.inputTokens }} / {{ task.execution.usage.outputTokens }}
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Execution ID</span>
            <span class="detail-value detail-mono" :title="task.execution.descriptor.executionId">
              {{ task.execution.descriptor.executionId }}
            </span>
          </div>
        </template>
        <div class="detail-row">
          <span class="detail-label">Thread ID</span>
          <span class="detail-value detail-mono" :title="task.threadId">{{ task.threadId }}</span>
        </div>
      </div>

      <!-- 结果与工具轨迹均已包含在 Projection Surfaces 中。 -->
    </div>

    <!-- 底部操作 -->
    <template #footer>
      <PButton variant="secondary" size="sm" @click="emit('close')">关闭</PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.task-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: min(70vh, 600px);
  overflow-y: auto;
  padding: 2px 2px 0;
  font-family: var(--ui-font-sans);
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px dashed var(--ui-border-subtle);
}

.detail-section:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.detail-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-surface);
  color: var(--ui-text-primary);
}

.detail-input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.react-round {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border-left: 2px solid var(--ui-accent-sky);
}

/* 工具轨迹列表 */
.trail-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  max-height: 320px;
  overflow-y: auto;
}

.detail-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ui-text-secondary);
}

.detail-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ui-text-primary);
}

.detail-label {
  flex-shrink: 0;
  width: 4em;
  color: var(--ui-text-tertiary);
}

.detail-value {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.detail-mono {
  font-family: var(--ui-font-mono);
  font-size: 11px;
  color: var(--ui-text-secondary);
}

/* 指令 / 结果 / 错误 */
.detail-instruction,
.detail-result,
.detail-error {
  margin: 0;
  padding: 10px 12px;
  background: var(--ui-bg-hover);
  border-radius: var(--ui-radius-md);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--ui-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-error {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

/* 进度条 */
.detail-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-track {
  flex: 1;
  height: 6px;
  border-radius: var(--ui-radius-full);
  background: var(--ui-bg-hover);
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent-sky);
  transition: width 0.3s ease;
}

.progress-text {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 900;
  color: rgba(45, 27, 30, 0.48);
}
</style>
