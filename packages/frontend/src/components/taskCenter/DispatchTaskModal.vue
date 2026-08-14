<script setup lang="ts">
/**
 * DispatchTaskModal — 派发新任务弹窗（M05 §7.3）
 *
 * 选择执行 Agent + 输入任务标题/指令/工作目录 + 完成后行为。
 * 不要求先切换前台角色，可跨 Agent 派发（Pero 前台时派给 Nana 后台）。
 *
 * 视觉：soft-UI 表单，全套 ui 语义令牌（双主题安全）。
 *
 * @props show / 由父级控制显隐
 * @emits close / dispatched(id: string)
 */
import { ref, computed, watch } from 'vue'
import PDialog from '../pixel/PDialog.vue'
import PButton from '../pixel/PButton.vue'
import PixelIcon from '../pixel/PixelIcon.vue'
import { useTaskCenterStore } from '../../stores/taskCenterStore'
import { useAgentStore } from '../../stores/useAgentStore'
import { logger } from '../../lib/logger'

const props = defineProps<{
  /** 是否显示 */
  show: boolean
  /** 弹窗打开时冻结的原聊天 Thread */
  targetThreadId: string | null
}>()

const emit = defineEmits<{
  close: []
  dispatched: [taskId: string]
}>()

const taskCenter = useTaskCenterStore()
const agentStore = useAgentStore()

/** 表单状态 */
const agentId = ref('')
const title = ref('')
const instruction = ref('')
const completionAction = ref<'notify' | 'open_result' | 'send_to_chat'>('notify')
const isSubmitting = ref(false)
const submitError = ref('')

/** 完成后行为选项（图标 + 文案 + 说明，渲染为可选项卡） */
const COMPLETION_OPTIONS = [
  { value: 'notify', icon: 'bell', label: '任务中心通知', hint: '完成后在任务中心提醒' },
  { value: 'open_result', icon: 'eye', label: '自动打开结果', hint: '完成后直接弹出结果' },
  { value: 'send_to_chat', icon: 'chat', label: '发送到当前对话', hint: '完成后投递到聊天里' },
] as const

/** 初始化默认选中第一个 Agent */
watch(
  () => props.show,
  (show) => {
    if (show) {
      agentId.value = agentId.value || agentStore.activeAgentId || agentStore.agents[0]?.id || ''
      title.value = ''
      instruction.value = ''
      completionAction.value = 'notify'
      submitError.value = ''
    }
  },
)

/** 指令字数（供计数提示） */
const instructionLength = computed(() => instruction.value.length)

/** 可提交判断 */
const canSubmit = computed(
  () =>
    !!agentId.value &&
    instruction.value.trim().length > 0 &&
    (completionAction.value !== 'send_to_chat' || !!props.targetThreadId) &&
    !isSubmitting.value,
)

/** 提交派发 */
async function handleSubmit() {
  if (!canSubmit.value) return
  isSubmitting.value = true
  submitError.value = ''
  try {
    const taskId = await taskCenter.dispatch({
      agentId: agentId.value,
      instruction: instruction.value.trim(),
      title: title.value.trim() || undefined,
      completionAction: completionAction.value,
      ...(completionAction.value === 'send_to_chat' && props.targetThreadId
        ? { targetThreadId: props.targetThreadId }
        : {}),
    })
    if (taskId) {
      emit('dispatched', taskId)
      emit('close')
    } else {
      submitError.value = '派发失败，请稍后重试'
    }
  } catch (err) {
    submitError.value = err instanceof Error ? err.message : '派发失败'
    logger.error('DispatchTaskModal', '派发任务失败', err)
  } finally {
    isSubmitting.value = false
  }
}

/** 关闭 */
function handleClose() {
  emit('close')
}
</script>

