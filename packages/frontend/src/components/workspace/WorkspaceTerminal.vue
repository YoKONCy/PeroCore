<script setup lang="ts">
/** 多终端工作视窗：轮询增量输出，支持输入、中断、强杀与关闭。 */
import { ref, watch, nextTick, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'
import { terminalsApi, type TerminalInfo } from '../../api/modules/approvalsApi'
import { useNotificationStore } from '../../stores'

const props = defineProps<{ agentId: string; threadId: string }>()
const emit = defineEmits<{ active: [terminalId: string] }>()
const notification = useNotificationStore()

interface TerminalState extends TerminalInfo {
  output: string
  cursor: number
  unread: boolean
}
const items = ref<TerminalState[]>([])
const activeId = ref('')
const input = ref('')
const viewport = ref<HTMLPreElement | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function session() {
  return { agentId: props.agentId, threadId: props.threadId }
}

async function refreshList(): Promise<void> {
  if (!props.agentId || !props.threadId) return
  const res = await terminalsApi.list(session())
  const known = new Map(items.value.map((item) => [item.id, item]))
  items.value = (res.data?.terminals ?? []).map((info) => {
    const old = known.get(info.id)
    return {
      ...info,
      output: old?.output ?? '',
      cursor: old?.cursor ?? 0,
      unread: old?.unread ?? false,
    }
  })
  if (!activeId.value && items.value[0]) select(items.value[0]!.id)
}

/** 创建当前平台的交互式系统 Shell（Windows 为 PowerShell）。 */
async function create(): Promise<void> {
  try {
    const res = await terminalsApi.create(session(), { cols: 120, rows: 30 })
    if (res.data) items.value.push({ ...res.data, output: '', cursor: 0, unread: false })
    if (res.data) select(res.data.id)
  } catch (error) {
    notification.toast(`新建终端失败：${error instanceof Error ? error.message : '未知错误'}`, {
      type: 'error',
    })
  }
}

function select(id: string): void {
  activeId.value = id
  const item = items.value.find((entry) => entry.id === id)
  if (item) item.unread = false
  emit('active', id)
  void nextTick(() => {
    if (viewport.value) viewport.value.scrollTop = viewport.value.scrollHeight
  })
}

async function poll(): Promise<void> {
  // 同步由其他视图或 Agent 工具创建/关闭的终端，再逐个增量读取。
  await refreshList()
  for (const item of items.value) {
    if (item.status !== 'running' && item.cursor > 0) continue
    try {
      const res = await terminalsApi.read(session(), item.id, item.cursor)
      if (!res.data) continue
      if (res.data.droppedChars) {
        item.output += `\n[系统] 输出过快，已丢弃 ${res.data.droppedChars} 个历史字符。\n`
      }
      if (res.data.output) {
        item.output += res.data.output
        item.cursor = res.data.nextCursor
        if (activeId.value !== item.id) item.unread = true
      }
      item.status = res.data.status
      item.exitCode = res.data.exitCode
    } catch {
      /* 终端可能已被其他视图关闭，下一次列表刷新移除。 */
    }
  }
  await nextTick()
  if (viewport.value && activeId.value) viewport.value.scrollTop = viewport.value.scrollHeight
}

async function sendInput(): Promise<void> {
  if (!activeId.value || !input.value) return
  await terminalsApi.write(session(), activeId.value, `${input.value}\r`)
  input.value = ''
}

async function action(id: string, actionName: 'interrupt' | 'kill' | 'close'): Promise<void> {
  await terminalsApi.action(session(), id, actionName)
  if (actionName === 'close') {
    items.value = items.value.filter((item) => item.id !== id)
    if (activeId.value === id) select(items.value[0]?.id ?? '')
  }
}

watch(
  () => [props.agentId, props.threadId],
  async () => {
    items.value = []
    activeId.value = ''
    await refreshList()
    if (!timer) timer = setInterval(() => void poll(), 800)
  },
  { immediate: true },
)
onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="work-terminal">
    <div class="work-terminal__tabs">
      <button
        v-for="item in items"
        :key="item.id"
        :class="{ active: item.id === activeId }"
        @click="select(item.id)"
      >
        <span :class="['status', item.status]" />
        {{ item.title }}
        <i v-if="item.unread" />
        <span @click.stop="action(item.id, 'close')">×</span>
      </button>
      <button class="terminal-create" title="新建系统终端" @click="create">
        <PixelIcon name="plus" size="xs" />
        <span>新建终端</span>
      </button>
    </div>
    <template v-if="items.find((item) => item.id === activeId)">
      <div class="terminal-toolbar">
        <span>{{ items.find((item) => item.id === activeId)?.backend.toUpperCase() }}</span>
        <span>PID {{ items.find((item) => item.id === activeId)?.pid ?? '—' }}</span>
        <span class="spacer" />
        <button title="中断" @click="action(activeId, 'interrupt')">Ctrl+C</button>
        <button title="强制终止" @click="action(activeId, 'kill')">Kill</button>
      </div>
      <pre ref="viewport" class="terminal-output">{{
        items.find((item) => item.id === activeId)?.output || '等待终端输出…'
      }}</pre>
      <form class="terminal-input" @submit.prevent="sendInput">
        <span>›</span>
        <input v-model="input" placeholder="向终端输入…" />
      </form>
    </template>
    <div v-else class="terminal-empty">输入命令创建第一个工作终端</div>
  </div>
</template>

<style scoped>
.work-terminal {
  /* 局部终端语义变量：浅色与深色都在此声明，子元素一律引用变量，不再硬编码。 */
  --work-terminal-bg: #f7f8fb;
  --work-terminal-surface: #eef1f6;
  --work-terminal-surface-active: #ffffff;
  --work-terminal-border: rgba(15, 23, 42, 0.11);
  --work-terminal-border-strong: rgba(15, 23, 42, 0.18);
  --work-terminal-text: #334155;
  --work-terminal-muted: #7c8598;
  --work-terminal-hover: rgba(15, 23, 42, 0.05);
  --work-terminal-accent: #0284c7;
  --work-terminal-success: #059669;
  --work-terminal-danger: #dc2626;
  --work-terminal-toolbar-bg: rgba(255, 255, 255, 0.55);
  --work-terminal-scrollbar: rgba(15, 23, 42, 0.22);
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--work-terminal-bg);
  color: var(--work-terminal-text);
}
[data-theme='dark'] .work-terminal {
  --work-terminal-bg: #0b1020;
  --work-terminal-surface: #0e1626;
  --work-terminal-surface-active: #0b1020;
  --work-terminal-border: #263349;
  --work-terminal-border-strong: #334155;
  --work-terminal-text: #cbd5e1;
  --work-terminal-muted: #64748b;
  --work-terminal-hover: rgba(255, 255, 255, 0.04);
  --work-terminal-accent: #38bdf8;
  --work-terminal-success: #34d399;
  --work-terminal-danger: #fb7185;
  --work-terminal-toolbar-bg: rgba(15, 23, 42, 0.45);
  --work-terminal-scrollbar: #334155;
}

