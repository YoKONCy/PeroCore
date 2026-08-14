<script setup lang="ts">
defineOptions({ name: 'WorkspaceTab' })
/**
 * WorkspaceTab — Agent 强绑定的协作工作台。
 *
 * 使用统一的交互画布与一体化面板承载资源栏、编辑器、终端和 Agent 协作栏。
 * 所有文件与终端上下文始终绑定当前 Agent 的 workspace，不允许跨角色串用。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { storeToRefs } from 'pinia'
import { PixelIcon, PButton } from '../../pixel'
import { ChatContainer } from '../../chat'
import { ApprovalCard } from '../../approval'
import WorkspaceTree from '../../workspace/WorkspaceTree.vue'
import WorkspaceTerminal from '../../workspace/WorkspaceTerminal.vue'
import WorkspaceSessionDrawer from '../../workspace/WorkspaceSessionDrawer.vue'
import {
  useAgentStore,
  useThreadStore,
  useApprovalStore,
  useNotificationStore,
} from '../../../stores'
import { workspaceApi, type WorkspaceFileNode } from '../../../api/modules/approvalsApi'
import { getApiBaseUrl, isElectronRuntime } from '../../../api/transport'
import { invoke } from '../../../utils/ipcAdapter'

interface OpenFile {
  path: string
  name: string
  content: string
  hash: string
  dirty: boolean
  truncated: boolean
}

const agentStore = useAgentStore()
const threadStore = useThreadStore()
const approvalStore = useApprovalStore()
const notification = useNotificationStore()
const { currentAgent } = storeToRefs(agentStore)

const openFiles = ref<OpenFile[]>([])
const workspaceTreeRef = ref<InstanceType<typeof WorkspaceTree> | null>(null)
const activePath = ref('')
const activeTerminalId = ref('')
const isExplorerCollapsed = ref(false)
const isCopilotCollapsed = ref(false)
const isTerminalCollapsed = ref(false)
const isTerminalMaximized = ref(false)
const isApprovalQueueExpanded = ref(true)
const isSessionDrawerOpen = ref(false)
const terminalHeight = ref(248)
const copilotWidth = ref(480)
const explorerWidth = ref(248)

// 切换 Agent 时按角色保留未保存缓冲，避免异步全局切换直接丢稿。
const buffersByAgent = new Map<string, { files: OpenFile[]; activePath: string }>()

const activeFile = computed(
  () => openFiles.value.find((file) => file.path === activePath.value) ?? null,
)
const threadId = computed(
  () => threadStore.threadId || `workspace-${currentAgent.value?.id ?? 'pero'}`,
)
const pendingApprovals = computed(() => approvalStore.forAgent(currentAgent.value?.id ?? ''))
const agentInitial = computed(() => currentAgent.value?.name?.trim().charAt(0).toUpperCase() || '?')
const agentAvatarUrl = computed(() => {
  const avatarUrl = currentAgent.value?.avatarUrl
  return avatarUrl ? `${getApiBaseUrl()}${avatarUrl}` : ''
})
const activeFileExtension = computed(() => {
  const name = activeFile.value?.name ?? ''
  const extension = name.includes('.') ? name.split('.').pop() : ''
  return extension?.toUpperCase() || 'TEXT'
})

async function ensureAgent(): Promise<void> {
  if (!agentStore.agents.length) await agentStore.fetchAgents()
}

async function revealWorkspace(): Promise<void> {
  if (!currentAgent.value) return
  try {
    const session = { agentId: currentAgent.value.id, threadId: threadId.value }
    // Electron 必须由主进程在当前桌面会话中调用 shell.openPath；Daemon 可能运行在独立服务会话中。
    const response = await workspaceApi.reveal(session, !isElectronRuntime())
    if (!response.data) throw new Error('未能解析工作区路径')
    if (isElectronRuntime()) await invoke('open-local-path', response.data.path)
    notification.toast(
      isElectronRuntime() ? '已在 Windows 资源管理器中打开工作区' : '已请求执行节点打开工作区',
      { type: 'success' },
    )
  } catch (error) {
    notification.toast(error instanceof Error ? error.message : '无法打开工作区目录', {
      type: 'error',
    })
  }
}

async function openFile(node: WorkspaceFileNode, forceReload = false): Promise<void> {
  if (!currentAgent.value || node.type !== 'file') return
  const existing = openFiles.value.find((file) => file.path === node.path)
  if (existing && !forceReload) {
    activePath.value = node.path
    return
  }
  if (existing?.dirty && forceReload) {
    // Agent 修改了用户仍在编辑的未保存文件时，不静默覆盖本地缓冲。
    notification.toast(
      `“${existing.name}”已被 Agent 修改，但本地有未保存内容，请手动决定是否重载`,
      { type: 'warning' },
    )
    activePath.value = node.path
    return
  }
  const res = await workspaceApi.readFile(
    { agentId: currentAgent.value.id, threadId: threadId.value },
    { path: node.path, limit: 128_000 },
  )
  if (!res.data) return
  const loaded: OpenFile = {
    path: node.path,
    name: node.name,
    content: res.data.content,
    hash: res.data.hash,
    dirty: false,
    truncated: res.data.truncated,
  }
  if (existing) Object.assign(existing, loaded)
  else openFiles.value.push(loaded)
  activePath.value = node.path
}

function updateContent(event: Event): void {
  if (!activeFile.value || activeFile.value.truncated) return
  activeFile.value.content = (event.target as HTMLTextAreaElement).value
  activeFile.value.dirty = true
}

async function save(): Promise<void> {
  const file = activeFile.value
  if (!file || !currentAgent.value) return
  if (file.truncated) {
    notification.toast('大文件当前为只读预览，禁止覆盖保存', { type: 'error' })
    return
  }
  try {
    const res = await workspaceApi.writeFile(
      { agentId: currentAgent.value.id, threadId: threadId.value },
      { path: file.path, content: file.content, expectedHash: file.hash },
    )
    file.hash = res.data?.hash ?? file.hash
    file.dirty = false
    notification.toast('文件已安全保存', { type: 'success' })
  } catch {
    notification.toast('保存失败：文件可能已被外部修改', { type: 'error' })
  }
}

function close(file: OpenFile): void {
  if (file.dirty && !confirm(`“${file.name}”尚未保存，确定关闭吗？`)) return
  openFiles.value = openFiles.value.filter((item) => item.path !== file.path)
  if (activePath.value === file.path) activePath.value = openFiles.value.at(-1)?.path ?? ''
}

/** 文件树重命名后同步已打开标签，保留编辑缓冲与当前焦点。 */
function handleFileRenamed(payload: { oldPath: string; newPath: string; name: string }): void {
  const file = openFiles.value.find((item) => item.path === payload.oldPath)
  if (file) {
    file.path = payload.newPath
    file.name = payload.name
  }
  if (activePath.value === payload.oldPath) activePath.value = payload.newPath
}

