<script setup lang="ts">
/**
 * HomeView.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ConnectionBadge from '../components/ConnectionBadge.vue'
import { useWorkbenchStore } from '../stores/workbench'

const store = useWorkbenchStore()
const router = useRouter()
const packageInput = ref<HTMLInputElement>()
const createOpen = ref(false)
const newTitle = ref('')
const indexMode = ref<'recent' | 'review' | 'archive'>('recent')
const recentDocuments = computed(() =>
  [...store.documents]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20),
)
const runningTasks = computed(
  () =>
    store.collaborationTasks.filter((task) => ['queued', 'working'].includes(task.status)).length,
)

async function open(documentId: string) {
  await store.openDocument(documentId)
  await router.push({ name: 'workbench', params: { documentId } })
}
async function createDocument() {
  const documentId = await store.createDocument(newTitle.value)
  if (!documentId) return
  createOpen.value = false
  newTitle.value = ''
  await router.push({ name: 'workbench', params: { documentId } })
}
async function importSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  await store.importProject(file)
  input.value = ''
}
function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <main class="index-terminal">
    <header class="terminal-header">
      <div class="arca-lockup">
        <span class="brand-fold brand-fold--star" aria-hidden="true" />
        <div>
          <strong>Arca</strong>
          <small>星页工房 / FOLIO TERMINAL</small>
        </div>
      </div>
      <div class="terminal-actions">
        <ConnectionBadge />
        <button type="button" title="Arca设置" @click="router.push({ name: 'settings' })">
          设置
        </button>
        <button type="button" title="切换Arca主题" @click="store.cycleTheme()">主题 ◐</button>
      </div>
    </header>

    <section class="terminal-summary" aria-label="工作站摘要">
      <div>
        <span class="pixel-label">
          工作站索引
          <b>INDEX</b>
        </span>
        <strong>星页文件系统</strong>
      </div>
      <dl>
        <div>
          <dt>文稿</dt>
          <dd>{{ store.documents.length }}</dd>
        </div>
        <div>
          <dt>待审</dt>
          <dd>{{ store.pendingChangeSets.length }}</dd>
        </div>
        <div>
          <dt>运行中</dt>
          <dd>{{ runningTasks }}</dd>
        </div>
        <div>
          <dt>Authority</dt>
          <dd>{{ store.authority }}</dd>
        </div>
      </dl>
      <div class="terminal-primary-actions">
        <button v-if="store.connection !== 'ready'" type="button" @click="store.reconnect()">
          重新连接
        </button>
        <template v-else>
          <button type="button" @click="createOpen = true">＋ 新建星页</button>
          <button class="pixel-action" type="button" @click="packageInput?.click()">
            ↙ 导入工程包
          </button>
        </template>
        <input
          ref="packageInput"
          type="file"
          accept=".arca,application/vnd.infos.arca-project+zip"
          hidden
          @change="importSelected"
        />
      </div>
    </section>

    <section class="terminal-index">
      <nav class="index-track" aria-label="文件分类">
        <button :class="{ active: indexMode === 'recent' }" @click="indexMode = 'recent'">
          <i />
          最近打开
          <span>{{ recentDocuments.length }}</span>
        </button>
        <button :class="{ active: indexMode === 'review' }" @click="indexMode = 'review'">
          <i />
          待审变更
          <span>{{ store.pendingChangeSets.length }}</span>
        </button>
        <button :class="{ active: indexMode === 'archive' }" @click="indexMode = 'archive'">
          <i />
          归档索引
          <span>0</span>
        </button>
        <div class="index-track-spacer" />
        <small>
          LOCAL REALM
          <br />
          INFOS.ARCA
        </small>
      </nav>

      <div class="file-index">
        <header class="file-index-head">
          <span>序号</span>
          <span>星页标题</span>
          <span>类型</span>
          <span>Revision</span>
          <span>最后修改</span>
          <span>状态</span>
        </header>
        <template v-if="indexMode === 'recent' && recentDocuments.length">
          <button
            v-for="(document, index) in recentDocuments"
            :key="document.documentId"
            class="file-index-row"
            type="button"
            @click="open(document.documentId)"
          >
            <code>{{ String(index + 1).padStart(2, '0') }}</code>
            <span class="file-title">
              <i class="file-fold" />
              <strong>{{ document.title }}</strong>
              <small>{{ document.language }}</small>
            </span>
            <span>{{ document.kind }}</span>
            <code>{{ String(document.headRevisionId).slice(0, 8) }}</code>
            <time :datetime="document.updatedAt">{{ formatTime(document.updatedAt) }}</time>
            <span class="file-state">
              <i />
              可写
            </span>
          </button>
        </template>
        <div v-else class="index-empty">
          <span class="empty-fold" aria-hidden="true" />
          <div>
            <strong>
              {{
                indexMode === 'recent'
                  ? store.connection === 'ready'
                    ? '索引中暂无星页'
                    : '本地工作站尚未连接'
                  : indexMode === 'review'
                    ? '没有待审变更'
                    : '归档索引为空'
              }}
            </strong>
            <p>
              {{
                indexMode === 'recent'
                  ? '连接Arca Host后新建或导入工程包。'
                  : '相关记录出现后会在此建立索引。'
              }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <footer class="terminal-footer">
      <span :class="['tiny-state', `tiny-state--${store.connection}`]" />
      <span>HOST {{ store.hostOnline ? 'ONLINE' : 'OFFLINE' }}</span>
      <span>KERNEL {{ store.kernelOnline ? 'ONLINE' : 'OFFLINE' }}</span>
      <span class="terminal-footer-spacer" />
      <span v-if="store.errorMessage" class="launch-error">{{ store.errorMessage }}</span>
      <span>ARCA CLIENT / INDEX READY</span>
    </footer>

    <div v-if="createOpen" class="composer-scrim">
      <form class="mini-dialog" @submit.prevent="createDocument">
        <p class="pixel-label">
          新建星页
          <span class="pixel-en">NEW FOLIO</span>
        </p>
        <h2>建立文稿索引</h2>
        <input v-model="newTitle" autofocus maxlength="120" placeholder="文档标题" />
        <footer>
          <button type="button" @click="createOpen = false">取消</button>
          <button class="primary-button" type="submit" :disabled="!newTitle.trim()">创建</button>
        </footer>
      </form>
    </div>
  </main>
</template>
