<script setup lang="ts">
import { getDisplayLocale } from '../../i18n/index'

import { t as __t } from '../../i18n/index'

import './task-pixel.css'
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
import TaskLifecyclePanel from './TaskLifecyclePanel.vue'
import DesktopControlStatus from '../desktop/DesktopControlStatus.vue'
import ConversationSurface from '../compositor/ConversationSurface.vue'
import type { BackgroundTaskInfo } from '../../api/modules/backgroundTasksApi'
import { backgroundTasksApi } from '../../api/modules/backgroundTasksApi'
import { computed, ref, watch } from 'vue'
import { useCompositorStore } from '../../stores'

const props = defineProps<{
  task: BackgroundTaskInfo | null
  /** Agent 头像 URL（可选） */
  avatarUrl?: string | null
  /** Agent 显示名（可选） */
  agentName?: string | null
}>()

const compositor = useCompositorStore()
const triggerLabel = computed(() => {
  const labels: Record<string, string> = {
    get follow_up() {
      return __t('ui.taskCenter', '到期跟进')
    },
    get agent_task() {
      return __t('ui.taskCenter', '定时计划')
    },
    get accepted_suggestion() {
      return __t('ui.taskCenter', '你采纳的建议')
    },
  }
  return labels[String(props.task?.metadata?.trigger ?? '')] ?? ''
})
const triggerReason = computed(() =>
  typeof props.task?.metadata?.reason === 'string' ? props.task.metadata.reason : '',
)
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
  updated: []
}>()

const projectionError = ref('')
const projectionLoading = ref(false)
const projectionRetry = ref(0)
function partitionSurfaces(interactive: boolean): CompositorSurface[] {
  return (projection.value?.surfaces ?? [])
    .map((surface) => ({
      ...surface,
      nodes: surface.nodes.filter(
        (node) => ['input', 'approval'].includes(node.kind) === interactive,
      ),
    }))
    .filter((surface) => surface.nodes.length > 0)
}
const interactionSurfaces = computed(() => partitionSurfaces(true))
const contentSurfaces = computed(() => partitionSurfaces(false))

function waitReasonLabel(reason?: KernelExecutionWaitReason): string {
  const labels: Record<string, string> = {
    get scheduler_capacity() {
      return __t('ui.taskCenter', '等待系统执行容量')
    },
    get class_capacity() {
      return __t('ui.taskCenter', '等待同类任务容量')
    },
    get resource_locked() {
      return __t('ui.taskCenter', '等待Agent资源释放')
    },
    get backpressure() {
      return __t('ui.taskCenter', '系统负载保护')
    },
    get io() {
      return __t('ui.taskCenter', '等待I/O')
    },
    get approval() {
      return __t('ui.taskCenter', '等待批准')
    },
    get paused() {
      return __t('ui.taskCenter', '已暂停')
    },
  }
  return reason ? (labels[reason] ?? reason) : '—'
}

