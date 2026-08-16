<script setup lang="ts">
/**
 * ApprovalCard — 跨区域共享的紧凑工具审批卡片。
 *
 * 卡片负责决策内容；对话流、工作区、任务详情只负责选择展示容器。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PixelIcon, PButton } from '../pixel'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalAuditRecord,
} from '../../api/modules/approvalsApi'
import { approvalsApi } from '../../api/modules/approvalsApi'

const props = withDefaults(
  defineProps<{
    request: ApprovalRequest
    loading?: boolean
    compact?: boolean
  }>(),
  {
    loading: false,
    compact: false,
  },
)

const emit = defineEmits<{
  resolve: [decision: ApprovalDecision, message?: string]
}>()

const message = ref('')
const expanded = ref(false)
const auditLoading = ref(false)
const auditRecords = ref<ApprovalAuditRecord[]>([])
const now = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | null = null
const secondsLeft = computed(() =>
  Math.max(0, Math.ceil((Date.parse(props.request.expiresAt) - now.value) / 1000)),
)
const command = computed(() => {
  const value = props.request.argsSummary.command
  return typeof value === 'string' ? value : null
})

function submit(decision: ApprovalDecision): void {
  const note = message.value.trim()
  emit('resolve', decision, note || undefined)
}

async function toggleDetails(): Promise<void> {
  expanded.value = !expanded.value
  if (!expanded.value || auditRecords.value.length || auditLoading.value) return
  auditLoading.value = true
  try {
    const response = await approvalsApi.audit({ approvalId: props.request.id })
    auditRecords.value = response.data?.records ?? []
  } finally {
    auditLoading.value = false
  }
}

function formatAuditTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  countdownTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
})
onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<template>
  <article class="approval-card" :class="{ 'approval-card--compact': compact }">
    <header class="approval-card__header">
      <span class="approval-card__icon"><PixelIcon name="shield" size="xs" /></span>
      <strong>等待许可</strong>
      <span class="approval-card__tool">{{ request.toolName }}</span>
      <span class="approval-card__timer">{{ secondsLeft }}s</span>
    </header>

    <div class="approval-card__body">
      <p class="approval-card__reason">{{ request.reason }}</p>
      <pre v-if="command" class="approval-card__command">{{ command }}</pre>

      <button class="approval-card__details-toggle" type="button" @click="toggleDetails">
        <PixelIcon :name="expanded ? 'chevron-up' : 'chevron-down'" size="xs" />
        {{ expanded ? '收起详情' : '参数与审计' }}
      </button>
      <template v-if="expanded">
        <pre class="approval-card__details">{{ JSON.stringify(request.argsSummary, null, 2) }}</pre>
        <div class="approval-card__audit">
          <strong>审批记录</strong>
          <span v-if="auditLoading">正在读取…</span>
          <span v-else-if="auditRecords.length === 0">暂无记录</span>
          <div v-for="record in auditRecords" :key="record.id" class="approval-card__audit-row">
            <span>{{ record.event }}</span>
            <time>{{ formatAuditTime(record.createdAt) }}</time>
          </div>
        </div>
      </template>

      <input
        v-model="message"
        maxlength="2000"
        class="approval-card__message"
        placeholder="附言（可选）：告诉 Agent 同意或拒绝的理由"
      />
    </div>

    <footer class="approval-card__actions">
      <PButton size="sm" :disabled="loading" @click="submit('allow_once')">允许一次</PButton>
      <PButton size="sm" variant="secondary" :disabled="loading" @click="submit('allow_session')">
        本轮对话允许
      </PButton>
      <PButton size="sm" variant="danger" :disabled="loading" @click="submit('deny_once')">
        拒绝一次
      </PButton>
    </footer>
  </article>
</template>

<style scoped>
.approval-card {
  box-sizing: border-box;
  width: min(100%, 480px);
  margin: 4px 0 4px auto;
  overflow: hidden;
  border: 1px solid
    color-mix(in srgb, var(--ui-accent-primary, #db2777) 48%, var(--ui-border-subtle));
  border-left: 3px solid var(--ui-accent-primary, #db2777);
  border-radius: 2px;
  background: var(--ui-bg-elevated, #fff);
  color: var(--ui-text-primary, #1e293b);
  box-shadow: 4px 4px 0 color-mix(in srgb, var(--ui-text-primary, #0f172a) 14%, transparent);
}

.approval-card__header {
  display: flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  border-bottom: 1px solid var(--ui-border-subtle, #e2e8f0);
  background: color-mix(in srgb, var(--ui-accent-primary, #db2777) 7%, var(--ui-bg-elevated, #fff));
  font-size: 11px;
}

.approval-card__header strong {
  flex-shrink: 0;
  font-size: 12px;
}

.approval-card__icon {
  display: grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border-radius: 1px;
  background: color-mix(in srgb, var(--ui-accent-primary, #db2777) 14%, transparent);
  color: var(--ui-accent-primary, #db2777);
}

.approval-card__tool {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-secondary, #64748b);
  font:
    10px/1.2 'Cascadia Code',
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-card__timer {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--ui-text-tertiary, #94a3b8);
  font: 10px/1 monospace;
}

.approval-card__body {
  padding: 8px 10px 6px;
}

.approval-card__reason {
  margin: 0 0 6px;
  color: var(--ui-text-secondary, #475569);
  font-size: 11px;
  line-height: 1.45;
}

.approval-card__command,
.approval-card__details {
  box-sizing: border-box;
  max-height: 110px;
  margin: 6px 0;
  padding: 7px 9px;
  overflow: auto;
  border: 1px solid var(--ui-border-subtle, #e2e8f0);
  border-radius: 2px;
  background: var(--ui-bg-primary, #f8fafc);
  color: var(--ui-text-primary, #1e293b);
  font:
    10px/1.45 'Cascadia Code',
    monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

.approval-card__command {
  border-left: 2px solid var(--ui-accent-sky, #0ea5e9);
}

.approval-card__details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-tertiary, #64748b);
  font-size: 10px;
  cursor: pointer;
}

.approval-card__message {
  box-sizing: border-box;
  width: 100%;
  height: 30px;
  margin-top: 6px;
  padding: 5px 8px;
  border: 1px solid var(--ui-border-subtle, #cbd5e1);
  border-radius: 5px;
  outline: none;
  background: var(--ui-bg-primary, #fff);
  color: var(--ui-text-primary, #1e293b);
  font-size: 11px;
}

.approval-card__message::placeholder {
  color: var(--ui-text-tertiary, #94a3b8);
}

.approval-card__message:focus {
  border-color: var(--ui-accent-sky, #0ea5e9);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent-sky, #0ea5e9) 15%, transparent);
}

.approval-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 10px 9px;
}

.approval-card__audit {
  display: grid;
  gap: 4px;
  margin: 6px 0;
  padding: 7px;
  border: 1px solid var(--ui-border-subtle, #cbd5e1);
  border-radius: 2px;
  color: var(--ui-text-secondary, #64748b);
  font-size: 10px;
}

.approval-card__audit-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.approval-card__audit-row time {
  font-family: monospace;
}

.approval-card--compact {
  margin-block: 5px;
}

[data-theme='dark'] .approval-card {
  border-color: color-mix(in srgb, var(--ui-accent-primary, #f472b6) 42%, var(--ui-border-subtle));
  background: var(--ui-bg-elevated, #1e1b2e);
  box-shadow: 5px 5px 0 rgba(0, 0, 0, 0.32);
}

[data-theme='dark'] .approval-card__header {
  background: color-mix(
    in srgb,
    var(--ui-accent-primary, #f472b6) 10%,
    var(--ui-bg-elevated, #1e1b2e)
  );
}

[data-theme='dark'] .approval-card__command,
[data-theme='dark'] .approval-card__details,
[data-theme='dark'] .approval-card__message {
  background: color-mix(in srgb, var(--ui-bg-primary, #11121c) 88%, #000 12%);
}
</style>
