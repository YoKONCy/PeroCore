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
import { PButton } from '../pixel'
import PDialog from '../pixel/PDialog.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import TaskStatusBadge from './TaskStatusBadge.vue'
import ToolCallCard from '../tools/ToolCallCard.vue'
import type { BackgroundTaskInfo } from '../../api/modules/backgroundTasksApi'
import { backgroundTasksApi } from '../../api/modules/backgroundTasksApi'
import { computed, ref, watch } from 'vue'
import { ApprovalCard } from '../approval'
import { useApprovalStore } from '../../stores'
import { threadsApi } from '../../api/modules/threadsApi'
import { logger } from '../../lib/logger'

const props = defineProps<{
  task: BackgroundTaskInfo | null
  /** Agent 头像 URL（可选） */
  avatarUrl?: string | null
  /** Agent 显示名（可选） */
  agentName?: string | null
}>()

const approvalStore = useApprovalStore()
const taskApprovals = computed(() =>
  props.task
    ? approvalStore
        .forAgent(props.task.agentId)
        .filter((request) => request.taskId === props.task?.id)
    : [],
)

const emit = defineEmits<{
  close: []
}>()

/** 格式化时间 */
function fmt(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso.replace(' ', 'T'))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
}

// ── 工具轨迹（复用对话轨迹的 ToolCallCard，数据源为任务 Thread 消息的 toolCalls 元数据） ──

const inputMessage = ref('')
const inputSubmitting = ref(false)

async function submitTaskInput(decision: 'allow_once' | 'deny_once'): Promise<void> {
  if (!props.task) return
  inputSubmitting.value = true
  try {
    await backgroundTasksApi.input(props.task.id, {
      decision,
      message: inputMessage.value.trim() || undefined,
    })
    inputMessage.value = ''
  } finally {
    inputSubmitting.value = false
  }
}

interface TrailToolCall {
  name: string
  args: string
  result?: string
  isError?: boolean
  durationMs?: number
}

/** 从消息 metadataJson 解析工具调用轨迹 */
function parseToolCalls(metadataJson: string): TrailToolCall[] {
  try {
    const parsed = JSON.parse(metadataJson) as {
      toolCalls?: Array<{
        name?: unknown
        args?: unknown
        result?: unknown
        durationMs?: unknown
        isError?: unknown
      }>
    }
    if (!Array.isArray(parsed.toolCalls)) return []
    return parsed.toolCalls
      .filter((call) => typeof call.name === 'string')
      .map((call) => ({
        name: call.name as string,
        args: typeof call.args === 'string' ? call.args : JSON.stringify(call.args ?? {}),
        result: typeof call.result === 'string' ? call.result : String(call.result ?? ''),
        isError: typeof call.isError === 'boolean' ? call.isError : undefined,
        durationMs: typeof call.durationMs === 'number' ? call.durationMs : undefined,
      }))
  } catch {
    return []
  }
}

/** 平铺后的任务工具轨迹（按消息顺序） */
const trail = ref<TrailToolCall[]>([])

const rounds = computed(() => {
  const calls = props.task?.checkpoint?.toolCalls ?? trail.value
  return calls.map((call, index) => ({ turn: index + 1, calls: [call] }))
})

/** 任务 Thread 存在且未完成时，拉取消息提取工具轨迹 */
async function loadToolTrail(threadId: string): Promise<void> {
  trail.value = []
  try {
    const detail = (await threadsApi.get(threadId, { pageSize: 50 })).data
    const calls: TrailToolCall[] = []
    for (const msg of detail?.messages ?? []) {
      if (msg.role !== 'assistant' || !msg.metadataJson) continue
      calls.push(...parseToolCalls(msg.metadataJson))
    }
    trail.value = calls
  } catch (error) {
    logger.warn('TaskDetailModal', '拉取任务工具轨迹失败', error)
  }
}

watch(
  () => props.task?.threadId,
  (threadId) => {
    if (threadId) void loadToolTrail(threadId)
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

      <!-- 与此任务绑定的工具审批（全局审批状态在任务详情中的投影） -->
      <div v-if="taskApprovals.length" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="shield" size="xs" />
          等待许可
        </h4>
        <ApprovalCard
          v-for="request in taskApprovals"
          :key="request.id"
          :request="request"
          :loading="approvalStore.isResolving[request.id]"
          compact
          @resolve="(decision, message) => approvalStore.resolve(request.id, decision, message)"
        />
      </div>

      <div v-if="task.status === 'waiting_input'" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="chat" size="xs" />
          等待你的决定
        </h4>
        <p class="detail-instruction">
          {{ task.inputQuestion ?? 'Agent 需要你的确认后才能继续。' }}
        </p>
        <textarea
          v-model="inputMessage"
          class="detail-input"
          rows="2"
          maxlength="2000"
          placeholder="附言（可选）：告诉 Agent 批准或拒绝的理由"
        />
        <div class="detail-input-actions">
          <PButton
            variant="danger"
            size="sm"
            :loading="inputSubmitting"
            @click="submitTaskInput('deny_once')"
          >
            拒绝
          </PButton>
          <PButton
            variant="primary"
            size="sm"
            :loading="inputSubmitting"
            @click="submitTaskInput('allow_once')"
          >
            批准并继续
          </PButton>
        </div>
      </div>

      <!-- 指令 -->
      <div class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="edit" size="xs" />
          指令
        </h4>
        <p class="detail-instruction">{{ task.instruction }}</p>
      </div>

      <!-- 进度 -->
      <div v-if="task.progress != null" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="activity" size="xs" />
          进度
        </h4>
        <div class="detail-progress">
          <div class="progress-track">
            <div class="progress-bar" :style="{ width: `${task.progress}%` }"></div>
          </div>
          <span class="progress-text">{{ task.progress }}%</span>
        </div>
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
        <div class="detail-row">
          <span class="detail-label">Thread ID</span>
          <span class="detail-value detail-mono" :title="task.threadId">{{ task.threadId }}</span>
        </div>
      </div>

      <!-- 工具轨迹（按工具 display 元数据格式化渲染，与对话轨迹一致） -->
      <div v-if="trail.length" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="activity" size="xs" />
          工具轨迹
        </h4>
        <div class="trail-list">
          <ToolCallCard v-for="(call, idx) in trail" :key="idx" :tool="call" />
        </div>
      </div>

      <!-- ReAct 轮次时间线：只展示公开阶段、工具调用和结果摘要，不展示隐藏思维链。 -->
      <div v-if="rounds.length" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="activity" size="xs" />
          ReAct 轮次
        </h4>
        <div v-for="round in rounds" :key="round.turn" class="react-round">
          <strong>第 {{ round.turn }} 轮</strong>
          <ToolCallCard
            v-for="call in round.calls"
            :key="`${round.turn}-${call.name}`"
            :tool="{
              ...call,
              args: typeof call.args === 'string' ? call.args : JSON.stringify(call.args),
            }"
          />
        </div>
      </div>

      <!-- 结果 / 错误 -->
      <div v-if="task.result" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="check" size="xs" />
          结果
        </h4>
        <p class="detail-result">{{ task.result }}</p>
      </div>

      <div v-if="task.errorMessage" class="detail-section">
        <h4 class="detail-title">
          <PixelIcon name="alert" size="xs" />
          错误信息
        </h4>
        <p class="detail-error">{{ task.errorMessage }}</p>
      </div>

      <!-- 待补时间点（篇后 4 使能） -->
      <!-- 后续实装：
        <TaskTimeline :task-id="task.id" … 展示 ReAct 组数时间线 -->
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
