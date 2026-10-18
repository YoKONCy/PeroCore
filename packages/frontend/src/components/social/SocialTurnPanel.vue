<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { SocialTurnRecord } from '@infos/shared'
import { socialApi } from '../../api/modules/socialApi'
import { PButton, PCard } from '../pixel'

const props = defineProps<{ agentId: string; history?: boolean }>()
const emit = defineEmits<{ 'attention-change': [value: boolean] }>()
const records = ref<Array<Omit<SocialTurnRecord, 'checkpoint'>>>([])
const error = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
let active = true
let request = 0
const labels = {
  running: '进行中',
  retrying: '等待重试',
  waiting: '等待唤醒',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  delivery_unknown: '执行结果未确认',
}
const items = computed(() =>
  records.value.filter((record) =>
    props.history
      ? !['running', 'retrying', 'waiting'].includes(record.status)
      : ['running', 'retrying', 'waiting'].includes(record.status) ||
        (!record.acknowledgedAt && ['failed', 'delivery_unknown'].includes(record.status)),
  ),
)
watch(items, (value) => emit('attention-change', value.length > 0), { immediate: true })
async function load(): Promise<void> {
  if (timer) clearTimeout(timer)
  const sequence = ++request
  let delay = 5000
  if (!active || !props.agentId) return
  try {
    const response = await socialApi.turns(props.agentId)
    if (!active || sequence !== request) return
    records.value = response.data ?? []
    error.value = ''
  } catch (cause) {
    const code = (cause as { code?: string }).code
    if (['NOT_FOUND', 'SERVICE_UNAVAILABLE', 'SERVICE_INITIALIZING'].includes(code ?? '')) {
      delay = 60_000
      if (active && sequence === request) {
        error.value = ''
        records.value = []
      }
    } else if (active && sequence === request)
      error.value = cause instanceof Error ? cause.message : '社交任务暂不可用'
  } finally {
    if (active && sequence === request) timer = setTimeout(() => void load(), delay)
  }
}
async function cancel(id: string): Promise<void> {
  try {
    await socialApi.cancelTurn(id)
    await load()
  } catch (cause) {
    error.value = (cause as Error).message
  }
}
async function acknowledge(id: string): Promise<void> {
  try {
    await socialApi.acknowledgeTurn(id)
    await load()
  } catch (cause) {
    error.value = (cause as Error).message
  }
}
function stop(): void {
  active = false
  request++
  if (timer) clearTimeout(timer)
}
watch(
  () => props.agentId,
  () => {
    records.value = []
    void load()
  },
)
onMounted(load)
onActivated(() => {
  active = true
  void load()
})
onDeactivated(stop)
onBeforeUnmount(stop)
</script>

<template>
  <PCard v-if="items.length || error" pixel padding="sm" class="social-turns">
    <header>
      <strong>社交任务</strong>
      <PButton size="sm" variant="ghost" @click="load">刷新</PButton>
    </header>
    <p v-if="error" class="social-turns__error">{{ error }}</p>
    <article v-for="record in items" :key="record.id">
      <div>
        <strong>
          {{ record.channelType === 'group' ? '群聊' : '私聊' }} · {{ record.channelId }}
        </strong>
        <span>{{ labels[record.status] }}</span>
      </div>
      <p v-if="record.error">{{ record.error }}</p>
      <small>{{ new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}</small>
      <PButton
        v-if="['running', 'retrying', 'waiting'].includes(record.status)"
        size="sm"
        variant="ghost"
        @click="cancel(record.id)"
      >
        取消
      </PButton>
      <PButton
        v-else-if="!history && !record.acknowledgedAt"
        size="sm"
        variant="ghost"
        @click="acknowledge(record.id)"
      >
        已处理
      </PButton>
    </article>
  </PCard>
</template>

<style scoped>
.social-turns {
  color: var(--ui-text-primary);
}
.social-turns header,
.social-turns article > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.social-turns article {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
}
.social-turns span,
.social-turns small {
  color: var(--ui-text-secondary);
  font-size: 12px;
}
.social-turns p {
  margin: 6px 0;
  color: var(--ui-text-secondary);
  overflow-wrap: anywhere;
}
.social-turns__error {
  color: var(--ui-danger) !important;
}
</style>