/** 文件树删除后关闭对应编辑标签。 */
function handleFileDeleted(path: string): void {
  const deleted = openFiles.value.find((item) => item.path === path)
  if (!deleted) return
  openFiles.value = openFiles.value.filter((item) => item.path !== path)
  if (activePath.value === path) activePath.value = openFiles.value.at(-1)?.path ?? ''
}

interface WorkspaceFileChangedDetail {
  agentId: string
  threadId: string
  path: string
  operation: 'create' | 'overwrite' | 'append' | 'edit' | string
}

/**
 * 消费聊天工具成功事件：刷新资源树；新建文件时自动在编辑器打开。
 * 监听器只在 WorkspaceTab 挂载期间存在，因此不会在其他 Tab 抢焦点。
 */
async function handleWorkspaceFileChanged(event: Event): Promise<void> {
  const detail = (event as CustomEvent<WorkspaceFileChangedDetail>).detail
  if (
    !currentAgent.value ||
    detail.agentId !== currentAgent.value.id ||
    detail.threadId !== threadId.value
  )
    return
  await workspaceTreeRef.value?.refresh()
  const name = detail.path.replaceAll('\\', '/').split('/').pop() || detail.path
  if (detail.operation === 'create') {
    isExplorerCollapsed.value = false
    await openFile({ path: detail.path, name, type: 'file' }, true)
  } else {
    const existing = openFiles.value.find((file) => file.path === detail.path)
    if (existing) await openFile({ path: detail.path, name, type: 'file' }, true)
  }
}

interface WorkspaceRewoundDetail {
  threadId: string
  files: Array<{
    path: string
    action: 'delete_created' | 'restore_edited' | 'restore_deleted' | 'restore_renamed'
  }>
}

/** 回滚完成后同步资源树与编辑器标签。 */
async function handleWorkspaceRewound(event: Event): Promise<void> {
  const detail = (event as CustomEvent<WorkspaceRewoundDetail>).detail
  if (detail.threadId !== threadId.value) return
  await workspaceTreeRef.value?.refresh()
  for (const change of detail.files) {
    if (change.action === 'delete_created') {
      const file = openFiles.value.find((item) => item.path === change.path)
      if (file?.dirty) {
        notification.toast(`“${file.name}”已被回滚删除，但本地有未保存缓冲，标签暂时保留`, {
          type: 'warning',
        })
        continue
      }
      handleFileDeleted(change.path)
      continue
    }
    const file = openFiles.value.find((item) => item.path === change.path)
    if (file) {
      const name = change.path.replaceAll('\\', '/').split('/').pop() || change.path
      await openFile({ path: change.path, name, type: 'file' }, true)
    }
  }
}

function expandApprovalQueue(): void {
  isCopilotCollapsed.value = false
  isApprovalQueueExpanded.value = true
}

/** 使用 Pointer Events 调整桌面工作台分栏，避免绑定全局鼠标事件后遗留监听器。 */
function toggleTerminalMaximized(): void {
  isTerminalMaximized.value = !isTerminalMaximized.value
  isTerminalCollapsed.value = false
}

