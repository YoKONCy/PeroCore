<script setup lang="ts">
import { t as __t } from '../../i18n/index'

/** 将 PTY 输出作为终端协议解析，保留光标、清屏、颜色与跨批次控制序列。 */
import { onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  output: string
  outputOffset?: number
  cols: number
  rows: number
  backend: 'pty' | 'pipe'
  running: boolean
}>()
const emit = defineEmits<{
  data: [value: string]
  resize: [cols: number, rows: number]
}>()
const host = ref<HTMLDivElement | null>(null)
let terminal: Terminal | undefined
let fit: FitAddon | undefined
let resizeObserver: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
let frame = 0
let consumed = 0
let replaying = false
let disposed = false

function updateTheme(): void {
  if (!host.value || !terminal) return
  const style = getComputedStyle(host.value)
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const background = color('--work-terminal-bg', '#0b1020')
  const hasWallpaper =
    host.value.closest('.main-view-root')?.getAttribute('data-app-background') === 'active'
  const foreground = color('--work-terminal-text', '#cbd5e1')
  const red = color('--work-terminal-danger', '#fb7185')
  const green = color('--work-terminal-success', '#34d399')
  const yellow = color('--ui-warning', '#fbbf24')
  const blue = color('--work-terminal-accent', '#38bdf8')
  const magenta = color('--ui-accent-purple', '#a78bfa')
  terminal.options.theme = {
    // 保留 RGB 分量供终端计算文字对比度，Alpha 置零让底层材质透出。
    background: hasWallpaper && /^#[\da-f]{6}$/i.test(background) ? `${background}00` : background,
    foreground,
    cursor: blue,
    selectionBackground: color('--ui-accent-sky-soft', '#334155'),
    black: hasWallpaper ? '#111827' : background,
    brightBlack: color('--work-terminal-muted', '#64748b'),
    red,
    brightRed: red,
    green,
    brightGreen: green,
    yellow,
    brightYellow: yellow,
    blue,
    brightBlue: blue,
    magenta,
    brightMagenta: magenta,
    cyan: blue,
    brightCyan: blue,
    white: foreground,
    brightWhite: foreground,
  }
}

function scheduleFit(): void {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    if (disposed || replaying || !host.value || !terminal || !fit) return
    if (host.value.clientWidth === 0 || host.value.clientHeight === 0) return
    // 隐藏标签首次显示时重新测量字体，避免沿用零尺寸的字符网格。
    terminal.resize(terminal.cols, terminal.rows)
    const dimensions = fit.proposeDimensions()
    if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows))
      return
    const cols = Math.max(2, Math.min(500, dimensions.cols))
    const rows = Math.max(1, Math.min(200, dimensions.rows))
    if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows)
  })
}

function appendOutput(output: string): void {
  if (!terminal || disposed) return
  const offset = props.outputOffset ?? 0
  if (consumed < offset || consumed > offset + output.length) {
    terminal.reset()
    consumed = offset
  }
  const delta = output.slice(consumed - offset)
  consumed = offset + output.length
  if (delta) terminal.write(delta)
}

watch(
  () => [props.output, props.outputOffset],
  () => appendOutput(props.output),
)
watch(
  () => props.running,
  (running) => {
    if (terminal) terminal.options.disableStdin = !running || props.backend === 'pipe'
  },
)

onMounted(() => {
  if (!host.value) return
  terminal = new Terminal({
    cols: props.cols,
    rows: props.rows,
    fontFamily:
      getComputedStyle(host.value).getPropertyValue('--ui-font-mono').trim() ||
      'Consolas, monospace',
    fontSize: 11,
    lineHeight: 1.5,
    scrollback: 5000,
    minimumContrastRatio: 4.5,
    allowTransparency: true,
    convertEol: props.backend === 'pipe',
    disableStdin: !props.running || props.backend === 'pipe',
    // 终端中的链接不触发浏览器默认的原生确认框。
    linkHandler: { activate: () => undefined },
    logLevel: 'off',
  })
  fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(host.value)
  updateTheme()
  terminal.onData((data) => {
    // 历史回放只还原画面，不能把旧的设备查询响应重新写回 Shell。
    if (!replaying && props.running && !disposed) emit('data', data)
  })
  terminal.onResize(({ cols, rows }) => emit('resize', cols, rows))
  terminal.attachCustomKeyEventHandler((event) => {
    // 有选区时保留 Ctrl+C 复制行为，不把复制变成对进程的中断。
    return !(event.ctrlKey && event.key.toLowerCase() === 'c' && terminal?.hasSelection())
  })
  consumed = (props.outputOffset ?? 0) + props.output.length
  if (props.output) {
    replaying = true
    terminal.write(props.output, () => {
      replaying = false
      scheduleFit()
    })
  }
  resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(host.value)
  themeObserver = new MutationObserver(() => {
    updateTheme()
    scheduleFit()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class', 'style'],
  })
  const mainRoot = host.value.closest('.main-view-root')
  if (mainRoot)
    themeObserver.observe(mainRoot, {
      attributes: true,
      attributeFilter: ['data-app-background', 'style'],
    })
  void document.fonts.ready.then(() => {
    if (!disposed) scheduleFit()
  })
  scheduleFit()
})

onActivated(() => {
  updateTheme()
  scheduleFit()
})
onBeforeUnmount(() => {
  disposed = true
  cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  terminal?.dispose()
  terminal = undefined
})
</script>

<template>
  <div
    ref="host"
    class="terminal-screen"
    role="region"
    :aria-label="__t('ui.workspace', '终端输出')"
  />
</template>

<style scoped>
.terminal-screen {
  position: relative;
  min-width: 0;
  overflow: hidden;
}
.terminal-screen :deep(.xterm) {
  height: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  user-select: text;
}
.terminal-screen :deep(.xterm-viewport) {
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--work-terminal-scrollbar) transparent;
}
</style>
