<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { DocumentSnapshot, SemanticDocument } from '@infos/document-engine'
import ArcaIcon from '../components/ArcaIcon.vue'
import ArcaDialog from '../components/ArcaDialog.vue'
import ConnectionBadge from '../components/ConnectionBadge.vue'
import DocumentCover from '../components/DocumentCover.vue'
import ArcaSelect from '../components/ArcaSelect.vue'
import { displayTime, nodeText, orderedDocumentNodes } from '../services/documentDisplay'
import { useWorkbenchStore } from '../stores/workbench'
import { useApplicationBusy } from '../services/workspaceUi'
import { useSelectionIndicator } from '../services/surfaceMotion'
import { openBook } from '../services/bookNavigation'

const store = useWorkbenchStore(),
  router = useRouter()
const route = useRoute()
const filterBar = ref<HTMLElement>()
const packageInput = ref<HTMLInputElement>()
const createOpen = ref(false),
  newTitle = ref(''),
  busy = ref(false),
  dialogError = ref('')
useApplicationBusy(busy)
const renameTarget = ref<SemanticDocument>(),
  renameTitle = ref(''),
  renameError = ref('')
const indexMode = ref<'recent' | 'all' | 'favorites' | 'archive' | 'trash'>('recent')
useSelectionIndicator(filterBar, indexMode)
const query = ref(''),
  sort = ref('updated'),
  grid = ref(localStorage.getItem('arca-library-view') !== 'list')
