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
import { chatApi } from '../../api/modules/chatApi'

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
    console.error('任务控制失败:', err)
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
    console.error('指令注入失败:', err)
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
</script>

<template>
  <div class="react-viewer">
    <!-- 工具栏 (Live 模式) -->
    <div v-if="isLive" class="rv-toolbar">
      <div class="rv-status">
        <span :class="['rv-status-dot', isTaskPaused ? 'rv-dot-paused' : 'rv-dot-running']" />
        <span class="rv-status-text">{{ isTaskPaused ? '任务已暂停' : '正在思考中...' }}</span>
      </div>
      <PButton :variant="isTaskPaused ? 'primary' : 'ghost'" size="sm" @click="togglePause">
        {{ isTaskPaused ? '继续运行' : '暂停思考' }}
      </PButton>
    </div>

    <!-- 内容区 -->
    <div ref="scrollRef" class="rv-body">
      <div v-if="segments.length === 0" class="rv-empty">
        {{ isLive ? '等待思考数据...' : '无思考过程记录' }}
      </div>

      <div v-for="(seg, i) in segments" :key="i" :class="['rv-seg', `rv-seg-${seg.type}`]">
        <div class="rv-seg-label">
          <PixelIcon :name="segIcon(seg.type)" size="xs" />
          <span>{{
            {
              thinking: '思考链',
              action: '动作',
              error: '错误',
              reflection: '自我反思',
              text: '文本',
            }[seg.type]
          }}</span>
        </div>
        <div class="rv-seg-content">{{ seg.content }}</div>
      </div>
    </div>

    <!-- 指令注入 (Live 模式) -->
    <div v-if="isLive" class="rv-inject">
      <input
        v-model="injection"
        class="rv-inject-input"
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
.react-viewer {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 工具栏 */
.rv-toolbar {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--color-border);
  flex-shrink: 0;
}
.rv-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.rv-status-dot {
  width: 8px;
  height: 8px;
}
.rv-dot-running {
  background: var(--color-emerald-face);
  animation: pulse 2s infinite;
}
.rv-dot-paused {
  background: var(--color-yellow-500);
  animation: pulse 2s infinite;
}

/* 内容 */
.rv-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rv-body::-webkit-scrollbar {
  width: 4px;
}
.rv-body::-webkit-scrollbar-track {
  background: transparent;
}
.rv-body::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}

.rv-empty {
  text-align: center;
  color: var(--color-text-muted);
  font-weight: 700;
  margin-top: 60px;
}

/* 段落 */
.rv-seg {
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-primary);
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
}

.rv-seg-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.rv-seg-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

/* 段类型色彩 */
.rv-seg-thinking {
  border-left: 3px solid var(--color-sky-500);
  background: var(--color-sky-50);
}
.rv-seg-thinking .rv-seg-label {
  color: var(--color-sky-500);
}

.rv-seg-error {
  border-left: 3px solid var(--color-red-face);
  background: rgba(239, 68, 68, 0.03);
}
.rv-seg-error .rv-seg-label {
  color: var(--color-red-face);
}

.rv-seg-reflection {
  border-left: 3px solid var(--color-yellow-500);
  background: rgba(234, 179, 8, 0.03);
}
.rv-seg-reflection .rv-seg-label {
  color: var(--color-yellow-500);
}

.rv-seg-action .rv-seg-label {
  color: var(--color-text-muted);
}
.rv-seg-action .rv-seg-content {
  font-style: italic;
}

/* 注入区 */
.rv-inject {
  padding: 12px 16px;
  display: flex;
  gap: 8px;
  border-top: 2px solid var(--color-border);
  flex-shrink: 0;
}
.rv-inject-input {
  flex: 1;
  padding: 8px 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}
.rv-inject-input:focus {
  border-color: var(--color-sky-hover);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
</style>
