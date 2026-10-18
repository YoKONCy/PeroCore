<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
import { memoryApi, type PrivacyCleanupJob } from '../../api/modules/memoryApi'
import { PButton, PCard } from '../pixel'

const jobs = ref<PrivacyCleanupJob[]>([])
const error = ref('')
const retrying = ref('')
const labels = {
  memory: '记忆',
  fact: '事实',
  knowledge: '知识',
  'reset-memory': '全部记忆',
  'social-memory': '社交长记忆',
}
let timer: ReturnType<typeof setTimeout> | undefined
let active = true
let sequence = 0
async function load(): Promise<void> {
  if (timer) clearTimeout(timer)
  const request = ++sequence
  if (!active) return
  try {
    const response = await memoryApi.cleanupJobs()
    if (active && request === sequence)
      jobs.value = (response.data ?? []).filter((job) => job.status !== 'completed')
  } catch {
    /* 清理查询失败不重复弹出通知，仍可手动刷新。 */
  } finally {
    if (active && request === sequence) timer = setTimeout(() => void load(), 5000)
  }
}
async function retry(id: string): Promise<void> {
  if (retrying.value) return
  retrying.value = id
  error.value = ''
  try {
    await memoryApi.retryCleanup(id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '清理尚未完成'
  } finally {
    retrying.value = ''
    await load()
  }
}
function stop(): void {
  active = false
  sequence++
  if (timer) clearTimeout(timer)
}
onMounted(load)
onActivated(() => {
  active = true
  void load()
})
onDeactivated(stop)
onBeforeUnmount(stop)
</script>

<template>
  <PCard v-if="jobs.length" pixel padding="sm" class="privacy-cleanup">
    <header>
      <strong>数据清理</strong>
      <PButton size="sm" variant="ghost" @click="load">刷新</PButton>
    </header>
    <p v-if="error">{{ error }}</p>
    <article v-for="job in jobs" :key="job.id">
      <div>
        <strong>{{ labels[job.kind] }}</strong>
        <span>{{ job.status === 'failed' ? '需要重试' : '正在清理' }} · {{ job.attempts }}/5</span>
      </div>
      <p v-if="job.lastError">{{ job.lastError }}</p>
      <PButton
        v-if="job.status === 'failed'"
        size="sm"
        variant="ghost"
        :disabled="Boolean(retrying)"
        @click="retry(job.id)"
      >
        {{ retrying === job.id ? '处理中…' : '重试清理' }}
      </PButton>
    </article>
  </PCard>
</template>

<style scoped>
.privacy-cleanup {
  flex-shrink: 0;
  max-height: 200px;
  overflow: auto;
  color: var(--ui-text-primary);
}
header,
article > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
article {
  padding: 8px 0;
  border-top: 1px solid var(--ui-border-default);
}
p,
span {
  color: var(--ui-text-secondary);
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
