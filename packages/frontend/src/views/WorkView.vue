<script setup lang="ts">
/**
 * WorkView — 工作模式页面 (IDE)
 *
 * 分三栏布局：文件树 + 编辑器(含 Tab) + 聊天侧栏。
 * 底部终端管理器 (P5 延后)。
 *
 * @see 06_FILE_SIZE_LIMITS.md §2.3 — WorkModeView 拆分方案
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
    py: 'python', js: 'javascript', ts: 'typescript', vue: 'html',
    html: 'html', css: 'css', json: 'json', md: 'markdown',
    rs: 'rust', go: 'go', sh: 'shell', yaml: 'yaml', yml: 'yaml',
    sql: 'sql', xml: 'xml', toml: 'ini', ps1: 'powershell',
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
  <div class="work-view">
    <!-- 错误遮罩 -->
    <div v-if="error" class="wv-error-mask">
      <div class="wv-error-card">
        <div class="wv-error-header">
          <PixelIcon name="alert" size="md" />
          <span>组件错误</span>
        </div>
        <pre class="wv-error-pre">{{ error }}</pre>
      </div>
    </div>

    <!-- 加载 -->
    <div v-if="!isReady && !error" class="wv-loading">
      <PixelIcon name="refresh" size="lg" animation="spin" />
      <span>正在初始化工作环境...</span>
    </div>

    <template v-if="isReady && !error">
      <!-- 左侧: 文件树 -->
      <aside class="wv-sidebar">
        <div class="wv-sidebar-header">
          <PixelIcon name="folder" size="sm" />
          <span>项目工程</span>
        </div>
        <FileExplorer @file-selected="onFileSelected" />
      </aside>

      <!-- 中间: 编辑器 -->
      <div class="wv-editor-area">
        <!-- 顶部导航 -->
        <header class="wv-topbar">
          <div class="wv-topbar-left">
            <div class="wv-mode-badge">
              <div class="wv-mode-dot" />
              <span>专注模式</span>
            </div>
          </div>
        </header>

        <!-- 编辑器 Tab -->
        <div class="wv-tabs">
          <div
            v-for="file in openFiles"
            :key="file.path"
            :class="['wv-tab', { 'wv-tab-active': currentFile?.path === file.path }]"
            @click="currentFile = file"
          >
            <PixelIcon name="code" size="xs" />
            <span class="wv-tab-name">{{ file.name }}</span>
            <div v-if="dirtyPaths.has(file.path)" class="wv-tab-dirty" />
            <button class="wv-tab-close" @click.stop="closeTab(file)">
              <PixelIcon name="close" size="xs" />
            </button>
          </div>
        </div>

        <!-- 编辑器内容 -->
        <div class="wv-editor-body">
          <CodeEditor
            v-if="currentFile"
            :key="currentFile.path"
            :initial-content="currentFile.content"
            :language="getLanguage(currentFile.name)"
            :file-path="currentFile.path"
            @save="saveFile"
            @change="onContentChange"
          />
          <div v-else class="wv-editor-empty">
            <PixelIcon name="code" size="3xl" />
            <p class="wv-editor-empty-title">选择一个文件以开始编辑</p>
            <p class="wv-editor-empty-sub">使用左侧资源管理器浏览文件</p>
          </div>
        </div>
      </div>

      <!-- 右侧: 聊天 -->
      <aside class="wv-chat">
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
.work-view {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-primary);
  gap: 4px;
  padding: 4px;
}

/* 错误/加载 */
.wv-error-mask,
.wv-loading {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  background: var(--color-bg-primary);
  color: var(--color-text-muted);
  font-weight: 700;
}
.wv-error-card {
  max-width: 640px;
  border: 2px solid var(--color-red-500);
  background: var(--color-bg-primary);
  padding: 24px;
}
.wv-error-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-red-500);
  font-size: 18px;
  font-weight: 800;
  margin-bottom: 16px;
}
.wv-error-pre {
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  overflow: auto;
  max-height: 300px;
  color: var(--color-text-secondary);
}

/* 侧边栏 */
.wv-sidebar {
  width: 256px;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
}
.wv-sidebar-header {
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 2px solid var(--color-border);
  font-size: 13px;
  font-weight: 700;
  color: var(--color-blue-500);
}

/* 编辑器区 */
.wv-editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
  min-width: 0;
}
.wv-topbar {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}
.wv-topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.wv-mode-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: 1px solid var(--color-blue-200);
  background: var(--color-blue-50);
  font-size: 10px;
  font-weight: 700;
  color: var(--color-blue-500);
  text-transform: uppercase;
}
.wv-mode-dot {
  width: 6px;
  height: 6px;
  background: var(--color-blue-500);
  animation: pulse 2s infinite;
}

/* Tab 栏 */
.wv-tabs {
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
}
.wv-tabs::-webkit-scrollbar { height: 2px; }
.wv-tabs::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

.wv-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
  cursor: pointer;
  border-right: 1px solid var(--color-border);
  transition: all 0.15s;
  min-width: 100px;
  max-width: 180px;
  position: relative;
}
.wv-tab:hover {
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
}
.wv-tab-active {
  background: var(--color-bg-primary);
  color: var(--color-blue-500);
  border-bottom: 2px solid var(--color-blue-500);
}
.wv-tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.wv-tab-dirty {
  width: 6px;
  height: 6px;
  background: var(--color-yellow-500);
  flex-shrink: 0;
}
.wv-tab-close {
  padding: 2px;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
}
.wv-tab:hover .wv-tab-close {
  opacity: 1;
}
.wv-tab-close:hover {
  color: var(--color-red-500);
}

/* 编辑器主体 */
.wv-editor-body {
  flex: 1;
  overflow: hidden;
}
.wv-editor-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--color-text-muted);
}
.wv-editor-empty-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.wv-editor-empty-sub {
  font-size: 12px;
}

/* 聊天侧栏 */
.wv-chat {
  width: 380px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
</style>
