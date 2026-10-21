<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { DocumentNode, DocumentSnapshot } from '@infos/document-engine'
import type { OfficeSelection } from '@infos/document-engine/office'
import ArcaIcon from '../components/ArcaIcon.vue'
import ArcaDialog from '../components/ArcaDialog.vue'
import ConnectionBadge from '../components/ConnectionBadge.vue'
import OutlineTree from '../components/OutlineTree.vue'
import OfficeEditor from '../components/OfficeEditor.vue'
import DocumentReview from '../components/DocumentReview.vue'
import ArcaSelect from '../components/ArcaSelect.vue'
import ArcaAvatar from '../components/ArcaAvatar.vue'
import { displayTime, orderedDocumentNodes } from '../services/documentDisplay'
import {
  workspaceActions,
  useApplicationBusy,
  type WorkspaceActions,
} from '../services/workspaceUi'
import {
  activateSurface,
  retireSurface,
  captureReadingPosition,
  restoreReadingPosition,
  usePaperMotion,
  useReviewMotion,
  useSelectionIndicator,
} from '../services/surfaceMotion'
import { useWorkbenchStore } from '../stores/workbench'

const store = useWorkbenchStore(),
  route = useRoute(),
  router = useRouter()
const officeEditor = ref<InstanceType<typeof OfficeEditor>>()
const workbenchElement = ref<HTMLElement>(),
  menuBar = ref<HTMLElement>()
const settleReview = useReviewMotion(workbenchElement)
const toolbarTarget = ref<HTMLElement>()
const fileMenu = ref<HTMLDetailsElement>()
const ribbonTabs = [
  {
    id: 'home',
    get label() {
      return __t('apps.arca.ui', '开始')
    },
  },
  {
    id: 'insert',
    get label() {
      return __t('apps.arca.ui', '插入')
    },
  },
  {
    id: 'layout',
    get label() {
      return __t('apps.arca.ui', '页面')
    },
  },
  {
    id: 'review',
    get label() {
      return __t('apps.arca.ui', '审阅')
    },
  },
] as const
const mode = ref<'create' | 'read' | 'review'>('create')
const selectedRibbon = computed(() =>
  mode.value === 'review' ? 'review' : (officeEditor.value?.ribbon ?? 'home'),
)
useSelectionIndicator(menuBar, selectedRibbon)
type Panel = 'properties' | 'activity' | 'review' | 'comments' | 'revisions' | 'compose'
const panel = ref<Panel | null>(null),
  busy = ref(false)
usePaperMotion(
  workbenchElement,
  () => [panel.value, store.activeNavigator, store.focusMode],
  () => officeEditor.value?.hideSelectionToolbar(),
)
useApplicationBusy(computed(() => busy.value || store.collaborationBusy))
const panelTitles: Record<Panel, string> = {
  get properties() {
    return __t('apps.arca.ui', '属性')
  },
  get activity() {
    return __t('apps.arca.ui', '协作')
  },
  get review() {
    return __t('apps.arca.ui', '待审变更')
  },
  get comments() {
    return __t('apps.arca.ui', '评论')
  },
  get revisions() {
    return __t('apps.arca.ui', '历史版本')
  },
  get compose() {
    return __t('apps.arca.ui', '发起协作')
  },
}
const composerTask = ref(''),
  composerScope = ref<'selection' | 'section' | 'document'>('document')
const composerNodeId = ref<string>(),
  composerSelection = ref<OfficeSelection>()
const composerAgentId = ref(localStorage.getItem('arca-default-agent') ?? ''),
  composerRequirements = ref(''),
  composerError = ref('')
const commentNode = ref<DocumentNode>(),
  commentBody = ref(''),
  commentRange = ref<{ start: number; end: number }>()
const renameOpen = ref(false),
  renameTitle = ref(''),
  renameError = ref('')
const reviewMessage = ref(''),
  reviewPreview = ref<{ before: string; after: string }>(),
  reviewPreviewError = ref('')
const reviewView = ref<'text' | 'layout'>('text'),
  historicalPreview = ref('')
const reviewSnapshot = ref<DocumentSnapshot>(),
  showReviewChanges = ref(true)
const composerQuote = ref('')
const reviewFeedback = ref('')
let feedbackTimer: number | undefined, panelTrigger: HTMLElement | undefined
const activeOutlineId = ref<string>()
const restoreId = ref<string>(),
  packageInput = ref<HTMLInputElement>()
const activeSnapshot = computed(() => store.activeDocument?.snapshot)
const reviewCount = computed(() => store.pendingChangeSets.length)
const propertyNode = computed(() => officeEditor.value?.selected)
const canEdit = computed(
  () =>
    mode.value === 'create' &&
    store.authority !== 'conflict' &&
    activeSnapshot.value?.document.status === 'active',
)
let collaborationTimer: number | undefined,
  disposed = false,
  previewSequence = 0
watch(
  panel,
  async (next, previous) => {
    const active = document.activeElement
    const inspector = workbenchElement.value?.querySelector('.inspector-panel')
    if (next && active instanceof HTMLElement && !inspector?.contains(active)) panelTrigger = active
    if (!next && previous && active instanceof HTMLElement && inspector?.contains(active)) {
      const target =
        panelTrigger?.isConnected && !panelTrigger.closest('[inert]')
          ? panelTrigger
          : menuBar.value?.querySelector<HTMLElement>('.workbench-view-menu > summary')
      target?.focus({ preventScroll: true })
    }
    await nextTick()
    if (!disposed && next === panel.value && next !== previous) {
      const scroll = workbenchElement.value?.querySelector('.inspector-panel .panel-scroll')
      if (scroll) scroll.scrollTop = 0
      if (next === 'compose' || next === 'comments') {
        scroll?.querySelector<HTMLElement>('textarea')?.focus({ preventScroll: true })
      }
    }
  },
  { flush: 'pre' },
)
watch(
  () => officeEditor.value?.selected?.nodeId,
  (id) => {
    if (!id || !activeSnapshot.value) return
    let heading: string | undefined
    for (const node of orderedDocumentNodes(activeSnapshot.value)) {
      if (node.type === 'heading') heading = node.nodeId
      if (node.nodeId === id) {
        activeOutlineId.value = heading
        break
      }
    }
  },
)

