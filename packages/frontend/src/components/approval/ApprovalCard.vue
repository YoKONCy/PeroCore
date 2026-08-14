<script setup lang="ts">
/**
 * ApprovalCard — 跨区域共享的工具审批卡片。
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
const showPermanentActions = ref(false)
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
      <span class="approval-card__icon"><PixelIcon name="shield" size="sm" /></span>
      <div class="approval-card__heading">
        <strong>需要您的许可</strong>
        <span>{{ request.toolName }}</span>
      </div>
      <span class="approval-card__timer">{{ secondsLeft }}s</span>
    </header>

    <p class="approval-card__reason">{{ request.reason }}</p>
    <pre v-if="command" class="approval-card__command">{{ command }}</pre>

    <button class="approval-card__details-toggle" @click="toggleDetails">
      <PixelIcon :name="expanded ? 'chevron-up' : 'chevron-down'" size="xs" />
      {{ expanded ? '收起详情' : '查看参数与审计记录' }}
    </button>
    <template v-if="expanded">
      <pre class="approval-card__details">{{ JSON.stringify(request.argsSummary, null, 2) }}</pre>
      <div class="approval-card__audit">
        <strong>审批审计记录</strong>
        <span v-if="auditLoading">正在读取…</span>
        <span v-else-if="auditRecords.length === 0">暂无记录</span>
        <div v-for="record in auditRecords" :key="record.id" class="approval-card__audit-row">
          <span>{{ record.event }}</span>
          <time>{{ formatAuditTime(record.createdAt) }}</time>
        </div>
      </div>
    </template>

    <textarea
      v-model="message"
      maxlength="2000"
      rows="2"
      class="approval-card__message"
      placeholder="可选：告诉 Agent 为什么同意或拒绝，以及接下来应注意什么…"
    />

    <footer class="approval-card__actions">
      <PButton size="sm" :disabled="loading" @click="submit('allow_once')">允许一次</PButton>
      <PButton size="sm" variant="secondary" :disabled="loading" @click="submit('allow_session')">
        本会话允许
      </PButton>
      <PButton size="sm" variant="danger" :disabled="loading" @click="submit('deny_once')">
        拒绝一次
      </PButton>
      <button
        class="approval-card__permanent-toggle"
        @click="showPermanentActions = !showPermanentActions"
      >
        {{ showPermanentActions ? '收起长期规则' : '长期规则…' }}
      </button>
    </footer>
    <div v-if="showPermanentActions" class="approval-card__permanent">
      <p>长期规则会影响该 Agent 后续所有会话，请谨慎选择。</p>
      <PButton size="sm" variant="secondary" :disabled="loading" @click="submit('allow_always')">
        始终允许此工具
      </PButton>
      <PButton size="sm" variant="danger" :disabled="loading" @click="submit('deny_always')">
        始终拒绝此工具
      </PButton>
    </div>
  </article>
</template>

<style scoped>
.approval-card {
  padding: 14px;
  border: 1px solid rgba(245, 158, 11, 0.38);
  border-left: 4px solid #f59e0b;
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-bg-elevated, #fff) 96%, #f59e0b 4%);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}
.approval-card__header {
  display: flex;
  align-items: center;
  gap: 10px;
}
.approval-card__icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: #d97706;
  background: #fef3c7;
  border-radius: 7px;
}
.approval-card__heading {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  font-size: 12px;
  color: var(--ui-text-secondary, #64748b);
}
.approval-card__heading strong {
  font-size: 13px;
  color: var(--ui-text-primary, #1e293b);
}
.approval-card__timer {
  font: 11px monospace;
  color: #d97706;
}
.approval-card__reason {
  margin: 10px 0 8px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--ui-text-secondary, #475569);
}
.approval-card__command,
.approval-card__details {
  margin: 8px 0;
  padding: 9px;
  overflow: auto;
  border-radius: 6px;
  background: #111827;
  color: #d1fae5;
  font:
    11px/1.5 'Cascadia Code',
    monospace;
  white-space: pre-wrap;
}
.approval-card__details-toggle {
  display: flex;
  gap: 5px;
  align-items: center;
  border: 0;
  background: none;
  color: #64748b;
  font-size: 11px;
  cursor: pointer;
}
.approval-card__message {
  box-sizing: border-box;
  width: 100%;
  margin-top: 9px;
  padding: 8px 10px;
  resize: vertical;
  border: 1px solid var(--ui-border-subtle, #cbd5e1);
  border-radius: 7px;
  background: var(--ui-bg-primary, #fff);
  color: var(--ui-text-primary, #1e293b);
  font-size: 12px;
  outline: none;
}
.approval-card__message:focus {
  border-color: #38bdf8;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.14);
}
.approval-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 9px;
}
.approval-card__permanent-toggle {
  border: 0;
  background: none;
  color: var(--ui-text-secondary, #64748b);
  font-size: 11px;
  cursor: pointer;
}
.approval-card__permanent {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
  padding: 9px;
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 7px;
  background: rgba(254, 242, 242, 0.65);
}
.approval-card__permanent p {
  width: 100%;
  margin: 0;
  color: #b45309;
  font-size: 11px;
}
.approval-card__audit {
  display: grid;
  gap: 5px;
  margin: 8px 0;
  padding: 8px;
  border: 1px solid var(--ui-border-subtle, #cbd5e1);
  border-radius: 7px;
  color: var(--ui-text-secondary, #64748b);
  font-size: 11px;
}
.approval-card__audit-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.approval-card__audit-row time {
  font-family: monospace;
}
.approval-card--compact {
  padding: 10px;
}
</style>