const visibleLimit = ref(24)
const previews = shallowRef<Record<string, DocumentSnapshot>>({})
const favorites = ref<string[]>([])
const menu = ref<{ document: SemanticDocument; x: number; y: number }>()
const menuElement = ref<HTMLElement>()
let menuTrigger: HTMLElement | undefined
let disposed = false
const categories = [
  { id: 'recent', label: '最近', icon: 'clock' },
  { id: 'all', label: '全部', icon: 'file' },
  { id: 'favorites', label: '收藏', icon: 'star' },
  { id: 'archive', label: '归档', icon: 'archive' },
  { id: 'trash', label: '回收站', icon: 'trash' },
] as const
const documents = computed(() => {
  const status =
    indexMode.value === 'archive' ? 'archived' : indexMode.value === 'trash' ? 'deleted' : 'active'
  const list = store.documents.filter(
    (item) =>
      item.status === status &&
      (indexMode.value !== 'favorites' || favorites.value.includes(item.documentId)) &&
      item.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  )
  list.sort((a, b) =>
    sort.value === 'title'
      ? a.title.localeCompare(b.title, 'zh-CN')
      : b.updatedAt.localeCompare(a.updatedAt),
  )
  return indexMode.value === 'recent' ? list.slice(0, 20) : list
})
const title = computed(
  () => categories.find((item) => item.id === indexMode.value)?.label ?? '文稿',
)
const visibleDocuments = computed(() => documents.value.slice(0, visibleLimit.value))
const singleWork = computed(() =>
  grid.value && documents.value.length === 1 ? documents.value[0] : undefined,
)
const singleSnapshot = computed(() => {
  const item = singleWork.value
  const snapshot = item ? previews.value[item.documentId] : undefined
  return snapshot?.revisionId === item?.headRevisionId ? snapshot : undefined
})
const singleNodes = computed(() =>
  singleSnapshot.value ? orderedDocumentNodes(singleSnapshot.value) : [],
)
const singleOutline = computed(() =>
  singleNodes.value.filter((node) => node.type === 'heading').slice(0, 5),
)
const singleExcerpt = computed(() =>
  singleNodes.value.find(
    (node) => ['paragraph', 'quote', 'list-item'].includes(node.type) && nodeText(node).trim(),
  ),
)
const singleWordCount = computed(() =>
  singleNodes.value.reduce((sum, node) => sum + [...nodeText(node)].length, 0),
)
watch([indexMode, query, sort], () => {
  visibleLimit.value = 24
})
function rememberPreview(snapshot: DocumentSnapshot) {
  previews.value = { ...previews.value, [snapshot.documentId]: snapshot }
}
function fail(error: unknown) {
  store.errorMessage = error instanceof Error ? error.message : '操作失败'
}
async function open(id: string, nodeId?: string) {
  if (busy.value) return
  busy.value = true
  try {
    const book = nodeId
      ? undefined
      : (document.querySelector<HTMLElement>(
          '[data-book-id="' + CSS.escape(id) + '"] .document-book',
        ) ?? undefined)
    await openBook(
      book,
      () => store.openDocument(id),
      async () => {
        if (disposed) throw new DOMException('打开操作已取消', 'AbortError')
        const failure = await router.push({
          name: 'workbench',
          params: { documentId: id },
          ...(nodeId ? { query: { node: nodeId } } : {}),
        })
        if (failure) throw new Error('未能打开文稿')
      },
    )
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) fail(error)
  } finally {
    busy.value = false
  }
}
function showCreate() {
  dialogError.value = ''
  newTitle.value = ''
  createOpen.value = true
}
async function create() {
  if (busy.value || !newTitle.value.trim()) return
  busy.value = true
  dialogError.value = ''
  try {
    const id = await store.createDocument(newTitle.value.trim())
    if (!id) throw new Error('创建失败，请确认应用已连接')
    createOpen.value = false
    await router.push({ name: 'workbench', params: { documentId: id } })
  } catch (error) {
    dialogError.value = error instanceof Error ? error.message : '创建失败'
  } finally {
    busy.value = false
  }
}
async function importSelected(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  try {
    await store.importProject(file)
  } catch (error) {
    fail(error)
  } finally {
    input.value = ''
    busy.value = false
  }
}
function showMenu(item: SemanticDocument, event: MouseEvent) {
  event.preventDefault()
  if (busy.value) return
  menuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  const bounds = menuTrigger?.getBoundingClientRect()
  menu.value = {
    document: item,
    x: Math.max(8, Math.min(event.clientX || bounds?.left || 8, window.innerWidth - 210)),
    y: Math.max(8, Math.min(event.clientY || bounds?.bottom || 8, window.innerHeight - 265)),
  }
  void nextTick(() => menuElement.value?.querySelector<HTMLElement>('button')?.focus())
}
function toggleFavorite(item: SemanticDocument) {
  favorites.value = favorites.value.includes(item.documentId)
    ? favorites.value.filter((id) => id !== item.documentId)
    : [...favorites.value, item.documentId]
  try {
    localStorage.setItem('arca-favorites', JSON.stringify(favorites.value))
  } catch {
    store.errorMessage = '收藏未能保存到本机'
  }
  menu.value = undefined
}
function showRename(item: SemanticDocument) {
  renameTarget.value = item
  renameTitle.value = item.title
  renameError.value = ''
  menu.value = undefined
}
async function rename() {
  if (busy.value || !renameTarget.value || !renameTitle.value.trim()) return
  busy.value = true
  try {
    if (store.officeDirty && store.activeDocumentId === renameTarget.value.documentId)
      throw new Error('请先打开文稿处理未同步的草稿')
    await store.renameDocument(renameTitle.value.trim(), renameTarget.value.documentId)
    renameTarget.value = undefined
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : '重命名失败'
  } finally {
    busy.value = false
  }
}
async function manage(item: SemanticDocument, action: 'copy' | 'active' | 'archived' | 'deleted') {
  if (busy.value) return
  busy.value = true
  menu.value = undefined
  try {
    if (action === 'copy') await store.duplicateDocument(item.documentId)
    else await store.setDocumentStatus(item.documentId, action)
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}
function view(gridView: boolean) {
  grid.value = gridView
  try {
    localStorage.setItem('arca-library-view', gridView ? 'grid' : 'list')
  } catch {
    /* 视图偏好存储失败时仍可继续使用。 */
  }
}
function formatTime(value: string) {
  return displayTime(value, true)
}
function closeMenu(event?: Event) {
  if (event instanceof KeyboardEvent && event.key !== 'Escape') return
  if (menu.value && event instanceof KeyboardEvent) menuTrigger?.focus()
  menu.value = undefined
}
function menuKeys(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [
    ...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
  ]
  const index = buttons.findIndex((button) => button === document.activeElement)
  buttons[
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  ]?.focus()
}
onMounted(() => {
  if (route.query.new === '1') showCreate()
  try {
    const value: unknown = JSON.parse(localStorage.getItem('arca-favorites') ?? '[]')
    if (Array.isArray(value))
      favorites.value = value.filter((id): id is string => typeof id === 'string')
  } catch {
    /* 无效收藏缓存不影响文稿列表。 */
  }
  window.addEventListener('click', closeMenu)
  window.addEventListener('keydown', closeMenu)
  window.addEventListener('resize', closeMenu)
})
onBeforeUnmount(() => {
  disposed = true
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('keydown', closeMenu)
  window.removeEventListener('resize', closeMenu)
})
</script>

<template>
  <main class="library">
    <section class="library-main" :aria-busy="busy">
      <header class="library-heading">
        <h1>{{ indexMode === 'archive' || indexMode === 'trash' ? title : '文稿库' }}</h1>
        <div class="library-heading-actions">
          <button
            type="button"
            :disabled="store.connection !== 'ready' || busy"
            @click="packageInput?.click()"
          >
            <ArcaIcon name="folder" :size="16" />
            打开
          </button>
          <button
            class="primary-button"
            type="button"
            :disabled="store.connection !== 'ready' || busy"
            @click="showCreate"
          >
            <ArcaIcon name="plus" :size="16" />
            新建文稿
          </button>
        </div>
      </header>
      <nav ref="filterBar" class="library-filters" aria-label="文稿分类">
        <button
          v-for="item in categories.slice(0, 3)"
          :key="item.id"
          :aria-pressed="indexMode === item.id"
          :class="{ active: indexMode === item.id }"
          @click="indexMode = item.id"
        >
          {{ item.label }}
        </button>
        <span class="active-indicator" aria-hidden="true" />
        <span class="toolbar-spacer" />
        <details class="library-display-menu editor-file-menu">
          <summary aria-label="显示选项">
            <ArcaIcon :name="grid ? 'grid' : 'outline'" :size="16" />
          </summary>
          <div class="context-menu">
            <button type="button" :aria-pressed="grid" @click="view(true)">纸页视图</button>
            <button type="button" :aria-pressed="!grid" @click="view(false)">列表视图</button>
            <label>
              排序
              <ArcaSelect
                v-model="sort"
                aria-label="排序方式"
                :options="[
                  { value: 'updated', label: '最近修改' },
                  { value: 'title', label: '名称' },
                ]"
              />
            </label>
          </div>
        </details>
        <label class="search-field">
          <ArcaIcon name="search" :size="16" />
          <input v-model="query" type="search" aria-label="查找文稿" placeholder="查找文稿" />
        </label>
      </nav>
      <div
        v-if="documents.length"
        class="library-content"
        :class="{ 'single-document': singleWork }"
      >
        <div class="document-collection" :class="{ grid }">
          <div v-if="!grid" class="document-list-head">
            <span>名称</span>
            <span>修改时间</span>
            <span />
          </div>
          <article
            v-for="item in visibleDocuments"
            :key="item.documentId"
            class="document-card"
            :data-book-id="item.documentId"
            @contextmenu="showMenu(item, $event)"
          >
            <button
              class="document-open"
              type="button"
              :disabled="busy"
              @click="open(item.documentId)"
            >
              <DocumentCover v-if="grid" :document="item" @loaded="rememberPreview" />
              <template v-else>
                <ArcaIcon name="file" :size="20" />
                <span class="document-card-title">
                  <strong>{{ item.title }}</strong>
                  <small>文稿</small>
                </span>
              </template>
            </button>
            <div v-if="grid" class="document-caption">
              <button
                v-if="!singleWork"
                class="document-title-button"
                type="button"
                :disabled="busy"
                @click="open(item.documentId)"
              >
                <strong>{{ item.title }}</strong>
                <small>
                  {{
                    store.officeDirty && store.activeDocumentId === item.documentId
                      ? '有本地草稿'
                      : formatTime(item.updatedAt) + ' · 文稿'
                  }}
                </small>
              </button>
              <span v-else class="document-caption-note">
                {{
                  store.officeDirty && store.activeDocumentId === item.documentId
                    ? '有本地草稿'
                    : ''
                }}
              </span>
              <button
                class="icon-button bookmark-button"
                type="button"
                :aria-label="favorites.includes(item.documentId) ? '取消收藏' : '收藏'"
                :aria-pressed="favorites.includes(item.documentId)"
                @click="toggleFavorite(item)"
              >
                <ArcaIcon name="bookmark" :size="16" />
              </button>
              <button
                class="icon-button document-more"
                type="button"
                :disabled="busy"
                :aria-label="item.title + '的更多操作'"
                aria-haspopup="menu"
                @click.stop="showMenu(item, $event)"
              >
                <ArcaIcon name="more" :size="16" />
              </button>
            </div>
            <template v-else>
              <time :datetime="item.updatedAt">{{ formatTime(item.updatedAt) }}</time>
              <button
                class="icon-button document-more"
                type="button"
                :disabled="busy"
                :aria-label="item.title + '的更多操作'"
                aria-haspopup="menu"
                @click.stop="showMenu(item, $event)"
              >
                <ArcaIcon name="more" />
              </button>
            </template>
          </article>
        </div>
        <aside v-if="singleWork" class="document-details">
          <span class="document-eyebrow">
            <ArcaIcon name="file" :size="14" />
            {{
              singleWork.status === 'active'
                ? '继续上次的工作'
                : singleWork.status === 'archived'
                  ? '已归档'
                  : '回收站'
            }}
          </span>
          <h2>{{ singleWork.title }}</h2>
          <p v-if="singleExcerpt" class="document-excerpt">
            {{ nodeText(singleExcerpt).slice(0, 180) }}
          </p>
          <button
            class="primary-button"
            type="button"
            :disabled="busy"
            @click="open(singleWork.documentId)"
          >
            {{ singleWork.status === 'active' ? '继续编辑' : '查看文稿' }}
            <ArcaIcon name="arrow" :size="16" />
          </button>
          <dl class="document-facts">
            <dt>修改</dt>
            <dd>{{ formatTime(singleWork.updatedAt) }}</dd>
            <template v-if="singleSnapshot">
              <dt>字数</dt>
              <dd>{{ singleWordCount.toLocaleString('zh-CN') }} 字</dd>
            </template>
            <dt>语言</dt>
            <dd>{{ singleWork.language.startsWith('zh') ? '中文' : singleWork.language }}</dd>
          </dl>
          <section v-if="singleOutline.length" class="document-outline-preview">
            <h3>文稿大纲</h3>
            <button
              v-for="(node, index) in singleOutline"
              :key="node.nodeId"
              type="button"
              :disabled="busy"
              @click="open(singleWork.documentId, node.nodeId)"
            >
              <span>{{ String(index + 1).padStart(2, '0') }}</span>
              {{ nodeText(node) || '未命名章节' }}
            </button>
          </section>
        </aside>
        <button
          v-if="documents.length > visibleLimit"
          class="library-load-more"
          type="button"
          @click="visibleLimit += 24"
        >
          显示更多
        </button>
      </div>
      <div v-else class="surface-empty">
        <ArcaIcon :name="indexMode === 'trash' ? 'trash' : 'file'" :size="32" />
        <strong>
          {{ query ? '没有匹配的文稿' : store.connection !== 'ready' ? '尚未连接' : '暂无文稿' }}
        </strong>
        <button
          v-if="store.connection !== 'ready'"
          type="button"
          class="primary-button"
          @click="router.push({ name: 'settings', query: { section: 'integration' } })"
        >
          连接应用
        </button>
        <button
          v-else-if="indexMode === 'recent' || indexMode === 'all'"
          type="button"
          class="primary-button"
          @click="showCreate"
        >
          新建文稿
        </button>
      </div>
      <footer class="library-footer">
        <span>{{ documents.length }} 份文稿</span>
        <div>
          <button
            type="button"
            :class="{ active: indexMode === 'archive' }"
            @click="indexMode = 'archive'"
          >
            归档
          </button>
          <span>·</span>
          <button
            type="button"
            :class="{ active: indexMode === 'trash' }"
            @click="indexMode = 'trash'"
          >
            回收站
          </button>
        </div>
        <ConnectionBadge />
      </footer>
    </section>
    <input
      ref="packageInput"
      type="file"
      accept=".arca,application/vnd.infos.arca-project+zip"
      hidden
      @change="importSelected"
    />

    <Teleport to="body">
      <div
        v-if="menu"
        ref="menuElement"
        class="context-menu"
        role="menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @click.stop
        @keydown="menuKeys"
      >
        <button
          role="menuitem"
          @click="
            () => {
              if (menu) open(menu.document.documentId)
              menu = undefined
            }
          "
        >
          打开
        </button>
        <button role="menuitem" @click="toggleFavorite(menu.document)">
          {{ favorites.includes(menu.document.documentId) ? '取消收藏' : '收藏' }}
        </button>
        <button
          role="menuitem"
          :disabled="store.connection !== 'ready'"
          @click="showRename(menu.document)"
        >
          重命名
        </button>
        <button
          role="menuitem"
          :disabled="store.connection !== 'ready'"
          @click="manage(menu.document, 'copy')"
        >
          创建副本
        </button>
        <button
          v-if="menu.document.status === 'active'"
          role="menuitem"
          :disabled="store.connection !== 'ready'"
          @click="manage(menu.document, 'archived')"
        >
          归档
        </button>
        <button
          v-if="menu.document.status !== 'active'"
          role="menuitem"
          :disabled="store.connection !== 'ready'"
          @click="manage(menu.document, 'active')"
        >
          恢复
        </button>
        <button
          v-if="menu.document.status !== 'deleted'"
          class="danger-text"
          role="menuitem"
          :disabled="store.connection !== 'ready'"
          @click="manage(menu.document, 'deleted')"
        >
          移入回收站
        </button>
      </div>
    </Teleport>
    <ArcaDialog :open="createOpen" title="新建文稿" :busy="busy" @close="createOpen = false">
      <form id="arca-create-document" class="form-stack" @submit.prevent="create">
        <label>
          名称
          <input v-model="newTitle" maxlength="120" placeholder="未命名文稿" required />
        </label>
        <p v-if="dialogError" class="form-error" role="alert">{{ dialogError }}</p>
      </form>
      <template #footer>
        <button type="button" :disabled="busy" @click="createOpen = false">取消</button>
        <button
          class="primary-button"
          type="submit"
          form="arca-create-document"
          :disabled="busy || !newTitle.trim()"
        >
          {{ busy ? '创建中…' : '创建' }}
        </button>
      </template>
    </ArcaDialog>
    <ArcaDialog
      :open="Boolean(renameTarget)"
      title="重命名"
      :busy="busy"
      @close="renameTarget = undefined"
    >
      <form id="library-rename" class="form-stack" @submit.prevent="rename">
        <label>
          名称
          <input v-model="renameTitle" maxlength="120" required />
        </label>
        <p v-if="renameError" class="form-error" role="alert">{{ renameError }}</p>
      </form>
      <template #footer>
        <button :disabled="busy" @click="renameTarget = undefined">取消</button>
        <button
          class="primary-button"
          type="submit"
          form="library-rename"
          :disabled="busy || !renameTitle.trim()"
        >
          保存
        </button>
      </template>
    </ArcaDialog>
  </main>
</template>
