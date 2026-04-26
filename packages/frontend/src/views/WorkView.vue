<script setup lang="ts">
/**
 * WorkView — 工作模式页面 (IDE)
 *
 * 分三栏布局：文件树 + 编辑器(含 Tab) + 聊天侧栏。
 * 底部终端管理器 (P5 延后)。
 *
 * @see WorkModeView 拆分方案
 */
import { ref, onMounted, onErrorCaptured } from 'vue'
import { PixelIcon } from '../components/pixel'
import FileExplorer from '../components/ide/FileExplorer.vue'
import CodeEditor from '../components/ide/CodeEditor.vue'
import { ChatContainer } from '../components/chat'
import { useAgentStore } from '../stores'
import { ideApi } from '../api/modules/ideApi'
import type { FileNode } from '../components/ide/FileExplorer.vue'

defineOptions({ name: 'WorkView' })

const agentStore = useAgentStore()
const error = ref<string | null>(null)
const isReady = ref(false)

// ── 文件管理 ──

interface OpenFile extends FileNode {
  content: string
}

const openFiles = ref<OpenFile[]>([])
const currentFile = ref<OpenFile | null>(null)
const dirtyPaths = ref(new Set<string>())

/** 选中文件 → 打开 */
async function onFileSelected(node: FileNode) {
  const existing = openFiles.value.find((f) => f.path === node.path)
  if (existing) {
    currentFile.value = existing
    return
  }
  try {
    const res = await ideApi.readFile(node.path)
    const file: OpenFile = { ...node, content: res.data?.content ?? '' }
    openFiles.value.push(file)
    currentFile.value = file
  } catch {
    // ideApi 内部已通知
  }
}

/** 关闭标签 */
function closeTab(file: OpenFile) {
  if (dirtyPaths.value.has(file.path)) {
    if (!confirm(`"${file.name}" 有未保存的更改。确定要关闭吗？`)) return
    dirtyPaths.value.delete(file.path)
  }
  const idx = openFiles.value.indexOf(file)
  if (idx > -1) {
    openFiles.value.splice(idx, 1)
    if (currentFile.value === file) {
      currentFile.value = openFiles.value[openFiles.value.length - 1] ?? null
    }
  }
}

/** 内容变化 */
function onContentChange(content: string) {
  if (currentFile.value) {
    currentFile.value.content = content
    dirtyPaths.value.add(currentFile.value.path)
  }
}

/** 保存文件 */
async function saveFile(content: string) {
  if (!currentFile.value) return
  try {
    await ideApi.writeFile(currentFile.value.path, content)
    dirtyPaths.value.delete(currentFile.value.path)
  } catch {
    // 已通知
  }
}

/** 语言映射 */
function getLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    py: 'python',
    js: 'javascript',
    ts: 'typescript',
    vue: 'html',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    rs: 'rust',
    go: 'go',
    sh: 'shell',
    yaml: 'yaml',
    yml: 'yaml',
    sql: 'sql',
    xml: 'xml',
    toml: 'ini',
    ps1: 'powershell',
  }
  return map[ext] ?? 'plaintext'
}

// ── 错误处理 ──

onErrorCaptured((err) => {
  error.value = (err as Error).message
  return true
})

onMounted(async () => {
  await agentStore.fetchAgents()
  isReady.value = true
})
</script>

