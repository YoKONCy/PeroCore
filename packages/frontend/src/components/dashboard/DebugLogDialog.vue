<script setup lang="ts">
/**
 * DebugLogDialog — 调试日志弹窗
 *
 * 显示最近一次对话的 System Prompt / Response 原始数据。
 * 用于快速调试 LLM 通信。
 */
import { ref, computed } from 'vue'
import { PixelIcon, PButton, PDialog } from '../pixel'
import { useThreadStore } from '../../stores'

const threadStore = useThreadStore()

const isOpen = ref(false)
const tab = ref<'prompt' | 'response'>('response')

/** 提取最近一条 assistant 消息 */
const lastAssistant = computed(() =>
  [...threadStore.messages].reverse().find((m) => m.role === 'assistant'),
)

/** 提取最近一条 system 消息 */
const lastSystem = computed(() =>
  [...threadStore.messages].reverse().find((m) => m.role === 'system'),
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
    <div class="flex flex-col gap-3">
      <!-- 选项卡 -->
      <div class="flex gap-1">
        <button
          :class="[
            'flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold border-2 cursor-pointer transition-all',
            tab === 'response'
              ? 'bg-sky-50 border-sky-300 text-sky-600'
              : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-sky-200 hover:text-sky-500',
          ]"
          @click="tab = 'response'"
        >
          <PixelIcon name="chat" size="xs" />
          Response
        </button>
        <button
          :class="[
            'flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold border-2 cursor-pointer transition-all',
            tab === 'prompt'
              ? 'bg-sky-50 border-sky-300 text-sky-600'
              : 'bg-slate-50 border-slate-200 text-slate-400 hover:border-sky-200 hover:text-sky-500',
          ]"
          @click="tab = 'prompt'"
        >
          <PixelIcon name="terminal" size="xs" />
          System Prompt
        </button>
      </div>

      <!-- 内容 -->
      <pre
        class="max-h-[400px] overflow-auto p-4 border-2 border-slate-200 bg-slate-50 text-slate-800 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all dbg-scrollbar"
        >{{ displayContent }}</pre
      >
    </div>

    <template #footer>
      <PButton variant="ghost" @click="isOpen = false">关闭</PButton>
    </template>
  </PDialog>
</template>

<style scoped>
/* 像素风滚动条 */
.dbg-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.dbg-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