/** 格式化时间 */
function fmt(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso.replace(' ', 'T'))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toLocaleTimeString(getDisplayLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

watch(
  () => [props.task?.id, props.task?.updatedAt, projectionRetry.value] as const,
  async ([taskId], previous, onCleanup) => {
    let active = true
    onCleanup(() => {
      active = false
    })
    const previousTaskId = previous?.[0]
    if (previousTaskId && previousTaskId !== taskId)
      compositor.disposeScope(`background-task:${previousTaskId}`)
    if (!taskId) return
    projectionError.value = ''
    projectionLoading.value = true
    try {
      const response = await backgroundTasksApi.projection(taskId)
      if (active && response.data)
        compositor.replaceScope(`background-task:${taskId}`, response.data.surfaces)
    } catch (error) {
      if (active)
        projectionError.value = error instanceof Error ? error.message : '任务内容暂时无法读取'
    } finally {
      if (active) projectionLoading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <PDialog
    v-if="task"
    :model-value="true"
    :title="__t('ui.taskCenter', '任务详情')"
    width="min(600px, calc(100vw - 32px))"
    mode="confirm"
    :confirm-text="__t('ui.taskCenter', '关闭')"
    @update:model-value="emit('close')"
    @confirm="emit('close')"
    @cancel="emit('close')"
  >
    <div class="task-detail task-pixel-surface">
      <DesktopControlStatus :task-id="task.id" />
      <p
        v-if="projectionLoading && !projection?.surfaces.length"
        class="detail-projection-status"
        role="status"
      >
        {{ __t('ui.taskCenter', '正在读取任务内容…') }}
      </p>
      <div v-if="projectionError" class="detail-projection-error" role="alert">
        <span>{{ projectionError }}</span>
        <PButton variant="ghost" size="sm" @click="projectionRetry++">
          {{ __t('ui.taskCenter', '重试') }}
        </PButton>
      </div>
      <!-- 待答与批准统一由 Surface 承载，放在详情顶部；下方正文不再重复渲染。 -->
      <div v-if="interactionSurfaces.length" class="detail-section task-surfaces">
        <ConversationSurface
          v-for="surface in interactionSurfaces"
          :key="surface.surfaceId"
          :surface="surface"
        />
      </div>
      <p v-if="task.category === 'resident'" class="detail-projection-status">
        {{ __t('ui.taskCenter', '系统常驻状态随服务自动维护，无需手动恢复或派发。') }}
      </p>
      <TaskLifecyclePanel v-else :task="task" @updated="emit('updated')" />
      <!-- 基本信息 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="book" size="xs" />
          {{ __t('ui.taskCenter', '基本信息') }}
        </h4>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '标题') }}</span>
          <span class="detail-value">{{ task.title }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '执行者') }}</span>
          <span class="detail-value">{{ agentName ?? task.agentId }}</span>
        </div>
        <div v-if="triggerLabel" class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '触发来源') }}</span>
          <span class="detail-value">{{ triggerLabel }}</span>
        </div>
        <div v-if="triggerReason" class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '触发原因') }}</span>
          <span class="detail-value">{{ triggerReason }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '状态') }}</span>
          <span class="detail-value"><TaskStatusBadge :status="task.status" /></span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '当前阶段') }}</span>
          <span class="detail-value">{{ task.currentStage ?? '—' }}</span>
        </div>
      </div>

      <!-- 后台任务与专属 Thread 的全部可见内容统一由 Projection Surface 渲染。 -->
      <div v-if="contentSurfaces.length" class="detail-section task-surfaces">
        <ConversationSurface
          v-for="surface in contentSurfaces"
          :key="surface.surfaceId"
          :surface="surface"
        />
      </div>

      <!-- 时间统计 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="clock" size="xs" />
          {{ __t('ui.taskCenter', '时间') }}
        </h4>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '创建') }}</span>
          <span class="detail-value">{{ fmt(task.createdAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '开始') }}</span>
          <span class="detail-value">{{ fmt(task.startedAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '结束') }}</span>
          <span class="detail-value">{{ fmt(task.completedAt) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '更新') }}</span>
          <span class="detail-value">{{ fmt(task.updatedAt) }}</span>
        </div>
      </div>

      <!-- 执行统计 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="terminal" size="xs" />
          {{ __t('ui.taskCenter', '执行统计') }}
        </h4>
        <div class="detail-row">
          <span class="detail-label">{{ __t('ui.taskCenter', '工具调用') }}</span>
          <span class="detail-value">×{{ task.toolCallCount }}</span>
        </div>
        <template v-if="task.execution">
          <div class="detail-row">
            <span class="detail-label">{{ __t('ui.taskCenter', 'Execution状态') }}</span>
            <span class="detail-value">{{ task.execution.state }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ __t('ui.taskCenter', '等待原因') }}</span>
            <span class="detail-value">{{ waitReasonLabel(task.execution.waitReason) }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">LLM / Tool</span>
            <span class="detail-value">
              {{ task.execution.usage.llmCalls }} / {{ task.execution.usage.toolCalls }}
            </span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ __t('ui.taskCenter', 'Token输入 / 输出') }}</span>
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
      <PButton variant="ghost" size="sm" @click="emit('close')">
        {{ __t('ui.taskCenter', '关闭') }}
      </PButton>
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
  font-family: var(--ui-font-pixel);
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

.detail-projection-status {
  margin: 0;
  color: var(--ui-text-secondary);
  font-size: 12px;
}
.detail-projection-error {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-danger);
  font-size: 12px;
}
.detail-projection-error span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
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
  border-radius: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--ui-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--ui-border-subtle);
  box-shadow: var(--task-inset);
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
  border-radius: 0;
  background: var(--ui-bg-hover);
  overflow: hidden;
  box-shadow: var(--task-inset);
}

.progress-bar {
  height: 100%;
  border-radius: 0;
  background: var(--ui-accent-sky);
  transition: width 0.24s steps(6, end);
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0 6px,
    var(--task-highlight) 6px 8px
  );
}

.progress-text {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 900;
  color: var(--ui-text-tertiary);
}
</style>