function fail(error: unknown) {
  store.errorMessage = error instanceof Error ? error.message : '操作失败'
}
async function perform(action: () => Promise<unknown>) {
  if (busy.value || store.applicationStopping) return
  busy.value = true
  try {
    await action()
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
function togglePanel(next: Panel) {
  panel.value = panel.value === next ? null : next
}
function closeFileMenu() {
  if (fileMenu.value) fileMenu.value.open = false
}
async function selectTool(tab: 'home' | 'insert' | 'layout' | 'review') {
  if (busy.value) return
  if (mode.value !== 'create' && activeSnapshot.value?.document.status === 'active')
    await switchMode('create')
  officeEditor.value?.setRibbon(tab)
}
function inspect(
  next: 'activity' | 'review' | 'comments' | 'revisions' | 'properties' | 'outline',
) {
  if (next === 'outline') store.toggleNavigator('outline')
  else if (next === 'review') void switchMode('review')
  else togglePanel(next)
}
async function openDocument(id: string) {
  await perform(async () => {
    await officeEditor.value?.flush()
    await store.openDocument(id)
    reviewPreview.value = undefined
    reviewFeedback.value = ''
    historicalPreview.value = ''
    commentNode.value = undefined
    activeOutlineId.value = undefined
    panel.value = null
    mode.value = 'create'
    await router.replace({ name: 'workbench', params: { documentId: id } })
  })
}
async function scrollToNode(id: string) {
  activeOutlineId.value = id
  if (mode.value === 'review') mode.value = 'read'
  await nextTick()
  document.querySelector('[data-node-id="' + CSS.escape(id) + '"]')?.scrollIntoView({
    behavior: document.documentElement.dataset.motion === 'reduced' ? 'instant' : 'smooth',
    block: 'center',
  })
}
async function openComposer(id?: string) {
  const selection = officeEditor.value?.getSelection()
  const quote = officeEditor.value?.getSelectedText()
  await perform(async () => {
    await officeEditor.value?.flush()
    composerNodeId.value = id ?? selection?.focus.nodeId
    composerSelection.value =
      selection && activeSnapshot.value
        ? { ...selection, revisionId: activeSnapshot.value.revisionId }
        : undefined
    composerScope.value =
      selection &&
      (selection.anchor.nodeId !== selection.focus.nodeId ||
        selection.anchor.offset !== selection.focus.offset)
        ? 'selection'
        : composerNodeId.value
          ? 'section'
          : 'document'
    composerQuote.value =
      quote ||
      activeSnapshot.value?.nodes.find((node) => node.nodeId === composerNodeId.value)?.text ||
      ''
    if (!store.collaborationAgents.some((agent) => agent.id === composerAgentId.value))
      composerAgentId.value = store.collaborationAgents[0]?.id ?? ''
    composerError.value = ''
    mode.value = 'create'
    panel.value = 'compose'
  })
}
async function submitCollaboration() {
  if (busy.value || store.collaborationBusy || !composerTask.value.trim() || !composerAgentId.value)
    return
  composerError.value = ''
  busy.value = true
  try {
    await officeEditor.value?.flush()
    if (
      composerScope.value === 'selection' &&
      composerSelection.value?.revisionId !== activeSnapshot.value?.revisionId
    )
      throw new Error('文稿已更新，请重新选择内容')
    await store.createCollaborationTask({
      instruction: composerTask.value.trim(),
      scope: composerScope.value,
      agentId: composerAgentId.value,
      ...(composerScope.value === 'selection' ? { selection: composerSelection.value } : {}),
      ...(composerScope.value !== 'document' && composerNodeId.value
        ? { nodeId: composerNodeId.value }
        : {}),
      ...(composerRequirements.value.trim()
        ? { requirements: composerRequirements.value.trim() }
        : {}),
    })
    composerTask.value = ''
    composerRequirements.value = ''
    panel.value = 'activity'
  } catch (error) {
    composerError.value = error instanceof Error ? error.message : '协作未能开始'
  } finally {
    busy.value = false
  }
}
function taskLabel(status: string) {
  return (
    (
      {
        get queued() {
          return __t('apps.arca.ui', '排队中')
        },
        get working() {
          return __t('apps.arca.ui', '协作中')
        },
        get completed() {
          return __t('apps.arca.ui', '已完成')
        },
        get awaiting_review() {
          return __t('apps.arca.ui', '待审阅')
        },
        get committed() {
          return __t('apps.arca.ui', '已接受')
        },
        get rejected() {
          return __t('apps.arca.ui', '已拒绝')
        },
        get failed() {
          return __t('apps.arca.ui', '失败')
        },
        get cancelled() {
          return __t('apps.arca.ui', '已取消')
        },
      } as Record<string, string>
    )[status] ?? status
  )
}
function actorLabel(id: string) {
  if (id.startsWith('human:')) return __t('apps.arca.ui', '我')
  const key = id.replace(/^agent:/, '')
  return (
    store.collaborationAgents.find((agent) => agent.id === key)?.name ??
    (key === 'arca-local' ? __t('apps.arca.ui', '本地模型') : key)
  )
}
const composerActor = computed(() => actorLabel(composerAgentId.value))
const collaboratorOptions = computed(() =>
  store.collaborationAgents.map((agent) => ({
    value: agent.id,
    label: agent.name,
    agentId: agent.id,
  })),
)
async function selectChangeSet(id: string) {
  await perform(async () => {
    await officeEditor.value?.flush()
    reviewFeedback.value = ''
    await store.selectChangeSet(id)
    reviewMessage.value = ''
    reviewPreview.value = undefined
    reviewSnapshot.value = undefined
    reviewPreviewError.value = ''
    showReviewChanges.value = true
    mode.value = 'review'
    panel.value = 'review'
    const sequence = ++previewSequence
    const selected = store.selectedChangeSet
    const transport = store.transport
    if (!selected || !transport) throw new Error('审阅服务未连接')
    const [preview, baseline] = await Promise.allSettled([
      transport.invoke('document.changeset.preview', { changeSetId: id }),
      transport.invoke('document.snapshot_at', {
        documentId: selected.documentId,
        revisionId: selected.baseRevisionId,
      }),
    ])
    if (disposed || sequence !== previewSequence) return
    if (preview.status === 'fulfilled')
      reviewPreview.value = preview.value as { before: string; after: string }
    else
      reviewPreviewError.value =
        preview.reason instanceof Error ? preview.reason.message : '排版预览暂不可用'
    if (baseline.status === 'fulfilled') reviewSnapshot.value = baseline.value as DocumentSnapshot
    else
      reviewPreviewError.value =
        baseline.reason instanceof Error ? baseline.reason.message : '原文暂不可用'
    const summary = store.semanticDiff?.summary
    reviewView.value =
      reviewSnapshot.value &&
      summary?.changedTextNodes &&
      !summary.insertedNodes &&
      !summary.deletedNodes &&
      !summary.movedNodes &&
      !summary.renamedDocuments &&
      !reviewSnapshot.value.nodes.some((node) => node.type === 'asset')
        ? 'text'
        : 'layout'
  })
}
async function switchMode(next: 'create' | 'read' | 'review') {
  if (
    next === 'review' &&
    store.selectedChangeSet &&
    (!reviewSnapshot.value ||
      reviewSnapshot.value.revisionId !== store.selectedChangeSet.baseRevisionId)
  ) {
    await selectChangeSet(store.selectedChangeSet.changeSetId)
    return
  }
  if (next === 'review' && !store.selectedChangeSet && store.pendingChangeSets[0]) {
    await selectChangeSet(store.pendingChangeSets[0].changeSetId)
    return
  }
  await perform(async () => {
    await officeEditor.value?.flush()
    mode.value = next
    if (next === 'review') panel.value = 'review'
  })
}
async function review(decision: 'approve' | 'reject' | 'request_changes') {
  const changeSet = store.selectedChangeSet
  if (!changeSet) return
  await perform(async () => {
    const position = captureReadingPosition(
      workbenchElement.value?.querySelector<HTMLElement>('.review-stage'),
    )
    const changedNodes = store.semanticDiff?.textChanges.map((change) => change.nodeId) ?? []
    if (!store.transport || !store.session) throw new Error('审阅服务未连接')
    await store.reviewChangeSet(changeSet.changeSetId, decision, reviewMessage.value.trim())
    if (decision === 'request_changes') {
      composerTask.value = '调整：' + changeSet.intent
      composerRequirements.value = reviewMessage.value.trim()
      composerScope.value = 'document'
      composerNodeId.value = undefined
      composerSelection.value = undefined
      composerAgentId.value = store.collaborationAgents.some(
        (agent) => agent.id === changeSet.actorPrincipalId.replace(/^agent:/, ''),
      )
        ? changeSet.actorPrincipalId.replace(/^agent:/, '')
        : (store.collaborationAgents[0]?.id ?? '')
      panel.value = 'compose'
    }
    mode.value = 'create'
    reviewPreview.value = undefined
    reviewMessage.value = ''
    reviewFeedback.value =
      decision === 'approve'
        ? '已接受修改'
        : decision === 'reject'
          ? '已拒绝修改'
          : '已记录调整意见'
    if (feedbackTimer) window.clearTimeout(feedbackTimer)
    feedbackTimer = window.setTimeout(() => {
      reviewFeedback.value = ''
    }, 3500)
    await nextTick()
    restoreReadingPosition(
      workbenchElement.value?.querySelector<HTMLElement>('.office-scroll'),
      position,
    )
    if (decision === 'approve') settleReview(changedNodes)
  })
}
async function openComment(id: string) {
  const selection = officeEditor.value?.getSelection()
  await perform(async () => {
    await officeEditor.value?.flush()
    commentNode.value = activeSnapshot.value?.nodes.find((node) => node.nodeId === id)
    if (!commentNode.value) throw new Error('未找到评论位置')
    commentRange.value =
      selection?.anchor.nodeId === id &&
      selection.focus.nodeId === id &&
      selection.anchor.offset !== selection.focus.offset
        ? {
            start: Math.min(selection.anchor.offset, selection.focus.offset),
            end: Math.max(selection.anchor.offset, selection.focus.offset),
          }
        : undefined
    commentBody.value = ''
    panel.value = 'comments'
  })
}
async function submitComment() {
  if (!commentNode.value || !commentBody.value.trim()) return
  await perform(async () => {
    await officeEditor.value?.flush()
    const node = activeSnapshot.value?.nodes.find(
      (item) => item.nodeId === commentNode.value!.nodeId,
    )
    if (!node || node.text !== commentNode.value!.text)
      throw new Error('原文已更新，请重新选择评论位置')
    await store.createComment(node.nodeId, commentBody.value.trim(), commentRange.value)
    commentNode.value = undefined
    commentBody.value = ''
  })
}
function openRename() {
  renameTitle.value = store.documentTitle
  renameError.value = ''
  renameOpen.value = true
}
async function rename() {
  if (busy.value || !renameTitle.value.trim()) return
  busy.value = true
  try {
    await officeEditor.value?.flush()
    await store.renameDocument(renameTitle.value.trim())
    renameOpen.value = false
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : '重命名失败'
  } finally {
    busy.value = false
  }
}
async function previewRevision(id: string) {
  await perform(async () => {
    const result = (await store.transport?.invoke('document.preview', {
      documentId: store.activeDocumentId,
      revisionId: id,
    })) as { html: string }
    historicalPreview.value = result.html
  })
}
async function restoreRevision() {
  const id = restoreId.value
  if (!id) return
  await perform(async () => {
    await officeEditor.value?.flush()
    await store.restoreRevision(id)
    historicalPreview.value = ''
    restoreId.value = undefined
    mode.value = 'create'
  })
}
async function importSelected(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (file)
    await perform(async () => {
      await officeEditor.value?.flush()
      await store.importProject(file)
      if (store.activeDocumentId)
        await router.replace({ name: 'workbench', params: { documentId: store.activeDocumentId } })
    })
  input.value = ''
}
async function exportProject() {
  await perform(async () => {
    await officeEditor.value?.flush()
    await store.exportProject()
  })
}
const actions: WorkspaceActions = {
  rename: openRename,
  save: async () => {
    await officeEditor.value?.flush()
  },
  prepareExit: async (keepDraft) => {
    if (busy.value || store.collaborationBusy) throw new Error('请等待当前操作完成')
    await officeEditor.value?.prepareExit(keepDraft)
  },
  resume: () => officeEditor.value?.resumeAfterExitFailure(),
  canKeepDraft: () =>
    !!officeEditor.value?.session?.recoverable && !officeEditor.value?.hasPendingAssets,
  hasPendingInput: () => !!officeEditor.value?.hasPendingAssets,
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape' && !renameOpen.value && !restoreId.value) {
    if (store.focusMode) store.toggleFocusMode()
    else panel.value = null
  }
}
onMounted(async () => {
  workspaceActions.value = actions
  store.activeNavigator = 'outline'
  window.addEventListener('keydown', keys)
  const id = typeof route.params.documentId === 'string' ? route.params.documentId : undefined
  if (id && id !== store.activeDocumentId && store.connection === 'ready')
    await perform(() => store.openDocument(id))
  if (typeof route.query.node === 'string') await scrollToNode(route.query.node)
  collaborationTimer = window.setInterval(() => {
    if (
      !store.applicationStopping &&
      store.collaborationTasks.some((task) => ['queued', 'working'].includes(task.status))
    )
      void store.loadCollaborationTasks().catch(fail)
  }, 3000)
})
onBeforeUnmount(() => {
  disposed = true
  previewSequence++
  if (workspaceActions.value === actions) workspaceActions.value = undefined
  window.removeEventListener('keydown', keys)
  if (collaborationTimer) window.clearInterval(collaborationTimer)
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
})
onBeforeRouteLeave(async () => {
  if (store.applicationStopped) return true
  if (store.applicationStopping || busy.value) return false
  try {
    await officeEditor.value?.flush()
    return true
  } catch (error) {
    if (officeEditor.value?.hasPendingAssets) {
      fail(error)
      return false
    }
    if (officeEditor.value?.session?.recoverable) {
      store.errorMessage = '未同步的草稿已保留'
      return true
    }
    store.errorMessage = '草稿尚未保存，请先备份或处理保存问题'
    return false
  }
})
</script>

<template>
  <main ref="workbenchElement" class="workbench" :class="{ 'focus-mode': store.focusMode }">
    <nav
      ref="menuBar"
      class="workbench-menubar"
      :aria-label="__t('apps.arca.ui', '文稿工具')"
      :inert="busy"
    >
      <details ref="fileMenu" class="editor-file-menu workbench-file-menu">
        <summary>{{ __t('apps.arca.ui', '文件') }}</summary>
        <div class="context-menu" @click="closeFileMenu">
          <button type="button" @click="router.push('/')">
            {{ __t('apps.arca.ui', '文稿库') }}
          </button>
          <button type="button" @click="router.push({ name: 'home', query: { new: '1' } })">
            {{ __t('apps.arca.ui', '新建文稿') }}
          </button>
          <button type="button" @click="openRename">{{ __t('apps.arca.ui', '重命名') }}</button>
          <hr />
          <button type="button" @click="officeEditor?.preview()">
            {{ __t('apps.arca.ui', '预览与打印') }}
          </button>
          <button type="button" @click="officeEditor?.preview(true)">
            {{ __t('apps.arca.ui', '导出 HTML') }}
          </button>
          <button type="button" @click="exportProject">
            {{ __t('apps.arca.ui', '导出工程') }}
          </button>
          <button type="button" @click="packageInput?.click()">
            {{ __t('apps.arca.ui', '打开工程') }}
          </button>
          <button type="button" @click="officeEditor?.backup()">
            {{ __t('apps.arca.ui', '备份') }}
          </button>
          <button
            v-if="officeEditor?.session?.hasChanges"
            type="button"
            @click="officeEditor?.saveCopy()"
          >
            {{ __t('apps.arca.ui', '另存副本') }}
          </button>
        </div>
      </details>
      <button
        v-for="tab in ribbonTabs"
        :key="tab.id"
        class="workbench-menu-tab"
        :aria-pressed="selectedRibbon === tab.id"
        :class="{ active: selectedRibbon === tab.id }"
        type="button"
        @mousedown.prevent
        @click="selectTool(tab.id)"
      >
        {{ tab.label }}
      </button>
      <span class="active-indicator" aria-hidden="true" />
      <span class="toolbar-spacer" />
      <button
        class="collaborate-action"
        type="button"
        :disabled="
          !activeSnapshot ||
          activeSnapshot.document.status !== 'active' ||
          store.authority === 'conflict'
        "
        @click="openComposer()"
      >
        <ArcaIcon name="sparkle" :size="16" />
        {{ __t('apps.arca.ui', '协作') }}
      </button>
      <button
        class="icon-button"
        type="button"
        :title="__t('apps.arca.ui', '评论')"
        :aria-label="__t('apps.arca.ui', '评论')"
        :aria-pressed="panel === 'comments'"
        @click="togglePanel('comments')"
      >
        <ArcaIcon name="comment" :size="16" />
      </button>
      <details class="editor-file-menu workbench-view-menu">
        <summary>
          {{
            mode === 'create'
              ? __t('apps.arca.ui', '编辑')
              : mode === 'read'
                ? __t('apps.arca.ui', '阅读')
                : __t('apps.arca.ui', '审阅')
          }}
          <ArcaIcon name="chevron" :size="11" />
        </summary>
        <div class="context-menu">
          <button type="button" @click="switchMode('create')">
            {{ __t('apps.arca.ui', '编辑') }}
          </button>
          <button type="button" @click="switchMode('read')">
            {{ __t('apps.arca.ui', '阅读') }}
          </button>
          <button type="button" @click="switchMode('review')">
            {{ __t('apps.arca.ui', '待审修改') }} {{ reviewCount || '' }}
          </button>
          <hr />
          <button type="button" @click="togglePanel('properties')">
            {{ __t('apps.arca.ui', '属性') }}
          </button>
          <button type="button" @click="togglePanel('activity')">
            {{ __t('apps.arca.ui', '协作活动') }}
          </button>
          <button type="button" @click="togglePanel('revisions')">
            {{ __t('apps.arca.ui', '历史版本') }}
          </button>
          <button type="button" @click="store.toggleNavigator('documents')">
            {{ __t('apps.arca.ui', '切换文稿') }}
          </button>
          <button type="button" @click="store.toggleFocusMode()">
            {{ store.focusMode ? __t('apps.arca.ui', '退出专注') : __t('apps.arca.ui', '专注') }}
          </button>
        </div>
      </details>
    </nav>
    <div ref="toolbarTarget" class="workbench-ribbon" :inert="busy" />
    <div v-if="mode === 'review'" class="review-commandbar">
      <button type="button" @click="togglePanel('review')">
        <ArcaIcon name="compare" :size="16" />
        {{ __t('apps.arca.ui', '待审修改') }}
        <span v-if="reviewCount">{{ reviewCount }}</span>
      </button>
      <button type="button" @click="togglePanel('revisions')">
        <ArcaIcon name="clock" :size="16" />
        {{ __t('apps.arca.ui', '历史版本') }}
      </button>
      <span class="toolbar-spacer" />
      <button type="button" @click="switchMode('create')">
        {{ __t('apps.arca.ui', '返回编辑') }}
      </button>
    </div>

    <div class="workbench-body">
      <Transition name="navigator" @before-enter="activateSurface" @before-leave="retireSurface">
        <aside v-if="store.activeNavigator && !store.focusMode && !panel" class="navigation-panel">
          <header class="panel-heading">
            <h2>
              {{
                store.activeNavigator === 'documents'
                  ? __t('apps.arca.ui', '文稿')
                  : __t('apps.arca.ui', '大纲')
              }}
            </h2>
            <button
              class="icon-button"
              :aria-label="__t('apps.arca.ui', '收起导航')"
              @click="store.activeNavigator = null"
            >
              <ArcaIcon name="close" :size="16" />
            </button>
          </header>
          <div class="panel-scroll" :inert="busy">
            <template v-if="store.activeNavigator === 'documents'">
              <button
                v-for="item in store.documents.filter((item) => item.status === 'active')"
                :key="item.documentId"
                class="navigation-row"
                :class="{ active: item.documentId === store.activeDocumentId }"
                :disabled="busy"
                @click="openDocument(item.documentId)"
              >
                <ArcaIcon name="file" :size="16" />
                <span>{{ item.title }}</span>
              </button>
            </template>
            <template v-else>
              <OutlineTree
                :nodes="store.activeDocument?.outline.content ?? []"
                :active-id="activeOutlineId"
                @select="scrollToNode"
              />
              <p v-if="!store.activeDocument?.outline.content.length" class="panel-empty">
                {{ __t('apps.arca.ui', '暂无标题') }}
              </p>
            </template>
          </div>
        </aside>
      </Transition>
      <section class="document-stage" :aria-busy="busy" :inert="busy">
        <template v-if="activeSnapshot">
          <OfficeEditor
            v-show="mode !== 'review'"
            ref="officeEditor"
            :snapshot="activeSnapshot"
            :writable="
              store.authority !== 'conflict' && activeSnapshot.document.status === 'active'
            "
            :mode="mode"
            :toolbar-target="toolbarTarget"
            @collaborate="openComposer"
            @comment="openComment"
            @copy="openDocument"
            @export-project="exportProject"
            @import-project="packageInput?.click()"
            @inspect="inspect"
            @rename="openRename"
          />
          <section v-if="mode === 'review'" class="review-stage">
            <header class="review-stage-heading">
              <span>
                {{
                  store.selectedChangeSet
                    ? actorLabel(store.selectedChangeSet.actorPrincipalId) +
                      __t('apps.arca.ui', ' 的修改')
                    : __t('apps.arca.ui', '审阅')
                }}
              </span>
              <span class="toolbar-spacer" />
              <div v-if="reviewView === 'text'" class="review-display-switch">
                <button
                  :aria-pressed="showReviewChanges"
                  :class="{ active: showReviewChanges }"
                  @click="showReviewChanges = true"
                >
                  {{ __t('apps.arca.ui', '显示改动') }}
                </button>
                <button
                  :aria-pressed="!showReviewChanges"
                  :class="{ active: !showReviewChanges }"
                  @click="showReviewChanges = false"
                >
                  {{ __t('apps.arca.ui', '修改后') }}
                </button>
              </div>
              <details class="editor-file-menu">
                <summary>
                  {{
                    reviewView === 'text'
                      ? __t('apps.arca.ui', '正文')
                      : __t('apps.arca.ui', '排版')
                  }}
                </summary>
                <div class="context-menu">
                  <button @click="reviewView = 'text'">
                    {{ __t('apps.arca.ui', '正文改动') }}
                  </button>
                  <button @click="reviewView = 'layout'">
                    {{ __t('apps.arca.ui', '排版对照') }}
                  </button>
                </div>
              </details>
            </header>
            <div v-if="!store.selectedChangeSet" class="surface-empty">
              <ArcaIcon name="check" :size="32" />
              <strong>
                {{
                  reviewCount
                    ? __t('apps.arca.ui', '选择一项变更')
                    : __t('apps.arca.ui', '暂无待审变更')
                }}
              </strong>
            </div>
            <template v-else-if="reviewView === 'text'">
              <DocumentReview
                v-if="reviewSnapshot && store.semanticDiff"
                :snapshot="reviewSnapshot"
                :diff="store.semanticDiff"
                :show-changes="showReviewChanges"
              />
              <p v-else class="panel-empty">
                {{ reviewPreviewError || __t('apps.arca.ui', '正在读取原文…') }}
              </p>
              <button
                v-if="
                  store.semanticDiff &&
                  (store.semanticDiff.summary.insertedNodes ||
                    store.semanticDiff.summary.deletedNodes ||
                    store.semanticDiff.summary.movedNodes ||
                    store.semanticDiff.summary.changedAttributes)
                "
                class="review-layout-hint"
                @click="reviewView = 'layout'"
              >
                {{ __t('apps.arca.ui', '查看结构与排版变化') }}
                <ArcaIcon name="arrow" :size="14" />
              </button>
            </template>
            <div v-else-if="reviewPreview" class="layout-diff">
              <section>
                <h3>{{ __t('apps.arca.ui', '修改前') }}</h3>
                <iframe
                  :title="__t('apps.arca.ui', '修改前')"
                  sandbox=""
                  :srcdoc="reviewPreview.before"
                />
              </section>
              <section>
                <h3>{{ __t('apps.arca.ui', '修改后') }}</h3>
                <iframe
                  :title="__t('apps.arca.ui', '修改后')"
                  sandbox=""
                  :srcdoc="reviewPreview.after"
                />
              </section>
            </div>
            <p v-else class="panel-empty">
              {{ reviewPreviewError || __t('apps.arca.ui', '正在读取预览…') }}
            </p>
          </section>
        </template>
        <div v-else class="surface-empty">
          <strong>{{ __t('apps.arca.ui', '未打开文稿') }}</strong>
          <button class="primary-button" @click="router.push('/')">
            {{ __t('apps.arca.ui', '返回文稿列表') }}
          </button>
        </div>
      </section>
      <Transition name="inspector" @before-enter="activateSurface" @before-leave="retireSurface">
        <aside v-if="panel && !store.focusMode" class="inspector-panel">
          <header class="panel-heading">
            <h2>{{ panelTitles[panel] }}</h2>
            <button
              class="icon-button"
              :aria-label="__t('apps.arca.ui', '收起面板')"
              @click="panel = null"
            >
              <ArcaIcon name="close" :size="16" />
            </button>
          </header>
          <div class="panel-scroll" :inert="busy">
            <div :key="panel" class="panel-content">
              <template v-if="panel === 'properties'">
                <div v-if="propertyNode && canEdit" class="form-stack">
                  <label>
                    {{ __t('apps.arca.ui', '对齐') }}
                    <ArcaSelect
                      :aria-label="__t('apps.arca.ui', '对齐')"
                      :model-value="String(propertyNode.attributes.align ?? 'left')"
                      :options="[
                        { value: 'left', label: __t('apps.arca.ui', '左对齐') },
                        { value: 'center', label: __t('apps.arca.ui', '居中') },
                        { value: 'right', label: __t('apps.arca.ui', '右对齐') },
                        { value: 'justify', label: __t('apps.arca.ui', '两端对齐') },
                      ]"
                      @change="(value) => officeEditor?.attributes({ align: String(value) })"
                    />
                  </label>
                  <template v-if="propertyNode.type === 'asset'">
                    <label>
                      {{ __t('apps.arca.ui', '替代文本') }}
                      <input
                        :value="propertyNode.attributes.alt"
                        @change="
                          officeEditor?.attributes({
                            alt: ($event.target as HTMLInputElement).value,
                          })
                        "
                      />
                    </label>
                    <label>
                      {{ __t('apps.arca.ui', '图注') }}
                      <input
                        :value="propertyNode.attributes.caption"
                        @change="
                          officeEditor?.attributes({
                            caption: ($event.target as HTMLInputElement).value,
                          })
                        "
                      />
                    </label>
                    <label>
                      {{ __t('apps.arca.ui', '宽度（px）') }}
                      <input
                        type="number"
                        min="24"
                        max="1600"
                        :value="propertyNode.attributes.width ?? 480"
                        @change="
                          officeEditor?.attributes({
                            width: Math.max(
                              24,
                              Math.min(
                                1600,
                                Number(($event.target as HTMLInputElement).value) || 480,
                              ),
                            ),
                          })
                        "
                      />
                    </label>
                    <button @click="officeEditor?.chooseImage()">
                      {{ __t('apps.arca.ui', '替换图片') }}
                    </button>
                  </template>
                  <template v-else>
                    <label>
                      {{ __t('apps.arca.ui', '行距') }}
                      <input
                        type="number"
                        min="1"
                        max="3"
                        step="0.1"
                        :value="propertyNode.attributes.lineHeight ?? 1.7"
                        @change="
                          officeEditor?.attributes({
                            lineHeight: Math.max(
                              1,
                              Math.min(3, Number(($event.target as HTMLInputElement).value) || 1.7),
                            ),
                          })
                        "
                      />
                    </label>
                    <label>
                      {{ __t('apps.arca.ui', '缩进') }}
                      <input
                        type="number"
                        min="0"
                        max="12"
                        :value="propertyNode.attributes.indent ?? 0"
                        @change="
                          officeEditor?.attributes({
                            indent: Math.max(
                              0,
                              Math.min(12, Number(($event.target as HTMLInputElement).value) || 0),
                            ),
                          })
                        "
                      />
                    </label>
                  </template>
                  <template v-if="officeEditor?.cell">
                    <label>
                      {{ __t('apps.arca.ui', '列宽（px）') }}
                      <input
                        type="number"
                        min="24"
                        max="1600"
                        :value="officeEditor.selectedColumnWidth"
                        @change="
                          officeEditor?.columnWidth(
                            Number(($event.target as HTMLInputElement).value),
                          )
                        "
                      />
                    </label>
                    <button
                      @click="
                        officeEditor?.attributes({
                          headerCell: !propertyNode.attributes.headerCell,
                        })
                      "
                    >
                      {{ __t('apps.arca.ui', '切换表头') }}
                    </button>
                    <label>
                      {{ __t('apps.arca.ui', '边框颜色') }}
                      <input
                        type="color"
                        :value="propertyNode.attributes.borderColor ?? '#b4b4b4'"
                        @change="
                          officeEditor?.attributes({
                            borderColor: ($event.target as HTMLInputElement).value,
                            borderStyle: 'solid',
                          })
                        "
                      />
                    </label>
                    <button
                      @click="
                        officeEditor?.attributes({
                          borderStyle:
                            propertyNode.attributes.borderStyle === 'none' ? 'solid' : 'none',
                        })
                      "
                    >
                      {{ __t('apps.arca.ui', '切换边框') }}
                    </button>
                  </template>
                </div>
                <p v-else class="panel-empty">
                  {{
                    canEdit
                      ? __t('apps.arca.ui', '选择正文中的内容')
                      : __t('apps.arca.ui', '切换到编辑模式以设置属性')
                  }}
                </p>
              </template>
              <form
                v-else-if="panel === 'compose'"
                class="form-stack"
                @submit.prevent="submitCollaboration"
              >
                <div class="collaborator-heading">
                  <label>
                    <span>{{ __t('apps.arca.ui', '协作者') }}</span>
                    <ArcaSelect
                      v-model="composerAgentId"
                      :aria-label="__t('apps.arca.ui', '协作者')"
                      :options="collaboratorOptions"
                    />
                  </label>
                </div>
                <div>
                  <span class="field-caption">{{ __t('apps.arca.ui', '范围') }}</span>
                  <div
                    class="scope-switch"
                    role="group"
                    :aria-label="__t('apps.arca.ui', '协作范围')"
                  >
                    <button
                      type="button"
                      :aria-pressed="composerScope === 'selection'"
                      :disabled="
                        !composerSelection ||
                        (composerSelection.anchor.nodeId === composerSelection.focus.nodeId &&
                          composerSelection.anchor.offset === composerSelection.focus.offset)
                      "
                      @click="composerScope = 'selection'"
                    >
                      {{ __t('apps.arca.ui', '选区') }}
                    </button>
                    <button
                      type="button"
                      :aria-pressed="composerScope === 'section'"
                      :disabled="!composerNodeId"
                      @click="composerScope = 'section'"
                    >
                      {{ __t('apps.arca.ui', '章节') }}
                    </button>
                    <button
                      type="button"
                      :aria-pressed="composerScope === 'document'"
                      @click="composerScope = 'document'"
                    >
                      {{ __t('apps.arca.ui', '全文') }}
                    </button>
                  </div>
                </div>
                <label>
                  {{ __t('apps.arca.ui', '修改要求') }}
                  <textarea
                    v-model="composerTask"
                    rows="5"
                    :placeholder="__t('apps.arca.ui', '希望如何修改？')"
                    required
                  />
                </label>
                <div class="collaboration-shortcuts">
                  <button
                    type="button"
                    @click="
                      composerTask = __t('apps.arca.ui', '润色文字，保留原有语气与关键信息。')
                    "
                  >
                    {{ __t('apps.arca.ui', '润色') }}
                  </button>
                  <button
                    type="button"
                    @click="composerTask = __t('apps.arca.ui', '精简表述，保留原意与关键信息。')"
                  >
                    {{ __t('apps.arca.ui', '精简') }}
                  </button>
                  <button
                    type="button"
                    @click="composerTask = __t('apps.arca.ui', '整理结构，让重点更清楚。')"
                  >
                    {{ __t('apps.arca.ui', '整理结构') }}
                  </button>
                </div>
                <details class="composer-extra">
                  <summary>{{ __t('apps.arca.ui', '附加要求') }}</summary>
                  <textarea
                    v-model="composerRequirements"
                    rows="3"
                    :aria-label="__t('apps.arca.ui', '附加要求')"
                    :placeholder="__t('apps.arca.ui', '可选')"
                  />
                </details>
                <p v-if="!store.collaborationAvailable" class="form-error">
                  {{ __t('apps.arca.ui', '协作暂不可用，请检查连接与模型设置。') }}
                </p>
                <p v-if="composerError" class="form-error" role="alert">{{ composerError }}</p>
                <button
                  class="primary-button"
                  type="submit"
                  :disabled="
                    !composerTask.trim() ||
                    !composerAgentId ||
                    !store.collaborationAvailable ||
                    store.collaborationBusy
                  "
                >
                  {{
                    store.collaborationBusy
                      ? __t('apps.arca.ui', '提交中…')
                      : composerActor
                        ? __t('apps.arca.ui', '交给 ') + composerActor
                        : __t('apps.arca.ui', '开始协作')
                  }}
                  <ArcaIcon name="arrow" :size="15" />
                </button>
                <blockquote
                  v-if="composerQuote && composerScope !== 'document'"
                  class="composer-quote"
                >
                  {{ composerQuote.slice(0, 260) }}
                </blockquote>
                <button
                  class="collaboration-activity-link"
                  type="button"
                  @click="panel = 'activity'"
                >
                  {{ __t('apps.arca.ui', '协作活动') }}
                  <ArcaIcon name="chevron" :size="13" />
                </button>
              </form>
              <template v-else-if="panel === 'activity'">
                <button
                  class="primary-button panel-primary"
                  :disabled="busy || !canEdit"
                  @click="openComposer()"
                >
                  <ArcaIcon name="plus" :size="16" />
                  {{ __t('apps.arca.ui', '发起协作') }}
                </button>
                <article
                  v-for="task in store.collaborationTasks"
                  :key="task.taskId"
                  class="panel-card"
                >
                  <div class="card-meta">
                    <strong>{{ actorLabel(task.agentId) }}</strong>
                    <span class="task-status" :data-status="task.status">
                      {{ taskLabel(task.status) }}
                    </span>
                  </div>
                  <p>{{ task.instruction }}</p>
                  <pre v-if="task.resultText" class="task-result">{{ task.resultText }}</pre>
                  <p v-if="task.error" class="form-error">{{ task.error }}</p>
                  <div class="card-actions">
                    <button
                      v-if="
                        task.changeSetId && ['awaiting_review', 'completed'].includes(task.status)
                      "
                      :disabled="busy"
                      @click="selectChangeSet(task.changeSetId)"
                    >
                      {{ __t('apps.arca.ui', '审阅') }}
                    </button>
                    <button
                      v-if="['queued', 'working'].includes(task.status)"
                      :disabled="busy"
                      @click="perform(() => store.cancelCollaborationTask(task.taskId))"
                    >
                      {{ __t('apps.arca.ui', '取消') }}
                    </button>
                    <button
                      v-if="
                        task.source === 'local' && task.status === 'failed' && !task.changeSetId
                      "
                      :disabled="busy"
                      @click="perform(() => store.retryCollaborationTask(task.taskId))"
                    >
                      {{ __t('apps.arca.ui', '重试') }}
                    </button>
                  </div>
                </article>
                <p v-if="!store.collaborationTasks.length" class="panel-empty">
                  {{ __t('apps.arca.ui', '暂无协作任务') }}
                </p>
              </template>
              <template v-else-if="panel === 'review'">
                <section v-if="store.selectedChangeSet" class="review-decision form-stack">
                  <div class="collaborator-heading">
                    <ArcaAvatar
                      :agent-id="store.selectedChangeSet.actorPrincipalId"
                      :name="actorLabel(store.selectedChangeSet.actorPrincipalId)"
                    />
                    <div>
                      <strong>{{ actorLabel(store.selectedChangeSet.actorPrincipalId) }}</strong>
                      <small>
                        {{ store.semanticDiff?.summary.changedTextNodes ?? 0 }}
                        {{ __t('apps.arca.ui', '处文本修改') }}
                      </small>
                    </div>
                  </div>
                  <div class="review-intent">
                    <h3>{{ store.selectedChangeSet.intent }}</h3>
                    <span>{{ __t('apps.arca.ui', '待审阅') }}</span>
                  </div>
                  <p>{{ store.selectedChangeSet.explanation }}</p>
                  <p
                    v-if="store.selectedChangeSet.baseRevisionId !== activeSnapshot?.revisionId"
                    class="form-error"
                  >
                    {{ __t('apps.arca.ui', '文稿已更新，请重新发起协作。') }}
                  </p>
                  <label>
                    {{ __t('apps.arca.ui', '审阅意见') }}
                    <textarea
                      v-model="reviewMessage"
                      rows="4"
                      :placeholder="__t('apps.arca.ui', '添加意见')"
                    />
                  </label>
                  <button
                    class="primary-button"
                    :disabled="
                      busy ||
                      !['validated', 'approved'].includes(store.selectedChangeSet.status) ||
                      store.selectedChangeSet.baseRevisionId !== activeSnapshot?.revisionId
                    "
                    @click="review('approve')"
                  >
                    <ArcaIcon name="check" :size="16" />
                    {{ __t('apps.arca.ui', '接受修改') }}
                  </button>
                  <div class="review-other-actions">
                    <button
                      :disabled="busy || !reviewMessage.trim()"
                      @click="review('request_changes')"
                    >
                      {{ __t('apps.arca.ui', '要求调整') }}
                    </button>
                    <button :disabled="busy" @click="review('reject')">
                      {{ __t('apps.arca.ui', '拒绝') }}
                    </button>
                  </div>
                </section>
                <div
                  v-if="store.pendingChangeSets.length > (store.selectedChangeSet ? 1 : 0)"
                  class="proposal-list"
                >
                  <h3>
                    {{
                      store.selectedChangeSet
                        ? __t('apps.arca.ui', '其他修改')
                        : __t('apps.arca.ui', '待审修改')
                    }}
                  </h3>
                  <button
                    v-for="changeSet in store.pendingChangeSets.filter(
                      (item) => item.changeSetId !== store.selectedChangeSet?.changeSetId,
                    )"
                    :key="changeSet.changeSetId"
                    class="proposal-row"
                    :disabled="busy"
                    @click="selectChangeSet(changeSet.changeSetId)"
                  >
                    <strong>{{ changeSet.intent }}</strong>
                    <small>{{ actorLabel(changeSet.actorPrincipalId) }}</small>
                  </button>
                </div>
                <p v-else-if="!reviewCount" class="panel-empty">
                  {{ __t('apps.arca.ui', '暂无待审变更') }}
                </p>
              </template>
              <template v-else-if="panel === 'comments'">
                <form
                  v-if="commentNode"
                  class="form-stack comment-composer"
                  @submit.prevent="submitComment"
                >
                  <blockquote>{{ commentNode.text?.slice(0, 100) }}</blockquote>
                  <textarea
                    v-model="commentBody"
                    :aria-label="__t('apps.arca.ui', '评论内容')"
                    rows="3"
                    :placeholder="__t('apps.arca.ui', '添加评论')"
                    required
                  />
                  <div class="card-actions">
                    <button type="button" @click="commentNode = undefined">
                      {{ __t('apps.arca.ui', '取消') }}
                    </button>
                    <button class="primary-button" :disabled="busy || !commentBody.trim()">
                      {{ __t('apps.arca.ui', '发送') }}
                    </button>
                  </div>
                </form>
                <article
                  v-for="comment in store.comments"
                  :key="comment.commentId"
                  class="panel-card"
                >
                  <div class="card-meta">
                    <strong>{{ actorLabel(comment.authorPrincipalId) }}</strong>
                    <small>
                      {{
                        comment.status === 'open'
                          ? __t('apps.arca.ui', '待解决')
                          : __t('apps.arca.ui', '已解决')
                      }}
                    </small>
                  </div>
                  <blockquote v-if="comment.anchor">{{ comment.anchor.quote }}</blockquote>
                  <p>{{ comment.body }}</p>
                  <small v-if="comment.anchorState && comment.anchorState !== 'attached'">
                    {{ __t('apps.arca.ui', '原文位置已变化') }}
                  </small>
                  <div class="card-actions">
                    <button
                      v-if="comment.status === 'open'"
                      :disabled="busy"
                      @click="perform(() => store.resolveComment(comment.commentId))"
                    >
                      {{ __t('apps.arca.ui', '标记解决') }}
                    </button>
                  </div>
                </article>
                <p v-if="!store.comments.length && !commentNode" class="panel-empty">
                  {{ __t('apps.arca.ui', '暂无评论') }}
                </p>
              </template>
              <template v-else-if="panel === 'revisions'">
                <article
                  v-for="entry in [...store.revisions].reverse()"
                  :key="entry.revision.revisionId"
                  class="panel-card"
                >
                  <div class="card-meta">
                    <strong>{{ __t('apps.arca.ui', '版本') }} {{ entry.revision.sequence }}</strong>
                    <span v-if="entry.revision.revisionId === activeSnapshot?.revisionId">
                      {{ __t('apps.arca.ui', '当前版本') }}
                    </span>
                  </div>
                  <p>{{ entry.revision.intent }}</p>
                  <small>{{ displayTime(entry.revision.committedAt) }}</small>
                  <div v-if="entry.restorable !== false" class="card-actions">
                    <button :disabled="busy" @click="previewRevision(entry.revision.revisionId)">
                      {{ __t('apps.arca.ui', '查看') }}
                    </button>
                    <button
                      v-if="entry.revision.revisionId !== activeSnapshot?.revisionId"
                      :disabled="
                        busy ||
                        store.authority === 'conflict' ||
                        activeSnapshot?.document.status !== 'active'
                      "
                      @click="restoreId = entry.revision.revisionId"
                    >
                      {{ __t('apps.arca.ui', '恢复此版本') }}
                    </button>
                  </div>
                  <small v-else>{{ __t('apps.arca.ui', '无预览快照') }}</small>
                </article>
                <p v-if="!store.revisions.length" class="panel-empty">
                  {{ __t('apps.arca.ui', '暂无历史版本') }}
                </p>
              </template>
            </div>
          </div>
        </aside>
      </Transition>
    </div>
    <footer class="workbench-status">
      <span>{{ store.wordCount }} {{ __t('apps.arca.ui', '字符') }}</span>
      <button v-if="reviewCount" @click="switchMode('review')">
        {{ reviewCount }} {{ __t('apps.arca.ui', '项待审') }}
      </button>
      <span class="operation-receipt" role="status" aria-live="polite">{{ reviewFeedback }}</span>
      <span class="toolbar-spacer" />
      <template v-if="mode !== 'review'">
        <button @click="officeEditor?.toggleView()">
          {{
            officeEditor?.viewMode === 'continuous'
              ? __t('apps.arca.ui', '连续视图')
              : __t('apps.arca.ui', '页面视图')
          }}
        </button>
        <label class="zoom-control">
          <input
            type="range"
            min="50"
            max="150"
            step="10"
            :aria-label="__t('apps.arca.ui', '缩放')"
            :value="officeEditor?.zoom ?? 100"
            @input="officeEditor?.setZoom(Number(($event.target as HTMLInputElement).value))"
          />
          <span>{{ officeEditor?.zoom ?? 100 }}%</span>
        </label>
      </template>
      <ConnectionBadge />
    </footer>
    <ArcaDialog
      :open="renameOpen"
      :title="__t('apps.arca.ui', '重命名')"
      :busy="busy"
      @close="renameOpen = false"
    >
      <form id="arca-rename" class="form-stack" @submit.prevent="rename">
        <label>
          {{ __t('apps.arca.ui', '名称') }}
          <input v-model="renameTitle" maxlength="120" required />
        </label>
        <p v-if="renameError" class="form-error">{{ renameError }}</p>
      </form>
      <template #footer>
        <button :disabled="busy" @click="renameOpen = false">
          {{ __t('apps.arca.ui', '取消') }}
        </button>
        <button
          class="primary-button"
          type="submit"
          form="arca-rename"
          :disabled="busy || !renameTitle.trim()"
        >
          {{ __t('apps.arca.ui', '保存') }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="Boolean(restoreId)"
      :title="__t('apps.arca.ui', '恢复此版本？')"
      :busy="busy"
      @close="restoreId = undefined"
    >
      <p>{{ __t('apps.arca.ui', '当前内容仍保留在历史版本中。') }}</p>
      <template #footer>
        <button :disabled="busy" @click="restoreId = undefined">
          {{ __t('apps.arca.ui', '取消') }}
        </button>
        <button class="primary-button" :disabled="busy" @click="restoreRevision">
          {{ __t('apps.arca.ui', '恢复') }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="Boolean(historicalPreview)"
      :title="__t('apps.arca.ui', '历史版本')"
      wide
      @close="historicalPreview = ''"
    >
      <iframe
        class="history-preview"
        :title="__t('apps.arca.ui', '历史版本预览')"
        sandbox=""
        :srcdoc="historicalPreview"
      />
    </ArcaDialog>
    <input ref="packageInput" type="file" accept=".arca" hidden @change="importSelected" />
  </main>
</template>
