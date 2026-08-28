<script setup lang="ts">
/**
 * ReActViewer — ReAct 思维链查看器
 *
 * 展示 Agent 的思考/行动/反思/错误分段，支持 Live 模式 (暂停/注入指令)。
 *
 * @props segments - 分段数据
 * @props isLive - 是否实时模式
 */
import { ref, watch, nextTick } from 'vue'
import { PixelIcon, PButton } from '../pixel'
import RunPulse from '../chat/RunPulse.vue'
import { chatApi } from '../../api/modules/chatApi'
import { logger } from '../../lib/logger'

export interface ReActSegment {
  type: 'text' | 'action' | 'thinking' | 'error' | 'reflection'
  content: string
}

interface Props {
  segments: ReActSegment[]
  isLive?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isLive: false,
})

const scrollRef = ref<HTMLElement | null>(null)
const isTaskPaused = ref(false)
const injection = ref('')
const isSending = ref(false)

// ── 自动滚动 ──

watch(
  () => props.segments.length,
  () => {
    nextTick(() => {
      if (scrollRef.value) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      }
    })
  },
)

// ── 任务控制 (P2-11: 接入 chatApi) ──

async function togglePause() {
  const sessionId = 'default' // TODO: 从 props 或 store 获取实际 sessionId
  try {
    if (isTaskPaused.value) {
      await chatApi.resumeTask(sessionId)
    } else {
      await chatApi.pauseTask(sessionId)
    }
    isTaskPaused.value = !isTaskPaused.value
  } catch (err) {
    logger.error('ReActViewer', '任务控制失败', err)
  }
}

async function sendInjection() {
  if (!injection.value.trim()) return
  isSending.value = true
  const sessionId = 'default'
  try {
    await chatApi.injectInstruction(sessionId, injection.value)
    injection.value = ''
  } catch (err) {
    logger.error('ReActViewer', '指令注入失败', err)
  } finally {
    isSending.value = false
  }
}

/** 段类型图标映射 */
function segIcon(type: string): string {
  const map: Record<string, string> = {
    thinking: 'brain',
    action: 'play',
    error: 'alert',
    reflection: 'bulb',
    text: 'chat',
  }
  return map[type] ?? 'chat'
}

/** 段类型色彩 */
function segClasses(type: string): string {
  const map: Record<string, string> = {
    thinking: 'border-l-[3px] border-l-sky-500 bg-sky-50',
    error: 'border-l-[3px] border-l-rose-500 bg-rose-50/30',
    reflection: 'border-l-[3px] border-l-amber-500 bg-amber-50/30',
    action: '',
    text: '',
  }
  return map[type] ?? ''
}

function labelColor(type: string): string {
  const map: Record<string, string> = {
    thinking: 'text-sky-500',
    error: 'text-rose-500',
    reflection: 'text-amber-500',
    action: 'text-slate-400',
    text: 'text-slate-400',
  }
  return map[type] ?? 'text-slate-400'
}
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <!-- 工具栏 (Live 模式) -->
    <div v-if="isLive" class="react-viewer-toolbar">
      <RunPulse
        :state="isTaskPaused ? 'paused' : 'thinking'"
        :label="isTaskPaused ? '任务已暂停' : '正在思考中'"
        :live="!isTaskPaused"
        compact
      />
      <PButton :variant="isTaskPaused ? 'primary' : 'ghost'" size="sm" @click="togglePause">
        {{ isTaskPaused ? '继续运行' : '暂停思考' }}
      </PButton>
    </div>

    <!-- 内容区 -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto p-4 flex flex-col gap-3 rv-scrollbar">
      <div v-if="segments.length === 0" class="text-center text-slate-400 font-bold mt-[60px]">
        {{ isLive ? '等待思考数据...' : '无思考过程记录' }}
      </div>

      <div
        v-for="(seg, i) in segments"
        :key="i"
        :class="[
          'px-4 py-3 border border-slate-200 bg-white max-w-[800px] w-full mx-auto',
          segClasses(seg.type),
        ]"
      >
        <div
          :class="[
            'flex items-center gap-1.5 text-[11px] font-bold uppercase mb-1.5',
            labelColor(seg.type),
          ]"
        >
          <PixelIcon :name="segIcon(seg.type)" size="xs" />
          <span>
            {{
              {
                thinking: '思考链',
                action: '动作',
                error: '错误',
                reflection: '自我反思',
                text: '文本',
              }[seg.type]
            }}
          </span>
        </div>
        <div
          :class="[
            'text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap font-mono',
            seg.type === 'action' ? 'italic' : '',
          ]"
        >
          {{ seg.content }}
        </div>
      </div>
    </div>

    <!-- 指令注入 (Live 模式) -->
    <div v-if="isLive" class="px-4 py-3 flex gap-2 border-t-2 border-slate-200 flex-shrink-0">
      <input
        v-model="injection"
        class="flex-1 px-3 py-2 border-2 border-slate-200 bg-white text-slate-800 text-[13px] outline-none transition-colors focus:border-sky-300"
        placeholder="发送指令干预思考..."
        :disabled="isSending"
        @keyup.enter="sendInjection"
      />
      <PButton
        variant="primary"
        size="sm"
        :disabled="!injection.trim() || isSending"
        @click="sendInjection"
      >
        {{ isSending ? '发送中...' : '发送' }}
      </PButton>
    </div>
  </div>
</template>

<style scoped>
.react-viewer-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ui-border-default);
  background: color-mix(in srgb, var(--ui-bg-elevated) 86%, transparent);
}

.rv-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.rv-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