function toggleTerminalCollapsed(): void {
  isTerminalCollapsed.value = !isTerminalCollapsed.value
  isTerminalMaximized.value = false
}

function startResize(event: PointerEvent, target: 'explorer' | 'copilot' | 'terminal'): void {
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startY = event.clientY
  const startExplorer = explorerWidth.value
  const startCopilot = copilotWidth.value
  const startTerminal = terminalHeight.value
  handle.setPointerCapture(event.pointerId)

  const move = (pointer: PointerEvent) => {
    if (target === 'explorer')
      explorerWidth.value = Math.min(360, Math.max(200, startExplorer + pointer.clientX - startX))
    if (target === 'copilot')
      copilotWidth.value = Math.min(640, Math.max(400, startCopilot + startX - pointer.clientX))
    if (target === 'terminal')
      terminalHeight.value = Math.min(520, Math.max(150, startTerminal + startY - pointer.clientY))
  }
  const stop = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', stop)
    handle.removeEventListener('pointercancel', stop)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', stop)
  handle.addEventListener('pointercancel', stop)
}

watch(
  () => currentAgent.value?.id,
  (nextAgentId, previousAgentId) => {
    // Agent 切换时按角色封存编辑缓冲；返回该 Agent 后原样恢复，绝不跨 workspace 展示路径。
    if (previousAgentId)
      buffersByAgent.set(previousAgentId, { files: openFiles.value, activePath: activePath.value })
    const restored = nextAgentId ? buffersByAgent.get(nextAgentId) : undefined
    openFiles.value = restored?.files ?? []
    activePath.value = restored?.activePath ?? ''
    activeTerminalId.value = ''
  },
)

onBeforeRouteLeave(() => {
  if (openFiles.value.some((file) => file.dirty))
    return confirm('工作区仍有未保存文件，确定离开吗？')
  return true
})

onMounted(() => {
  void ensureAgent()
  approvalStore.startPolling()
  window.addEventListener('infos:workspace-file-changed', handleWorkspaceFileChanged)
  window.addEventListener('infos:workspace-rewound', handleWorkspaceRewound)
})

onBeforeUnmount(() => {
  window.removeEventListener('infos:workspace-file-changed', handleWorkspaceFileChanged)
  window.removeEventListener('infos:workspace-rewound', handleWorkspaceRewound)
})
</script>