<template>
  <PDialog
    :model-value="show"
    title="派发新任务"
    mode="confirm"
    width="480px"
    @update:model-value="handleClose"
    @confirm="handleSubmit"
    @cancel="handleClose"
  >
    <div class="dispatch-form">
      <!-- 执行角色 -->
      <label class="dispatch-field">
        <span class="dispatch-field__label">
          <PixelIcon name="users" size="xs" />
          执行角色
        </span>
        <div class="dispatch-field__control dispatch-field__control--select">
          <select v-model="agentId" class="dispatch-select" :disabled="isSubmitting">
            <option v-for="a in agentStore.agents" :key="a.id" :value="a.id">
              {{ a.name ?? a.id }}
            </option>
          </select>
          <PixelIcon name="chevron-down" size="xs" class="dispatch-field__chevron" />
        </div>
      </label>

      <!-- 任务标题 -->
      <label class="dispatch-field">
        <span class="dispatch-field__label">
          <PixelIcon name="edit" size="xs" />
          任务标题
          <span class="dispatch-field__optional">选填</span>
        </span>
        <input
          v-model="title"
          class="dispatch-input"
          type="text"
          maxlength="64"
          placeholder="例：整理本周会议记录"
          :disabled="isSubmitting"
        />
      </label>

      <!-- 任务指令 -->
      <label class="dispatch-field">
        <span class="dispatch-field__label">
          <PixelIcon name="book" size="xs" />
          任务指令
          <span class="dispatch-field__counter">{{ instructionLength }}/4000</span>
        </span>
        <textarea
          v-model="instruction"
          class="dispatch-input dispatch-textarea"
          rows="4"
          maxlength="4000"
          placeholder="清晰描述任务目标和预期结果，避免一次派发过多目标…"
          :disabled="isSubmitting"
        />
      </label>

      <!-- 完成后行为（可选项卡，替代裸 select） -->
      <fieldset class="dispatch-field">
        <span class="dispatch-field__label">
          <PixelIcon name="activity" size="xs" />
          完成后行为
        </span>
        <div class="dispatch-actions-group">
          <button
            v-for="opt in COMPLETION_OPTIONS"
            :key="opt.value"
            type="button"
            class="dispatch-action"
            :class="{ 'dispatch-action--active': completionAction === opt.value }"
            :disabled="isSubmitting || (opt.value === 'send_to_chat' && !targetThreadId)"
            :title="
              opt.value === 'send_to_chat' && !targetThreadId ? '当前没有可投递的对话' : undefined
            "
            @click="completionAction = opt.value"
          >
            <PixelIcon :name="opt.icon" size="sm" />
            <span class="dispatch-action__text">
              <span class="dispatch-action__label">{{ opt.label }}</span>
              <span class="dispatch-action__hint">{{ opt.hint }}</span>
            </span>
          </button>
        </div>
      </fieldset>

      <!-- 错误提示 -->
      <p v-if="submitError" class="dispatch-error">
        <PixelIcon name="alert" size="xs" />
        {{ submitError }}
      </p>
    </div>

    <!-- 底部操作（自定义 footer，使用 PButton） -->
    <template #footer>
      <PButton variant="secondary" size="sm" :disabled="isSubmitting" @click="handleClose">
        取消
      </PButton>
      <PButton
        variant="primary"
        size="sm"
        :disabled="!canSubmit"
        :loading="isSubmitting"
        @click="handleSubmit"
      >
        {{ isSubmitting ? '派发中…' : '交给 TA' }}
      </PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.dispatch-form {
  display: flex;
  flex-direction: column;
  gap: var(--ui-space-4);
  padding: 2px 0;
  font-family: var(--ui-font-sans);
}

/* ── 字段 ── */
.dispatch-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  border: none;
  padding: 0;
  min-width: 0;
}

.dispatch-field__label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ui-text-secondary);
}

.dispatch-field__optional {
  margin-left: 4px;
  padding: 0 6px;
  border-radius: var(--ui-radius-full);
  background: var(--ui-bg-hover);
  font-size: 10px;
  font-weight: 500;
  color: var(--ui-text-tertiary);
}

.dispatch-field__counter {
  margin-left: auto;
  font-weight: 500;
  color: var(--ui-text-disabled);
  font-variant-numeric: tabular-nums;
}

/* ── 输入控件（统一现代圆角 + 聚焦环 + 双主题） ── */
.dispatch-input,
.dispatch-select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--dash-input-border);
  border-radius: var(--ui-radius-md);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard);
}

.dispatch-input::placeholder {
  color: var(--ui-text-disabled);
}

.dispatch-input:focus,
.dispatch-select:focus {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 3px var(--ui-accent-sky-soft);
}

.dispatch-input:disabled,
.dispatch-select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dispatch-textarea {
  resize: vertical;
  min-height: 88px;
}

/* 下拉：隐藏原生箭头，右侧叠加 chevron */
.dispatch-field__control--select {
  position: relative;
  display: flex;
  align-items: center;
}

.dispatch-select {
  appearance: none;
  padding-right: 32px;
  cursor: pointer;
}

.dispatch-field__chevron {
  position: absolute;
  right: 12px;
  color: var(--ui-text-tertiary);
  pointer-events: none;
}

/* ── 完成后行为选项卡 ── */
.dispatch-actions-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--ui-space-2);
}

.dispatch-action {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-md);
  background: var(--ui-bg-surface);
  color: var(--ui-text-tertiary);
  cursor: pointer;
  text-align: left;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    background var(--ui-duration-fast) var(--ui-ease-standard),
    color var(--ui-duration-fast) var(--ui-ease-standard);
}

.dispatch-action:hover {
  border-color: var(--ui-border-strong);
  color: var(--ui-text-secondary);
}

.dispatch-action--active {
  border-color: var(--ui-accent-sky);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}

.dispatch-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.dispatch-action__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.dispatch-action__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-text-primary);
}

.dispatch-action--active .dispatch-action__label {
  color: var(--ui-text-primary);
}

.dispatch-action__hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--ui-text-tertiary);
}

/* ── 错误提示 ── */
.dispatch-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 9px 12px;
  border-radius: var(--ui-radius-md);
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
  font-size: 12px;
  font-weight: 500;
}

/* 窄屏时行为选项改单列堆叠 */
@media (max-width: 420px) {
  .dispatch-actions-group {
    grid-template-columns: 1fr;
  }
}
</style>