<template>
  <div class="flex w-full h-full overflow-hidden bg-white gap-1 p-1">
    <!-- 错误遮罩 -->
    <div
      v-if="error"
      class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white text-slate-400 font-bold"
    >
      <div class="max-w-[640px] border-2 border-rose-500 bg-white p-6">
        <div class="flex items-center gap-2 text-rose-500 text-lg font-black mb-4">
          <PixelIcon name="alert" size="md" />
          <span>组件错误</span>
        </div>
        <pre
          class="p-4 font-mono text-xs bg-slate-50 border border-slate-200 overflow-auto max-h-[300px] text-slate-500"
          >{{ error }}</pre
        >
      </div>
    </div>

    <!-- 加载 -->
    <div
      v-if="!isReady && !error"
      class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white text-slate-400 font-bold"
    >
      <PixelIcon name="refresh" size="lg" animation="spin" />
      <span>正在初始化工作环境...</span>
    </div>

    <template v-if="isReady && !error">
      <!-- 左侧: 文件树 -->
      <aside class="w-64 flex flex-col border-2 border-slate-200 bg-white overflow-hidden">
        <div
          class="px-4 py-3 flex items-center gap-2 border-b-2 border-slate-200 text-[13px] font-bold text-sky-500"
        >
          <PixelIcon name="folder" size="sm" />
          <span>项目工程</span>
        </div>
        <FileExplorer @file-selected="onFileSelected" />
      </aside>

      <!-- 中间: 编辑器 -->
      <div class="flex-1 flex flex-col border-2 border-slate-200 bg-white overflow-hidden min-w-0">
        <!-- 顶部导航 -->
        <header class="h-10 px-4 flex items-center border-b border-slate-200 flex-shrink-0">
          <div
            class="flex items-center gap-1.5 px-3 py-1 border border-sky-200 bg-sky-50 text-[10px] font-bold text-sky-500 uppercase"
          >
            <div class="w-1.5 h-1.5 bg-sky-500 wv-pulse" />
            <span>专注模式</span>
          </div>
        </header>

        <!-- 编辑器 Tab -->
        <div
          class="flex overflow-x-auto border-b border-slate-200 bg-slate-50 flex-shrink-0 wv-tabs-scrollbar"
        >
          <div
            v-for="file in openFiles"
            :key="file.path"
            :class="[
              'flex items-center gap-1.5 px-3 py-2 text-xs font-bold cursor-pointer border-r border-slate-200 transition-all min-w-[100px] max-w-[180px] relative',
              currentFile?.path === file.path
                ? 'bg-white text-sky-500 border-b-2 border-b-sky-500'
                : 'text-slate-400 hover:bg-white hover:text-slate-500',
            ]"
            @click="currentFile = file"
          >
            <PixelIcon name="code" size="xs" />
            <span class="truncate flex-1">{{ file.name }}</span>
            <div v-if="dirtyPaths.has(file.path)" class="w-1.5 h-1.5 bg-amber-500 flex-shrink-0" />
            <button
              class="p-0.5 bg-none border-none text-slate-400 cursor-pointer opacity-0 transition-all hover:text-rose-500 group-hover:opacity-100"
              :class="{ 'opacity-100': currentFile?.path === file.path }"
              @click.stop="closeTab(file)"
            >
              <PixelIcon name="close" size="xs" />
            </button>
          </div>
        </div>

        <!-- 编辑器内容 -->
        <div class="flex-1 overflow-hidden">
          <CodeEditor
            v-if="currentFile"
            :key="currentFile.path"
            :initial-content="currentFile.content"
            :language="getLanguage(currentFile.name)"
            :file-path="currentFile.path"
            @save="saveFile"
            @change="onContentChange"
          />
          <div v-else class="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
            <PixelIcon name="code" size="3xl" />
            <p class="text-sm font-bold text-slate-500">选择一个文件以开始编辑</p>
            <p class="text-xs">使用左侧资源管理器浏览文件</p>
          </div>
        </div>
      </div>

      <!-- 右侧: 聊天 -->
      <aside class="w-[380px] border-2 border-slate-200 bg-white overflow-hidden">
        <ChatContainer
          v-if="agentStore.currentAgent"
          :agent-id="agentStore.currentAgent.id"
          :agent-name="agentStore.currentAgent.name"
        />
      </aside>
    </template>
  </div>
</template>

<style scoped>
/* 脉冲动画 */
@keyframes wv-pulse-anim {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.wv-pulse {
  animation: wv-pulse-anim 2s infinite;
}

/* Tab 横向滚动条 */
.wv-tabs-scrollbar::-webkit-scrollbar {
  height: 2px;
}

.wv-tabs-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
}
</style>