<template>
  <div v-if="currentAgent" class="workspace-tab">
    <div class="workspace-panel">
      <!-- 工作台上下文栏：集中呈现 Agent、当前文件和可见区域开关。 -->
      <header class="workspace-commandbar">
        <div class="workspace-agent">
          <div class="workspace-agent__avatar">
            <img v-if="agentAvatarUrl" :src="agentAvatarUrl" :alt="currentAgent.name" />
            <span v-else>{{ agentInitial }}</span>
          </div>
          <div class="workspace-agent__identity">
            <div class="workspace-agent__title">
              <strong>{{ currentAgent.name }}</strong>
              <span class="workspace-label">WORKSPACE</span>
            </div>
            <span class="workspace-agent__status">
              <i />
              专属工作空间已连接
            </span>
          </div>
        </div>

        <div class="workspace-context" :title="activeFile?.path">
          <PixelIcon :name="activeFile ? 'code' : 'folder'" size="xs" />
          <span>{{ activeFile?.path || '选择文件开始协作' }}</span>
          <i v-if="activeFile?.dirty" class="workspace-dirty-dot" title="尚未保存" />
          <span v-if="activeFile?.truncated" class="workspace-readonly-badge">只读预览</span>
        </div>

        <div class="workspace-actions">
          <button
            v-if="pendingApprovals.length"
            class="workspace-action workspace-action--approval"
            title="展开待审批队列"
            @click="expandApprovalQueue"
          >
            <PixelIcon name="alert" size="xs" />
            <span>{{ pendingApprovals.length }}</span>
          </button>
          <button
            class="workspace-action"
            :class="{ active: !isExplorerCollapsed }"
            title="切换资源栏"
            @click="isExplorerCollapsed = !isExplorerCollapsed"
          >
            <PixelIcon name="folder" size="sm" />
          </button>
          <button
            class="workspace-action"
            :class="{ active: !isTerminalCollapsed }"
            title="切换终端面板"
            @click="isTerminalCollapsed = !isTerminalCollapsed"
          >
            <PixelIcon name="terminal" size="sm" />
          </button>
          <button
            class="workspace-action"
            :class="{ active: !isCopilotCollapsed }"
            title="切换 Agent 协作栏"
            @click="isCopilotCollapsed = !isCopilotCollapsed"
          >
            <PixelIcon name="chat" size="sm" />
          </button>
        </div>
      </header>

      <div class="workspace-body">
        <!-- 左侧资源栏。折叠后保留可恢复的图标轨道。 -->
        <aside
          class="workspace-explorer"
          :class="{ 'workspace-explorer--collapsed': isExplorerCollapsed }"
          :style="isExplorerCollapsed ? undefined : { width: `${explorerWidth}px` }"
        >
          <button
            v-if="isExplorerCollapsed"
            class="workspace-rail-button"
            title="展开资源栏"
            @click="isExplorerCollapsed = false"
          >
            <PixelIcon name="folder" size="sm" />
          </button>
          <template v-else>
            <WorkspaceTree
              ref="workspaceTreeRef"
              :agent-id="currentAgent.id"
              :agent-name="currentAgent.name"
              :thread-id="threadId"
              @select="openFile"
              @renamed="handleFileRenamed"
              @deleted="handleFileDeleted"
            />
            <div
              class="workspace-resizer workspace-resizer--vertical"
              @pointerdown="startResize($event, 'explorer')"
            />
          </template>
        </aside>

        <!-- 中部始终是第一视觉焦点：文件标签、编辑器和底部工作面板。 -->
        <main class="workspace-center">
          <div class="editor-tabs" role="tablist" aria-label="已打开文件">
            <button
              v-for="file in openFiles"
              :key="file.path"
              role="tab"
              :aria-selected="file.path === activePath"
              :class="{ active: file.path === activePath }"
              @click="activePath = file.path"
            >
              <PixelIcon name="code" size="xs" />
              <span>{{ file.name }}</span>
              <i v-if="file.dirty" title="尚未保存" />
              <b title="关闭文件" @click.stop="close(file)">×</b>
            </button>
            <span v-if="!openFiles.length" class="editor-tabs__empty">没有打开的文件</span>
          </div>

          <section
            class="editor-area"
            :class="{ 'editor-area--terminal-maximized': isTerminalMaximized }"
          >
            <template v-if="activeFile && !isTerminalMaximized">
              <div class="editor-toolbar">
                <div class="editor-breadcrumb">
                  <PixelIcon name="folder" size="xs" />
                  <span>{{ activeFile.path }}</span>
                </div>
                <span v-if="activeFile.truncated" class="editor-warning">
                  文件过大，仅载入前 128K 字符
                </span>
                <PButton
                  size="sm"
                  :disabled="!activeFile.dirty || activeFile.truncated"
                  @click="save"
                >
                  {{ activeFile.truncated ? '只读预览' : '保存' }}
                </PButton>
              </div>
              <div class="editor-surface">
                <div class="editor-gutter" aria-hidden="true">1</div>
                <textarea
                  :value="activeFile.content"
                  :readonly="activeFile.truncated"
                  spellcheck="false"
                  aria-label="文件编辑器"
                  @input="updateContent"
                  @keydown.ctrl.s.prevent="save"
                />
              </div>
              <footer class="editor-statusbar">
                <span>{{ activeFile.dirty ? '已修改' : '已保存' }}</span>
                <span class="editor-statusbar__spacer" />
                <span>UTF-8</span>
                <span>LF</span>
                <span>{{ activeFileExtension }}</span>
              </footer>
            </template>

            <div v-else-if="!isTerminalMaximized" class="editor-empty">
              <div class="editor-empty__mark"><PixelIcon name="code" size="2xl" /></div>
              <strong>打开文件，开始与 {{ currentAgent.name }} 协作</strong>
              <span>从左侧资源栏选择文件，当前上下文会自动同步到 Agent 协作栏。</span>
              <button @click="revealWorkspace">
                <PixelIcon name="folder" size="xs" />
                在文件管理器中打开
              </button>
            </div>
          </section>

          <section
            class="terminal-area"
            :class="{
              'terminal-area--collapsed': isTerminalCollapsed,
              'terminal-area--maximized': isTerminalMaximized,
            }"
            :style="
              isTerminalCollapsed || isTerminalMaximized
                ? undefined
                : { height: `${terminalHeight}px` }
            "
          >
            <div
              v-if="!isTerminalCollapsed && !isTerminalMaximized"
              class="workspace-resizer workspace-resizer--horizontal"
              @pointerdown="startResize($event, 'terminal')"
            />
            <div class="terminal-panelbar" @dblclick="isTerminalCollapsed = !isTerminalCollapsed">
              <div class="terminal-panelbar__title">
                <PixelIcon name="terminal" size="xs" />
                <strong>终端</strong>
                <span v-if="activeTerminalId">已连接</span>
              </div>
              <div class="terminal-panelbar__actions">
                <button title="最大化终端" @click="toggleTerminalMaximized">
                  <PixelIcon
                    :name="isTerminalMaximized ? 'chevron-down' : 'chevron-up'"
                    size="xs"
                  />
                </button>
                <button
                  :title="isTerminalCollapsed ? '展开终端' : '收起终端'"
                  @click="toggleTerminalCollapsed"
                >
                  <PixelIcon
                    :name="isTerminalCollapsed ? 'chevron-up' : 'chevron-down'"
                    size="xs"
                  />
                </button>
              </div>
            </div>
            <WorkspaceTerminal
              v-if="!isTerminalCollapsed"
              :agent-id="currentAgent.id"
              :thread-id="threadId"
              @active="activeTerminalId = $event"
            />
          </section>
        </main>

        <!-- 右侧 Agent Copilot：审批队列与聊天分层呈现，互不覆盖。 -->
        <aside
          class="workspace-copilot"
          :class="{ 'workspace-copilot--collapsed': isCopilotCollapsed }"
          :style="isCopilotCollapsed ? undefined : { width: `${copilotWidth}px` }"
        >
          <template v-if="isCopilotCollapsed">
            <button
              class="copilot-rail-avatar"
              :title="`切换会话（当前：${currentAgent.name}）`"
              @click="isSessionDrawerOpen = true"
            >
              <img v-if="agentAvatarUrl" :src="agentAvatarUrl" :alt="currentAgent.name" />
              <span v-else>{{ agentInitial }}</span>
              <i v-if="pendingApprovals.length">{{ pendingApprovals.length }}</i>
            </button>
            <button
              class="workspace-rail-button"
              title="展开协作栏"
              @click="isCopilotCollapsed = false"
            >
              <PixelIcon name="chat" size="sm" />
            </button>
          </template>
          <template v-else>
            <div
              class="workspace-resizer workspace-resizer--copilot"
              @pointerdown="startResize($event, 'copilot')"
            />
            <header class="copilot-header">
              <button
                class="copilot-header__main"
                title="切换会话"
                @click="isSessionDrawerOpen = true"
              >
                <div class="copilot-header__avatar">
                  <img v-if="agentAvatarUrl" :src="agentAvatarUrl" :alt="currentAgent.name" />
                  <span v-else>{{ agentInitial }}</span>
                </div>
                <div class="copilot-header__identity">
                  <strong>与 {{ currentAgent.name }} 协作</strong>
                  <span>AGENT COPILOT · 点击切换会话</span>
                </div>
                <PixelIcon name="chevron-down" size="xs" class="copilot-header__switch" />
              </button>
              <button
                class="copilot-header__collapse"
                title="收起协作栏"
                @click="isCopilotCollapsed = true"
              >
                <PixelIcon name="chevron-right" size="xs" />
              </button>
            </header>

            <div v-if="activePath || activeTerminalId" class="copilot-context">
              <span class="copilot-context__label">当前上下文</span>
              <span v-if="activePath" class="context-chip">
                <PixelIcon name="code" size="xs" />
                {{ activeFile?.name || activePath }}
              </span>
              <span v-if="activeTerminalId" class="context-chip">
                <PixelIcon name="terminal" size="xs" />
                当前终端
              </span>
            </div>

            <section
              v-if="pendingApprovals.length"
              class="approval-queue"
              :class="{ 'approval-queue--expanded': isApprovalQueueExpanded }"
            >
              <button
                class="approval-queue__header"
                @click="isApprovalQueueExpanded = !isApprovalQueueExpanded"
              >
                <span>
                  <PixelIcon name="alert" size="xs" />
                  <strong>安全确认</strong>
                  <i>{{ pendingApprovals.length }}</i>
                </span>
                <PixelIcon
                  :name="isApprovalQueueExpanded ? 'chevron-up' : 'chevron-down'"
                  size="xs"
                />
              </button>
              <div v-if="isApprovalQueueExpanded" class="approval-queue__body">
                <button
                  class="approval-queue__collapse"
                  title="收起待审批队列"
                  @click="isApprovalQueueExpanded = false"
                >
                  <PixelIcon name="chevron-up" size="xs" />
                  收起待审批队列
                </button>
                <ApprovalCard
                  v-for="request in pendingApprovals"
                  :key="request.id"
                  :request="request"
                  :loading="approvalStore.isResolving[request.id]"
                  compact
                  @resolve="
                    (decision, message) => approvalStore.resolve(request.id, decision, message)
                  "
                />
              </div>
            </section>

            <div class="copilot-chat">
              <ChatContainer
                :agent-id="currentAgent.id"
                :agent-name="currentAgent.name"
                :agent-avatar-url="agentAvatarUrl"
                :thread-id="threadStore.threadId"
                compact-input
                :workspace-context="{
                  filePath: activePath || undefined,
                  terminalId: activeTerminalId || undefined,
                }"
              />
            </div>
          </template>
        </aside>
      </div>
    </div>

    <!-- 会话切换抽屉：由 Header 主体或收起态角色图标触发。 -->
    <WorkspaceSessionDrawer v-model:open="isSessionDrawerOpen" />
  </div>

  <div v-else class="workspace-loading">
    <PixelIcon name="refresh" size="lg" animation="spin" />
    正在加载 Agent 工作区…
  </div>