.work-terminal__tabs {
  display: flex;
  min-height: 34px;
  flex-shrink: 0;
  align-items: stretch;
  overflow-x: auto;
  border-bottom: 1px solid var(--work-terminal-border);
  background: var(--work-terminal-surface);
}
.work-terminal__tabs > button {
  display: flex;
  min-width: 112px;
  max-width: 190px;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 0;
  border-right: 1px solid var(--work-terminal-border);
  background: transparent;
  color: var(--work-terminal-muted);
  font-size: 10px;
  white-space: nowrap;
  cursor: pointer;
}
.work-terminal__tabs > button:hover {
  background: var(--work-terminal-hover);
  color: var(--work-terminal-text);
}
.work-terminal__tabs > button.active {
  background: var(--work-terminal-surface-active);
  color: var(--work-terminal-text);
  box-shadow: inset 0 -2px var(--work-terminal-accent);
}
.work-terminal__tabs > button > span:last-child {
  margin-left: auto;
  color: var(--work-terminal-muted);
  font-size: 14px;
}
.work-terminal__tabs > button > span:last-child:hover {
  color: var(--work-terminal-danger);
}
.work-terminal__tabs i {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--work-terminal-accent);
}
.status {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--work-terminal-muted);
}
.status.running {
  background: var(--work-terminal-success);
  box-shadow: 0 0 5px var(--work-terminal-success);
}
.status.failed,
.status.killed {
  background: var(--work-terminal-danger);
}
.terminal-create {
  display: flex;
  min-width: 104px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--work-terminal-border);
  background: transparent;
  color: var(--work-terminal-muted);
  font-size: 10px;
  cursor: pointer;
}
.terminal-create:hover {
  background: var(--work-terminal-hover);
  color: var(--work-terminal-accent);
}

.terminal-toolbar {
  display: flex;
  min-height: 30px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  border-bottom: 1px solid var(--work-terminal-border);
  background: var(--work-terminal-toolbar-bg);
  color: var(--work-terminal-muted);
  font: 9px var(--ui-font-mono);
}
.terminal-toolbar .spacer {
  flex: 1;
}
.terminal-toolbar button {
  min-height: 22px;
  padding: 0 7px;
  border: 1px solid var(--work-terminal-border-strong);
  border-radius: 4px;
  background: transparent;
  color: var(--work-terminal-muted);
  font: 9px var(--ui-font-mono);
  cursor: pointer;
}
.terminal-toolbar button:hover {
  border-color: var(--work-terminal-accent);
  background: var(--work-terminal-hover);
  color: var(--work-terminal-text);
}
.terminal-toolbar button:last-child:hover {
  border-color: var(--work-terminal-danger);
  color: var(--work-terminal-danger);
}

.terminal-output {
  min-height: 0;
  flex: 1;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  background:
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 3px,
      color-mix(in srgb, var(--work-terminal-text) 1.2%, transparent) 4px
    ),
    var(--work-terminal-bg);
  color: var(--work-terminal-text);
  font: 11px/1.5 var(--ui-font-mono);
  white-space: pre-wrap;
  /* 覆盖 body 的 user-select:none，允许用户用鼠标选中并复制终端输出。 */
  user-select: text;
  cursor: text;
}
.terminal-output::-webkit-scrollbar {
  width: 6px;
}
.terminal-output::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--work-terminal-scrollbar);
}

.terminal-input {
  display: flex;
  min-height: 34px;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border-top: 1px solid var(--work-terminal-border);
  background: var(--work-terminal-surface);
  color: var(--work-terminal-success);
}
.terminal-input:focus-within {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--work-terminal-success) 20%, transparent);
}
.terminal-input input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--work-terminal-text);
  font: 11px var(--ui-font-mono);
}
.terminal-input input::placeholder {
  color: var(--work-terminal-muted);
}

.terminal-empty {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  color: var(--work-terminal-muted);
  font-size: 10px;
}
</style>
