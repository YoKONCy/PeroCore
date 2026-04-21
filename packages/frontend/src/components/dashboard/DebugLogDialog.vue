<script setup lang="ts">
/**
 * DebugLogDialog — 调试日志弹窗
 *
 * 显示最近一次对话的 System Prompt / Response 原始数据。
 * 用于快速调试 LLM 通信。
 */
import { ref, computed } from 'vue'
import { PixelIcon, PButton, PDialog } from '../pixel'
import { useSessionStore } from '../../stores'

const sessionStore = useSessionStore()

const isOpen = ref(false)
const tab = ref<'prompt' | 'response'>('response')

/** 提取最近一条 assistant 消息 */
const lastAssistant = computed(() =>
  [...sessionStore.messages].reverse().find((m) => m.role === 'assistant'),
)

/** 提取最近一条 system 消息 */
const lastSystem = computed(() =>
  [...sessionStore.messages].reverse().find((m) => m.role === 'system'),
)

const displayContent = computed(() => {
  if (tab.value === 'prompt') {
    return lastSystem.value?.content || '（无 system prompt 记录）'
  }
  return lastAssistant.value?.content || '（无 assistant 响应记录）'
})

function open() {
  isOpen.value = true
}

defineExpose({ open })
</script>

<template>
  <PDialog v-model="isOpen" title="调试日志" width="720px">
    <div class="dbg-dialog">
      <!-- 选项卡 -->
      <div class="dbg-tabs">
        <button
          :class="['dbg-tab', tab === 'response' ? 'dbg-tab-active' : '']"
          @click="tab = 'response'"
        >
          <PixelIcon name="chat" size="xs" />
          Response
        </button>
        <button
          :class="['dbg-tab', tab === 'prompt' ? 'dbg-tab-active' : '']"
          @click="tab = 'prompt'"
        >
          <PixelIcon name="terminal" size="xs" />
          System Prompt
        </button>
      </div>

      <!-- 内容 -->
      <pre class="dbg-content">{{ displayContent }}</pre>
    </div>

    <template #footer>
      <PButton variant="ghost" @click="isOpen = false">关闭</PButton>
    </template>
  </PDialog>
</template>

<style scoped>
.dbg-dialog {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dbg-tabs {
  display: flex;
  gap: 4px;
}

.dbg-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.dbg-tab:hover {
  border-color: var(--color-sky-light);
  color: var(--color-sky-500);
}

.dbg-tab-active {
  background: var(--color-sky-50, rgba(56, 189, 248, 0.1));
  border-color: var(--color-sky-hover);
  color: var(--color-sky-shadow);
}

.dbg-content {
  max-height: 400px;
  overflow: auto;
  padding: 16px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-secondary);
  color: var(--color-text-primary);
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.dbg-content::-webkit-scrollbar {
  width: 4px;
}

.dbg-content::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
</style>