</template>

<style scoped>
.workspace-tab {
  width: 100%;
  height: 100%;
  padding: 14px;
  overflow: hidden;
  background:
    radial-gradient(
      circle at 12% 8%,
      color-mix(in srgb, var(--ui-accent-sky) 8%, transparent),
      transparent 31%
    ),
    radial-gradient(
      circle at 88% 86%,
      color-mix(in srgb, var(--ui-accent-purple) 7%, transparent),
      transparent 34%
    ),
    var(--ui-bg-canvas);
}

.workspace-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-xl);
  background: var(--ui-bg-surface);
  box-shadow: var(--ui-shadow-md);
}

.workspace-commandbar {
  display: grid;
  min-height: 50px;
  flex-shrink: 0;
  grid-template-columns: minmax(220px, auto) minmax(120px, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-bg-elevated);
}

.workspace-agent {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.workspace-agent__avatar,
.copilot-header__avatar,
.copilot-rail-avatar {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-accent-primary) 45%, var(--ui-border-default));
  background: linear-gradient(135deg, var(--ui-accent-primary-soft), var(--ui-accent-purple-soft));
  color: var(--ui-accent-primary);
  font-family: var(--ui-font-pixel);
  font-weight: 900;
  box-shadow: 0 0 14px color-mix(in srgb, var(--ui-accent-primary) 14%, transparent);
}
.workspace-agent__avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--ui-radius-sm);
}
.workspace-agent__identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.workspace-agent__title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.workspace-agent__title strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-label {
  color: var(--ui-accent-sky);
  font: 700 8px var(--ui-font-mono);
  letter-spacing: 0.12em;
}
.workspace-agent__status {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-tertiary);
  font-size: 9px;
}
.workspace-agent__status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ui-success);
  box-shadow: 0 0 6px var(--ui-success);
}

