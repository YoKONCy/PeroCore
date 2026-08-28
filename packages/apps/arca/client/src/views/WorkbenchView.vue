<script setup lang="ts">
/**
 * WorkbenchView.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DocumentNode } from '@infos/document-engine'
import ConnectionBadge from '../components/ConnectionBadge.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import OutlineTree from '../components/OutlineTree.vue'
import SemanticDocument from '../components/SemanticDocument.vue'
import { useWorkbenchStore } from '../stores/workbench'

const store = useWorkbenchStore()
const route = useRoute()
const router = useRouter()
const mode = ref<'create' | 'read' | 'review'>('create')
const composerOpen = ref(false)
const composerTask = ref('')
const composerScope = ref<'selection' | 'section' | 'document'>('section')
const composerNodeId = ref<string>()
const composerAgentId = ref(localStorage.getItem('arca-default-agent') ?? 'pero')
const composerRequirements = ref('')
const composerError = ref('')
const commentNode = ref<DocumentNode>()
const commentBody = ref('')
const renameOpen = ref(false)
const renameTitle = ref('')
const reviewMessage = ref('')
const editorWidth = `${localStorage.getItem('arca-editor-width') ?? '840'}px`
const collaborationDrawer = ref<'activity' | 'review' | 'comments' | 'revisions'>('activity')
const packageInput = ref<HTMLInputElement>()
let collaborationTimer: number | undefined
const activeSnapshot = computed(() => store.activeDocument?.snapshot)
const nodes = computed(() => activeSnapshot.value?.nodes ?? [])
const reviewCount = computed(() => store.pendingChangeSets.length)
const saveLabel = computed(() => {
  const labels = {
    idle: '已保存',
    dirty: '有本地草稿',
    saving: '正在提交',
    saved: '已保存',
    conflicted: '修订冲突',
    failed: '保存失败',
  }
  return labels[store.editState]
})

async function openDocument(documentId: string) {
  await store.openDocument(documentId)
  await router.replace({ name: 'workbench', params: { documentId } })
}
function scrollToNode(nodeId: string) {
  document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })
}
function toggleDrawer(value: NonNullable<typeof store.activeNavigator>) {
  store.toggleNavigator(value)
}
function openComposer(nodeId?: string) {
  composerNodeId.value = nodeId
  if (!store.collaborationAgents.some((agent) => agent.id === composerAgentId.value)) {
    composerAgentId.value = store.collaborationAgents[0]?.id ?? ''
  }
  composerScope.value = nodeId ? 'selection' : 'section'
  composerOpen.value = true
}
function taskStatusLabel(status: (typeof store.collaborationTasks)[number]['status']) {
  return {
    queued: '排队中',
    working: '协作中',
    completed: '本地建议已生成',
    awaiting_review: '等待审阅',
    committed: '已提交',
    rejected: '已拒绝',
    failed: '失败',
    cancelled: '已取消',
  }[status]
}
async function submitCollaboration() {
  composerError.value = ''
  try {
    await store.createCollaborationTask({
      instruction: composerTask.value,
      scope: composerScope.value,
      ...(composerScope.value !== 'document' && composerNodeId.value
        ? { nodeId: composerNodeId.value }
        : {}),
      agentId: composerAgentId.value,
      ...(composerRequirements.value.trim()
        ? { requirements: composerRequirements.value.trim() }
        : {}),
    })
    composerOpen.value = false
    composerTask.value = ''
    composerRequirements.value = ''
    collaborationDrawer.value = 'activity'
  } catch (error) {
    composerError.value = error instanceof Error ? error.message : String(error)
  }
}
async function openTaskResult(changeSetId?: string) {
  if (changeSetId) await selectChangeSet(changeSetId)
}
async function requestChanges() {
  const changeSet = store.selectedChangeSet
  if (!changeSet || !reviewMessage.value.trim()) return
  await store.reviewChangeSet(changeSet.changeSetId, 'request_changes', reviewMessage.value.trim())
  composerTask.value = `根据审阅意见调整“${changeSet.intent}”`
  composerRequirements.value = reviewMessage.value.trim()
  const agentId = changeSet.actorPrincipalId.replace(/^agent:/, '')
  composerAgentId.value = store.collaborationAgents.some((agent) => agent.id === agentId)
    ? agentId
    : (store.collaborationAgents[0]?.id ?? '')
  composerScope.value = 'document'
  composerNodeId.value = undefined
  reviewMessage.value = ''
  composerOpen.value = true
}
async function insertNode(
  node: DocumentNode,
  type: 'paragraph' | 'heading' | 'quote' | 'code-block',
) {
  await store.insertNodeAfter(node, type)
}
const pendingDeleteNode = ref<DocumentNode>()

function requestDelete(node: DocumentNode) {
  pendingDeleteNode.value = node
}
async function confirmDelete() {
  const node = pendingDeleteNode.value
  pendingDeleteNode.value = undefined
  if (node) await store.deleteNode(node)
}
function openComment(node: DocumentNode) {
  commentNode.value = node
  commentBody.value = ''
  collaborationDrawer.value = 'comments'
}
async function submitComment() {
  if (!commentNode.value || !commentBody.value.trim()) return
  await store.createComment(commentNode.value.nodeId, commentBody.value.trim())
  commentNode.value = undefined
  commentBody.value = ''
}
function openRename() {
  renameTitle.value = store.documentTitle
  renameOpen.value = true
}
async function submitRename() {
  await store.renameDocument(renameTitle.value)
  renameOpen.value = false
}
async function togglePresentation() {
  await store.togglePresentation()
}
async function switchMode(next: 'create' | 'read' | 'review') {
  mode.value = next
  if (next !== 'review') return
  collaborationDrawer.value = 'review'
  if (!store.selectedChangeSet && store.pendingChangeSets[0]) {
    await store.selectChangeSet(store.pendingChangeSets[0].changeSetId)
  }
}
async function selectChangeSet(changeSetId: string) {
  await store.selectChangeSet(changeSetId)
  mode.value = 'review'
  collaborationDrawer.value = 'review'
}
async function importSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await store.importProject(file)
  input.value = ''
}
function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (pendingDeleteNode.value) return // 确认框自身的Escape处理优先
  if (composerOpen.value) composerOpen.value = false
  else if (store.focusMode) store.toggleFocusMode()
}
onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  store.activeNavigator = null
  const documentId =
    typeof route.params.documentId === 'string' ? route.params.documentId : undefined
  if (documentId && documentId !== store.activeDocumentId && store.connection === 'ready') {
    await store.openDocument(documentId)
  }
  collaborationTimer = window.setInterval(() => {
    if (store.collaborationTasks.some((task) => ['queued', 'working'].includes(task.status))) {
      void store.loadCollaborationTasks()
    }
  }, 3_000)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (collaborationTimer) window.clearInterval(collaborationTimer)
})
</script>

<template>
  <main
    class="folio-workbench"
    :class="{ 'focus-mode': store.focusMode }"
    :style="{ '--editor-width': editorWidth }"
  >
    <header class="folio-appbar">
      <button
        class="brand-button"
        type="button"
        aria-label="返回最近星页"
        @click="router.push('/')"
      >
        <span class="brand-fold brand-fold--star" />
      </button>
      <div class="folio-breadcrumb">
        <span>Arca</span>
        <b>/</b>
        <strong title="双击重命名" @dblclick="openRename">{{ store.documentTitle }}</strong>
      </div>
      <div class="folio-save-state" :data-state="store.editState">
        <i />
        {{ saveLabel }}
        <span>REV {{ store.revisionLabel }}</span>
      </div>
      <div class="folio-app-actions">
        <ConnectionBadge />
        <button class="collaboration-button" type="button" @click="openComposer()">
          <span>✦</span>
          {{ reviewCount ? `${reviewCount}项待审` : '协作' }}
        </button>
        <button class="quiet-icon" type="button" title="导出工程" @click="store.exportProject()">
          ↗
        </button>
        <button class="quiet-icon" type="button" title="导入工程" @click="packageInput?.click()">
          ↙
        </button>
        <input ref="packageInput" type="file" accept=".arca" hidden @change="importSelected" />
        <button
          class="quiet-icon"
          type="button"
          title="Arca设置"
          @click="router.push({ name: 'settings' })"
        >
          ⚙
        </button>
        <button class="quiet-icon" type="button" title="切换Arca主题" @click="store.cycleTheme()">
          ◐
        </button>
      </div>
    </header>

    <div v-if="store.errorMessage" class="workbench-error" role="alert">
      <span>!</span>
      <strong>{{ store.errorMessage }}</strong>
      <button aria-label="关闭错误提示" @click="store.errorMessage = ''">×</button>
    </div>

    <nav v-if="!store.focusMode" class="folio-contextbar" aria-label="文档工作模式">
      <div class="mode-switcher">
        <button :class="{ active: mode === 'create' }" @click="switchMode('create')">创作</button>
        <button :class="{ active: mode === 'read' }" @click="switchMode('read')">阅读</button>
        <button :class="{ active: mode === 'review' }" @click="switchMode('review')">
          审阅
          <span v-if="reviewCount">{{ reviewCount }}</span>
        </button>
      </div>
      <span class="context-spacer" />
      <button class="context-action" type="button" @click="toggleDrawer('search')">⌕ 搜索</button>
      <button class="context-action" type="button" @click="togglePresentation">
        {{ store.surfaceMode === 'presentation' ? '▤ 文稿' : '▣ 演示' }}
      </button>
      <button class="context-action" type="button" @click="store.toggleFocusMode()">⌗ 专注</button>
    </nav>

    <div
      class="folio-body"
      :class="{ 'navigator-open': Boolean(store.activeNavigator && !store.focusMode) }"
    >
      <nav v-if="!store.focusMode" class="star-rail" aria-label="星签导航">
        <button
          :class="{ active: store.activeNavigator === 'documents' }"
          title="项目星页"
          @click="toggleDrawer('documents')"
        >
          ◫
        </button>
        <button
          :class="{ active: store.activeNavigator === 'outline' }"
          title="文档结构"
          @click="toggleDrawer('outline')"
        >
          ☷
        </button>
        <button
          :class="{ active: store.activeNavigator === 'search' }"
          title="搜索"
          @click="toggleDrawer('search')"
        >
          ⌕
        </button>
        <button title="素材" disabled>◇</button>
        <span />
        <button
          :class="{ active: collaborationDrawer }"
          title="协作与修订"
          @click="collaborationDrawer = 'activity'"
        >
          ✦
        </button>
      </nav>

      <aside v-if="store.activeNavigator && !store.focusMode" class="workspace-drawer">
        <header class="drawer-heading">
          <div>
            <p class="pixel-label">
              导航
              <span class="pixel-en">NAVIGATOR</span>
            </p>
            <h2>
              {{
                store.activeNavigator === 'outline'
                  ? '文档结构'
                  : store.activeNavigator === 'search'
                    ? '星页搜索'
                    : '项目星页'
              }}
            </h2>
          </div>
          <button aria-label="关闭导航抽屉" @click="store.activeNavigator = null">×</button>
        </header>
        <template v-if="store.activeNavigator === 'documents'">
          <button
            v-for="item in store.documents"
            :key="item.documentId"
            class="drawer-document"
            :class="{ active: item.documentId === store.activeDocumentId }"
            @click="openDocument(item.documentId)"
          >
            <span class="mini-fold" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>REV {{ String(item.headRevisionId).slice(0, 7) }}</small>
            </span>
          </button>
        </template>
        <template v-else-if="store.activeNavigator === 'search'">
          <input
            v-model="store.searchQuery"
            class="drawer-search"
            type="search"
            autofocus
            placeholder="搜索当前星页……"
          />
          <button
            v-for="result in store.searchResults"
            :key="result.nodeId"
            class="search-result"
            @click="scrollToNode(result.nodeId)"
          >
            <span>{{ result.type }}</span>
            <strong>{{ result.text }}</strong>
          </button>
          <div v-if="store.searchQuery && !store.searchResults.length" class="drawer-empty">
            没有匹配的语义块
          </div>
        </template>
        <OutlineTree
          v-else-if="store.activeNavigator === 'outline'"
          :nodes="store.activeDocument?.outline.content ?? []"
          @select="scrollToNode"
        />
      </aside>

      <section class="star-page-stage">
        <article v-if="activeSnapshot" class="star-page">
          <header class="folio-masthead">
            <p>{{ activeSnapshot.document.kind }} · {{ activeSnapshot.document.language }}</p>
            <h1>{{ activeSnapshot.document.title }}</h1>
            <div>
              <span>最后修订 {{ store.revisionLabel }}</span>
              <span>{{ store.wordCount }} 字符</span>
            </div>
          </header>
          <div
            v-if="store.surfaceMode === 'presentation' && store.presentation"
            class="presentation-surface"
          >
            <article
              v-for="slide in store.presentation.content"
              :key="slide.slideId"
              class="presentation-slide"
            >
              <h2>{{ slide.title }}</h2>
              <p v-for="block in slide.blocks" :key="block.nodeId">{{ block.text }}</p>
            </article>
          </div>
          <SemanticDocument
            v-else
            :nodes="nodes"
            :root-node-id="activeSnapshot.document.rootNodeId"
            :drafts="store.drafts"
            :writable="store.connection === 'ready' && store.authority === 'writable'"
            :mode="mode"
            :diff="store.semanticDiff"
            @draft="store.saveDraft"
            @commit="store.commitDraft"
            @collaborate="openComposer"
            @insert="insertNode"
            @delete="requestDelete"
            @move="store.moveNode"
            @comment="openComment"
          />
        </article>
        <div v-else class="surface-empty">
          <span class="empty-fold" />
          <strong>没有可显示的星页</strong>
          <p>返回启动台选择文档，或重新连接Arca Host。</p>
          <button @click="router.push('/')">返回最近星页</button>
        </div>
      </section>

      <aside v-if="collaborationDrawer && !store.focusMode" class="collaboration-drawer">
        <header class="drawer-heading collaboration-heading">
          <div>
            <p class="pixel-label">
              协作
              <span class="pixel-en">COLLABORATION</span>
            </p>
            <h2>协作与修订</h2>
          </div>
          <span class="inspector-state">
            <i />
            FIXED
          </span>
        </header>
        <nav class="collaboration-tabs">
          <button
            :class="{ active: collaborationDrawer === 'activity' }"
            @click="collaborationDrawer = 'activity'"
          >
            活动
          </button>
          <button
            :class="{ active: collaborationDrawer === 'review' }"
            @click="collaborationDrawer = 'review'"
          >
            审阅 {{ reviewCount || '' }}
          </button>
          <button
            :class="{ active: collaborationDrawer === 'comments' }"
            @click="collaborationDrawer = 'comments'"
          >
            评论 {{ store.comments.length || '' }}
          </button>
          <button
            :class="{ active: collaborationDrawer === 'revisions' }"
            @click="collaborationDrawer = 'revisions'"
          >
            修订
          </button>
        </nav>
        <div class="drawer-content">
          <template v-if="collaborationDrawer === 'activity'">
            <article
              v-for="task in store.collaborationTasks"
              :key="task.taskId"
              class="collaboration-task"
              :data-status="task.status"
            >
              <div class="task-actor">
                <i />
                {{ task.agentId }}
              </div>
              <strong>{{ task.instruction }}</strong>
              <p>
                {{ taskStatusLabel(task.status) }}
                <span v-if="task.stage">· {{ task.stage }}</span>
              </p>
              <small>
                {{ task.source === 'local' ? 'LOCAL MODEL' : 'KERNEL' }} · REV
                {{ task.baseRevisionId.slice(0, 8) }} · {{ task.scope }}
              </small>
              <pre v-if="task.resultText" class="task-result">{{ task.resultText }}</pre>
              <div class="task-actions">
                <button v-if="task.changeSetId" @click="openTaskResult(task.changeSetId)">
                  审阅变更
                </button>
                <button
                  v-if="['queued', 'working'].includes(task.status)"
                  @click="store.cancelCollaborationTask(task.taskId)"
                >
                  取消
                </button>
              </div>
              <p v-if="task.error" class="task-error">{{ task.error }}</p>
            </article>
            <div v-if="!store.collaborationTasks.length" class="activity-empty">
              <span>✦</span>
              <strong>协作者空闲</strong>
              <p>发起任务后，工作位置与状态会沿星轨显示。</p>
              <button @click="openComposer()">发起协作</button>
            </div>
          </template>
          <template v-else-if="collaborationDrawer === 'review'">
            <div v-if="store.selectedChangeSet && store.semanticDiff" class="review-summary">
              <span class="risk-chip" :data-risk="store.selectedChangeSet.risk">
                {{ store.selectedChangeSet.risk }}
              </span>
              <h3>{{ store.selectedChangeSet.intent }}</h3>
              <p>{{ store.selectedChangeSet.explanation }}</p>
              <dl>
                <dt>协作者</dt>
                <dd>{{ store.selectedChangeSet.actorPrincipalId }}</dd>
                <dt>基础修订</dt>
                <dd>{{ store.selectedChangeSet.baseRevisionId.slice(0, 8) }}</dd>
                <dt>文本变更</dt>
                <dd>{{ store.semanticDiff.summary.changedTextNodes }}</dd>
                <dt>结构变化</dt>
                <dd>
                  ＋{{ store.semanticDiff.summary.insertedNodes }} / －{{
                    store.semanticDiff.summary.deletedNodes
                  }}
                </dd>
              </dl>
              <textarea
                v-model="reviewMessage"
                class="review-message"
                placeholder="请求调整时，请写明需要修改的地方……"
              />
              <div class="review-actions">
                <button
                  class="approve"
                  @click="
                    store.reviewChangeSet(
                      store.selectedChangeSet.changeSetId,
                      'approve',
                      reviewMessage,
                    )
                  "
                >
                  批准并提交
                </button>
                <button :disabled="!reviewMessage.trim()" @click="requestChanges">请求调整</button>
                <button
                  class="reject"
                  @click="
                    store.reviewChangeSet(
                      store.selectedChangeSet.changeSetId,
                      'reject',
                      reviewMessage,
                    )
                  "
                >
                  拒绝
                </button>
              </div>
            </div>
            <button
              v-for="changeSet in store.pendingChangeSets"
              v-else
              :key="changeSet.changeSetId"
              class="changeset-row"
              @click="selectChangeSet(changeSet.changeSetId)"
            >
              <i />
              <span>
                <strong>{{ changeSet.intent }}</strong>
                <small>{{ changeSet.actorPrincipalId }} · {{ changeSet.risk }}</small>
              </span>
            </button>
            <div v-if="!store.pendingChangeSets.length" class="activity-empty">
              <strong>没有待审变更</strong>
              <p>Agent提交的ChangeSet会出现在这里。</p>
            </div>
          </template>
          <template v-else-if="collaborationDrawer === 'comments'">
            <form v-if="commentNode" class="comment-composer" @submit.prevent="submitComment">
              <strong>评论语义块</strong>
              <small>{{ commentNode.text?.slice(0, 60) || commentNode.type }}</small>
              <textarea v-model="commentBody" autofocus placeholder="写下审阅意见……" />
              <div>
                <button type="button" @click="commentNode = undefined">取消</button>
                <button type="submit" :disabled="!commentBody.trim()">添加评论</button>
              </div>
            </form>
            <article
              v-for="comment in store.comments"
              :key="comment.commentId"
              class="comment-entry"
            >
              <p>{{ comment.body }}</p>
              <small>{{ comment.authorPrincipalId }} · {{ comment.status }}</small>
              <button
                v-if="comment.status === 'open'"
                @click="store.resolveComment(comment.commentId)"
              >
                标记解决
              </button>
            </article>
            <div v-if="!store.comments.length" class="activity-empty">
              <strong>没有评论</strong>
              <p>评论会按语义节点锚定，而不是进入全局聊天。</p>
            </div>
          </template>
          <template v-else>
            <div class="revision-river">
              <article
                v-for="entry in [...store.revisions].reverse()"
                :key="entry.revision.revisionId"
                class="revision-node"
                :class="{ current: entry.revision.revisionId === activeSnapshot?.revisionId }"
              >
                <i />
                <div>
                  <b>REV {{ entry.revision.sequence }}</b>
                  <strong>{{ entry.revision.intent }}</strong>
                  <small>
                    {{ entry.revision.actorPrincipalId }} ·
                    {{ new Date(entry.revision.committedAt).toLocaleString('zh-CN') }}
                  </small>
                </div>
              </article>
              <article
                v-for="changeSet in store.pendingChangeSets"
                :key="changeSet.changeSetId"
                class="revision-node pending"
              >
                <i />
                <div>
                  <b>待审</b>
                  <strong>{{ changeSet.intent }}</strong>
                  <small>{{ changeSet.actorPrincipalId }}</small>
                </div>
              </article>
            </div>
          </template>
        </div>
      </aside>
    </div>

    <footer v-if="!store.focusMode" class="folio-statusbar">
      <span>REV {{ store.revisionLabel }}</span>
      <span>{{ store.wordCount }}字符</span>
      <span>{{ activeSnapshot?.document.language ?? '—' }}</span>
      <span class="status-spacer" />
      <span v-if="reviewCount" class="pending-status">✦ {{ reviewCount }}项待审</span>
      <span>Authority {{ store.authority }}</span>
      <span>Kernel {{ store.kernelOnline ? '在线' : '离线' }}</span>
    </footer>
    <button v-else class="focus-exit" @click="store.toggleFocusMode()">Esc · 退出专注</button>

    <div v-if="renameOpen" class="composer-scrim" @click.self="renameOpen = false">
      <form class="mini-dialog" @submit.prevent="submitRename">
        <p class="pixel-label">
          文档
          <span class="pixel-en">DOCUMENT</span>
        </p>
        <h2>重命名星页</h2>
        <input v-model="renameTitle" autofocus maxlength="120" />
        <footer>
          <button type="button" @click="renameOpen = false">取消</button>
          <button class="primary-button" type="submit" :disabled="!renameTitle.trim()">保存</button>
        </footer>
      </form>
    </div>

    <div v-if="composerOpen" class="composer-scrim" @click.self="composerOpen = false">
      <section
        class="collaboration-composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <header>
          <div>
            <p class="pixel-label">
              协作任务
              <span class="pixel-en">COLLABORATE</span>
            </p>
            <h2 id="composer-title">发起协作任务</h2>
          </div>
          <button aria-label="关闭协作任务框" @click="composerOpen = false">×</button>
        </header>
        <textarea
          v-model="composerTask"
          autofocus
          placeholder="例如：重组这一节，使论证更清楚，并保留原有语气。"
        />
        <div class="composer-fields">
          <label>
            范围
            <select v-model="composerScope">
              <option value="selection">当前语义块</option>
              <option value="section">当前章节</option>
              <option value="document">全文</option>
            </select>
          </label>
          <label>
            协作者
            <select v-model="composerAgentId">
              <option v-for="agent in store.collaborationAgents" :key="agent.id" :value="agent.id">
                {{ agent.name }}
              </option>
            </select>
          </label>
        </div>
        <textarea
          v-model="composerRequirements"
          class="composer-requirements"
          placeholder="附加要求（可选）：语气、长度、必须保留的内容……"
        />
        <p v-if="composerNodeId" class="composer-context">
          已锚定语义块 {{ composerNodeId.slice(0, 8) }}
        </p>
        <div v-if="!store.collaborationAvailable" class="composer-notice">
          <i />
          Kernel协作通道当前不可用，请确认主应用与Arca Host均已连接。
        </div>
        <p v-if="composerError" class="composer-error">{{ composerError }}</p>
        <footer>
          <button class="soft-button" @click="composerOpen = false">取消</button>
          <button
            class="primary-button"
            :disabled="
              !composerTask.trim() || !store.collaborationAvailable || store.collaborationBusy
            "
            @click="submitCollaboration"
          >
            {{ store.collaborationBusy ? '正在派发' : '开始协作' }}
          </button>
        </footer>
      </section>
    </div>

    <ConfirmDialog
      :open="Boolean(pendingDeleteNode)"
      danger
      title="删除语义块"
      :message="`将删除“${pendingDeleteNode?.text?.slice(0, 30) || (pendingDeleteNode?.type ?? '')}”及其全部子块，并生成一条新的Revision。此操作可通过Revision回溯。`"
      confirm-text="删除"
      @confirm="confirmDelete"
      @cancel="pendingDeleteNode = undefined"
    />
  </main>
</template>