.workspace-context {
  display: flex;
  min-width: 0;
  max-width: 560px;
  align-items: center;
  justify-self: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-secondary);
  font: 10px var(--ui-font-mono);
}
.workspace-context > span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-dirty-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ui-warning);
}
.workspace-readonly-badge {
  flex-shrink: 0;
  padding: 2px 5px;
  border-radius: var(--ui-radius-xs);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font: 700 8px var(--ui-font-sans);
}
.workspace-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.workspace-action {
  position: relative;
  display: grid;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
  transition: all var(--ui-duration-fast);
}
.workspace-action:hover,
.workspace-action.active {
  border-color: var(--ui-border-default);
  border-bottom-color: var(--ui-accent-sky);
  background: var(--ui-bg-hover);
  color: var(--ui-accent-sky);
}
.workspace-action--approval {
  display: flex;
  gap: 5px;
  border-color: color-mix(in srgb, var(--ui-warning) 28%, transparent);
  background: var(--ui-warning-soft);
  color: var(--ui-warning);
  font-size: 10px;
  font-weight: 800;
}

.workspace-body {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
.workspace-explorer,
.workspace-copilot {
  position: relative;
  display: flex;
  min-height: 0;
  flex-shrink: 0;
  overflow: hidden;
  background: var(--ui-bg-surface-soft);
  transition: width var(--ui-duration-normal) var(--ui-ease-standard);
}
.workspace-explorer {
  border-right: 1px solid var(--ui-border-subtle);
}
.workspace-explorer--collapsed {
  width: 48px;
  justify-content: center;
  padding-top: 10px;
}
.workspace-copilot {
  flex-direction: column;
  border-left: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface);
}
.workspace-copilot--collapsed {
  width: 52px;
  align-items: center;
  gap: 12px;
  padding-top: 12px;
  background: var(--ui-bg-surface-soft);
}
.workspace-rail-button {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
}
.workspace-rail-button:hover {
  border-color: var(--ui-border-default);
  background: var(--ui-bg-hover);
  color: var(--ui-accent-sky);
}

.workspace-resizer {
  position: absolute;
  z-index: 15;
  touch-action: none;
}
.workspace-resizer--vertical {
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
}
.workspace-resizer--copilot {
  top: 0;
  left: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
}
.workspace-resizer--horizontal {
  top: -4px;
  right: 0;
  left: 0;
  height: 8px;
  cursor: row-resize;
}
.workspace-resizer:hover,
.workspace-resizer:active {
  background: color-mix(in srgb, var(--ui-accent-sky) 45%, transparent);
}

.workspace-center {
  display: flex;
  min-width: 320px;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-bg-surface);
}
.editor-tabs {
  display: flex;
  height: 38px;
  flex-shrink: 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
}
.editor-tabs button {
  position: relative;
  display: flex;
  max-width: 200px;
  min-width: 112px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 0;
  border-right: 1px solid var(--ui-border-subtle);
  background: transparent;
  color: var(--ui-text-secondary);
  font-size: 11px;
  cursor: pointer;
}
.editor-tabs button::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: transparent;
}
.editor-tabs button:hover {
  background: var(--ui-bg-hover);
  color: var(--ui-text-primary);
}
.editor-tabs button.active {
  background: var(--ui-bg-surface);
  color: var(--ui-accent-sky);
}
.editor-tabs button.active::after {
  background: var(--ui-accent-sky);
}
.editor-tabs button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-tabs button i {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--ui-warning);
}
.editor-tabs button b {
  margin-left: auto;
  color: var(--ui-text-tertiary);
  font-size: 15px;
  font-weight: 400;
}
.editor-tabs button b:hover {
  color: var(--ui-danger);
}
.editor-tabs__empty {
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}

.editor-area {
  display: flex;
  min-height: 120px;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
  background: var(--ui-bg-surface);
}
.editor-area--terminal-maximized {
  display: none;
}
.editor-toolbar {
  display: flex;
  min-height: 38px;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-elevated);
}
.editor-breadcrumb {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-tertiary);
  font: 9px var(--ui-font-mono);
}
.editor-breadcrumb span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-warning {
  color: var(--ui-warning);
  font-size: 9px;
}
.editor-surface {
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--ui-bg-surface);
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--ui-border-subtle) 25%, transparent) 1px,
    transparent 1px
  );
  background-size: 80px 100%;
}
.editor-gutter {
  width: 42px;
  flex-shrink: 0;
  padding: 14px 10px;
  border-right: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-disabled);
  text-align: right;
  font: 12px/1.65 var(--ui-font-mono);
  user-select: none;
}
.editor-surface textarea {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  resize: none;
  border: 0;
  outline: 0;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--ui-bg-surface) 96%, transparent);
  color: var(--ui-text-primary);
  caret-color: var(--ui-accent-sky);
  font: 12px/1.65 var(--ui-font-mono);
  tab-size: 2;
  white-space: pre;
}
.editor-surface textarea:focus {
  box-shadow: inset 2px 0 0 var(--ui-accent-sky);
}
.editor-surface textarea:read-only {
  color: var(--ui-text-secondary);
  background: var(--ui-bg-surface-soft);
}
.editor-statusbar {
  display: flex;
  min-height: 24px;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  border-top: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-tertiary);
  font: 8px var(--ui-font-mono);
}
.editor-statusbar__spacer {
  flex: 1;
}
.editor-empty {
  display: flex;
  height: 100%;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  color: var(--ui-text-tertiary);
  text-align: center;
}
.editor-empty__mark {
  display: grid;
  width: 64px;
  height: 64px;
  place-items: center;
  border: 1px solid var(--ui-border-subtle);
  border-radius: var(--ui-radius-lg);
  background: linear-gradient(135deg, var(--ui-accent-sky-soft), var(--ui-accent-purple-soft));
  color: var(--ui-accent-sky);
  box-shadow: var(--ui-shadow-sm);
}
.editor-empty strong {
  color: var(--ui-text-primary);
  font-size: 14px;
}
.editor-empty span {
  max-width: 430px;
  font-size: 11px;
  line-height: 1.6;
}
.editor-empty button {
  display: flex;
  min-height: 30px;
  align-items: center;
  gap: 7px;
  margin-top: 4px;
  padding: 0 12px;
  border: 1px solid var(--ui-border-default);
  border-radius: 0;
  background: var(--ui-bg-surface);
  color: var(--ui-accent-sky);
  cursor: pointer;
  box-shadow: 3px 3px 0 var(--ui-bg-hover);
}
.editor-empty button:hover {
  background: var(--ui-bg-hover);
  box-shadow: var(--ui-shadow-sm);
}

.terminal-area {
  position: relative;
  display: flex;
  min-height: 150px;
  flex-shrink: 0;
  flex-direction: column;
  border-top: 1px solid var(--ui-border-default);
  background: var(--ui-bg-surface-soft);
}
.terminal-area--collapsed {
  min-height: 36px;
  height: 36px !important;
}
.terminal-area--maximized {
  min-height: 0;
  height: 100% !important;
  flex: 1;
}
.terminal-panelbar {
  display: flex;
  min-height: 36px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 11px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-tertiary);
  user-select: none;
}
.terminal-panelbar__title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
}
.terminal-panelbar__title strong {
  color: var(--ui-text-primary);
}
.terminal-panelbar__title span {
  color: var(--ui-success);
  font-size: 8px;
}
.terminal-panelbar__actions {
  display: flex;
  gap: 3px;
}
.terminal-panelbar__actions button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.terminal-panelbar__actions button:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
}

.copilot-rail-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  border-radius: var(--ui-radius-sm);
  cursor: pointer;
}
.copilot-rail-avatar i {
  position: absolute;
  top: -6px;
  right: -7px;
  display: grid;
  min-width: 16px;
  height: 16px;
  padding: 0 3px;
  place-items: center;
  border: 2px solid var(--ui-bg-surface-soft);
  border-radius: 9px;
  background: var(--ui-danger);
  color: white;
  font: 800 8px var(--ui-font-sans);
}
.copilot-header {
  display: flex;
  min-height: 56px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-elevated);
}
.copilot-header__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.copilot-header__main:hover {
  border-color: var(--ui-border-subtle);
  background: var(--ui-bg-hover);
}
.copilot-header__avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: var(--ui-radius-sm);
}
.copilot-header__identity {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}
.copilot-header__identity strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copilot-header__identity span {
  overflow: hidden;
  color: var(--ui-text-tertiary);
  font: 700 8px var(--ui-font-mono);
  letter-spacing: 0.06em;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.copilot-header__switch {
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
  transition: transform var(--ui-duration-fast);
}
.copilot-header__main:hover .copilot-header__switch {
  color: var(--ui-accent-primary);
  transform: translateY(1px);
}
.copilot-header__collapse {
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-tertiary);
  cursor: pointer;
}
.copilot-header__collapse:hover {
  border-color: var(--ui-border-default);
  background: var(--ui-bg-hover);
  color: var(--ui-accent-primary);
}
.copilot-context {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-surface-soft);
}
.copilot-context__label {
  width: 100%;
  color: var(--ui-text-tertiary);
  font: 700 8px var(--ui-font-mono);
  letter-spacing: 0.08em;
}
.context-chip {
  display: flex;
  min-width: 0;
  max-width: 180px;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-sky) 20%, var(--ui-border-subtle));
  border-radius: var(--ui-radius-full);
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
  font-size: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.approval-queue {
  flex-shrink: 0;
  border-bottom: 1px solid var(--ui-border-default);
  background: var(--ui-warning-soft);
}
.approval-queue__header {
  display: flex;
  width: 100%;
  min-height: 38px;
  align-items: center;
  justify-content: space-between;
  padding: 0 11px;
  border: 0;
  background: transparent;
  color: var(--ui-warning);
  cursor: pointer;
}
.approval-queue__header > span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.approval-queue__header strong {
  font-size: 10px;
}
.approval-queue__header i {
  display: grid;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  place-items: center;
  border-radius: 9px;
  background: var(--ui-warning);
  color: var(--ui-text-inverse);
  font-size: 8px;
  font-style: normal;
}
.approval-queue__body {
  display: flex;
  max-height: 310px;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 8px;
}
.approval-queue__collapse {
  display: flex;
  width: 100%;
  min-height: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--ui-warning) 32%, var(--ui-border-default));
  border-radius: var(--ui-radius-sm);
  background: color-mix(in srgb, var(--ui-bg-surface) 72%, var(--ui-warning-soft));
  color: var(--ui-warning);
  font: 700 9px var(--ui-font-mono);
  letter-spacing: 0.03em;
  cursor: pointer;
}
.approval-queue__collapse:hover {
  border-color: var(--ui-warning);
  background: var(--ui-warning-soft);
}
.approval-queue__collapse:focus-visible {
  outline: 2px solid var(--ui-accent-primary);
  outline-offset: 2px;
}
.copilot-chat {
  min-height: 0;
  flex: 1;
  overflow: hidden;
  background: var(--ui-bg-surface);
}

.workspace-loading {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--ui-bg-canvas);
  color: var(--ui-text-secondary);
}

[data-theme='dark'] .workspace-panel {
  border-color: color-mix(in srgb, var(--ui-accent-purple) 20%, var(--ui-border-default));
  background: color-mix(in srgb, var(--ui-bg-surface) 96%, black);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
[data-theme='dark'] .workspace-commandbar {
  background: color-mix(in srgb, var(--ui-bg-elevated) 90%, transparent);
}
[data-theme='dark'] .workspace-explorer,
[data-theme='dark'] .workspace-copilot--collapsed {
  background: color-mix(in srgb, var(--ui-bg-surface-soft) 88%, black);
}
[data-theme='dark'] .editor-surface textarea {
  background: #151821;
}
[data-theme='dark'] .editor-gutter {
  background: #12151d;
}
[data-theme='dark'] .workspace-agent__avatar,
[data-theme='dark'] .copilot-header__avatar,
[data-theme='dark'] .copilot-rail-avatar {
  border-color: color-mix(in srgb, var(--ui-accent-purple) 50%, var(--ui-border-default));
  color: var(--ui-accent-purple);
  box-shadow: var(--ui-glow-purple);
}

@media (max-width: 1180px) {
  .workspace-context {
    justify-self: stretch;
  }
  .workspace-copilot:not(.workspace-copilot--collapsed) {
    position: absolute;
    z-index: 30;
    top: 56px;
    right: 0;
    bottom: 0;
    width: min(420px, calc(100% - 90px)) !important;
    box-shadow: var(--ui-shadow-panel);
  }
}

@media (max-width: 900px) {
  .workspace-tab {
    padding: 0;
  }
  .workspace-commandbar {
    grid-template-columns: 1fr auto;
    gap: 8px;
  }
  .workspace-context {
    display: none;
  }
  .workspace-agent__status {
    display: none;
  }
  .workspace-explorer:not(.workspace-explorer--collapsed) {
    position: absolute;
    z-index: 31;
    top: 56px;
    bottom: 0;
    left: 0;
    width: min(300px, calc(100% - 60px)) !important;
    box-shadow: 12px 0 34px rgba(0, 0, 0, 0.2);
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-explorer,
  .workspace-copilot,
  .workspace-action {
    transition: none;
  }
}
</style>
