<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './PictoriaIcon.vue'
import ResourceThumbnail from './ResourceThumbnail.vue'
import PictoriaSelect from './PictoriaSelect.vue'
import { pictoria } from '../services/transport'
import type { Asset, Prompt } from '../types'
import type { CanvasStore } from '../composables/useCanvas'
const props = defineProps<{ store: CanvasStore }>()
const emit = defineEmits<{
  close: []
  asset: [asset: Asset, edit: boolean]
  prompt: [prompt: Prompt, note: boolean]
  upload: []
}>()
const tab = ref<'materials' | 'artworks' | 'prompts'>('materials'),
  query = ref(''),
  type = ref('all'),
  favorites = ref(false),
  finals = ref(false)
const assets = ref<Asset[]>([]),
  prompts = ref<Prompt[]>([]),
  total = ref(0),
  offset = ref(0),
  busy = ref(false),
  saving = ref(false),
  problem = ref('')
const detail = ref<Asset>(),
  editing = ref<Prompt>(),
  confirmingDelete = ref(false),
  title = ref(''),
  tags = ref('')
const dragging = ref(false)
let disposed = false,
  generation = 0,
  timer: ReturnType<typeof setTimeout> | undefined
let unpin: (() => void) | undefined
watch(
  () => detail.value?.id,
  (id) => {
    unpin?.()
    unpin = id ? props.store.pinMedia(id) : undefined
  },
  { flush: 'sync' },
)
const pages = computed(
  () =>
    `${total.value ? offset.value + 1 : 0}–${Math.min(offset.value + 30, total.value)} / ${total.value}`,
)
async function load() {
  const request = ++generation,
    owner = props.store.agentId.value
  if (!props.store.online.value) {
    busy.value = false
    problem.value = '连接后台后即可管理资源库。'
    return
  }
  busy.value = true
  problem.value = ''
  try {
    if (tab.value === 'prompts') {
      const result = await pictoria.operation<{ items: Prompt[]; total: number }>(
        owner,
        'prompt.search',
        { query: query.value.trim(), offset: offset.value, limit: 30 },
      )
      if (!disposed && request === generation) {
        prompts.value = result.items
        total.value = result.total
      }
    } else {
      const result = await pictoria.operation<{ items: Asset[]; total: number }>(
        owner,
        'library.list',
        {
          kind: tab.value,
          query: query.value.trim(),
          type: type.value,
          favorites: favorites.value,
          final: finals.value,
          offset: offset.value,
          limit: 30,
        },
      )
      if (!disposed && request === generation) {
        assets.value = result.items
        total.value = result.total
        if (detail.value) detail.value = result.items.find((item) => item.id === detail.value?.id)
      }
    }
  } catch (error) {
    if (!disposed && request === generation)
      problem.value = error instanceof Error ? error.message : '资源库暂时不可用'
  } finally {
    if (!disposed && request === generation) busy.value = false
  }
}
watch(
  () => [
    tab.value,
    query.value,
    type.value,
    favorites.value,
    finals.value,
    props.store.agentId.value,
    props.store.online.value,
  ],
  () => {
    generation++
    busy.value = false
    offset.value = 0
    detail.value = undefined
    editing.value = undefined
    assets.value = []
    prompts.value = []
    total.value = 0
    clearTimeout(timer)
    timer = setTimeout(load, 200)
  },
  { immediate: true },
)
function page(direction: number) {
  offset.value = Math.max(0, offset.value + direction * 30)
  detail.value = undefined
  void load()
}
function open(asset: Asset) {
  detail.value = asset
  title.value = asset.meta?.title || asset.name
  tags.value = asset.meta?.tags?.join(', ') || ''
  void props.store.ensureMedia(asset.id).catch((error) => {
    if (!disposed) problem.value = error instanceof Error ? error.message : '预览暂不可用'
  })
}
function editPrompt(prompt?: Prompt) {
  editing.value = prompt
    ? JSON.parse(JSON.stringify(prompt))
    : { id: crypto.randomUUID(), revision: 0, title: '', text: '', tags: [], usage: '' }
  tags.value = editing.value!.tags.join(', ')
  confirmingDelete.value = false
}
const tagValues = () =>
  tags.value
    .split(/[,，]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 30)
async function savePrompt(remove = false) {
  if (!editing.value || saving.value || !props.store.online.value) return
  saving.value = true
  problem.value = ''
  const value = JSON.parse(JSON.stringify(editing.value)) as Prompt,
    owner = props.store.agentId.value,
    request = generation
  try {
    if (remove)
      await pictoria.operation(owner, 'prompt.delete', {
        id: value.id,
        expectedRevision: value.revision,
      })
    else {
      if (!value.title.trim() || !value.text.trim()) throw new Error('填写标题和提示词后再保存')
      await pictoria.operation(owner, 'prompt.save', {
        definition: {
          id: value.id,
          title: value.title.trim(),
          text: value.text,
          tags: tagValues(),
          usage: value.usage || '',
        },
        expectedRevision: value.revision,
      })
    }
    if (!disposed && request === generation) {
      editing.value = undefined
      await load()
    }
  } catch (error) {
    if (!disposed && request === generation)
      problem.value = error instanceof Error ? error.message : '提示词保存失败'
  } finally {
    saving.value = false
  }
}
async function updateMeta(patch: Record<string, unknown>) {
  if (!detail.value || saving.value || !props.store.online.value) return
  saving.value = true
  const asset = detail.value,
    request = generation
  try {
    const meta = await pictoria.operation<NonNullable<Asset['meta']>>(
      props.store.agentId.value,
      'library.update',
      { id: asset.id, expectedRevision: asset.meta?.revision ?? 0, ...patch },
    )
    if (!disposed && request === generation) asset.meta = meta
  } catch (error) {
    if (!disposed && request === generation)
      problem.value = error instanceof Error ? error.message : '资源信息保存失败'
  } finally {
    saving.value = false
  }
}
async function download(asset: Asset) {
  try {
    const url = await props.store.ensureMedia(asset.id)
    if (!url || disposed) return
    const link = document.createElement('a')
    link.href = url
    link.download = asset.name.includes('.')
      ? asset.name
      : `${asset.meta?.title || asset.name}.${asset.mimeType.split('/')[1] || 'bin'}`
    link.click()
  } catch (error) {
    if (!disposed) problem.value = error instanceof Error ? error.message : '下载失败'
  }
}
function drag(event: DragEvent, item: Asset | Prompt) {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(
    'application/x-pictoria-resource',
    JSON.stringify({
      owner: props.store.agentId.value,
      kind: tab.value === 'prompts' ? 'prompt' : 'asset',
      id: item.id,
      ...(tab.value === 'prompts' ? { text: (item as Prompt).text } : {}),
    }),
  )
  dragging.value = true
}
onBeforeUnmount(() => {
  disposed = true
  generation++
  clearTimeout(timer)
  unpin?.()
})
</script>
<template>
  <section
    class="resource-browser floating-panel"
    :class="{ 'is-resource-dragging': dragging }"
    data-ui
    role="dialog"
    aria-label="创作资源库"
    :aria-modal="!dragging"
    @dragend="dragging = false"
  >
    <header class="resource-header">
      <div>
        <small>YOUR CREATIVE COLLECTION</small>
        <h2>资源库</h2>
      </div>
      <button class="icon-button" aria-label="关闭资源库" @click="emit('close')">
        <Icon name="close" />
      </button>
    </header>
    <nav class="resource-tabs" aria-label="资源分类">
      <button :class="{ active: tab === 'materials' }" @click="tab = 'materials'">
        <Icon name="image" :size="16" />
        素材库
      </button>
      <button :class="{ active: tab === 'artworks' }" @click="tab = 'artworks'">
        <Icon name="sparkle" :size="16" />
        成品库
      </button>
      <button :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">
        <Icon name="note" :size="16" />
        提示词库
      </button>
    </nav>
    <div class="resource-filters">
      <label>
        <Icon name="search" :size="15" />
        <input v-model="query" placeholder="搜索…" maxlength="200" />
      </label>
      <PictoriaSelect
        v-if="tab !== 'prompts'"
        v-model="type"
        :options="[
          { value: 'all', label: '全部格式' },
          { value: 'image', label: '图片' },
          { value: 'video', label: '视频' },
          { value: 'audio', label: '音频' },
        ]"
        label="素材类型"
      />
      <button
        v-if="tab !== 'prompts'"
        :class="{ active: favorites }"
        :aria-pressed="favorites"
        @click="favorites = !favorites"
      >
        <Icon name="heart" :size="15" />
        收藏
      </button>
      <button
        v-if="tab === 'artworks'"
        :class="{ active: finals }"
        :aria-pressed="finals"
        @click="finals = !finals"
      >
        最终稿
      </button>
      <button class="create-button" @click="tab === 'prompts' ? editPrompt() : emit('upload')">
        <Icon name="plus" :size="15" />
        {{ tab === 'prompts' ? '新建提示词' : '导入素材' }}
      </button>
    </div>
    <p v-if="problem" class="resource-problem" role="alert">
      {{ problem }}
      <button class="text-button" @click="load">重试</button>
    </p>
    <div class="resource-content" :class="{ 'has-detail': detail || editing }">
      <div class="resource-scroll" :aria-busy="busy">
        <div v-if="busy" class="resource-empty">
          <Icon name="refresh" />
          正在读取…
        </div>
        <div v-else-if="tab === 'prompts'" class="prompt-grid">
          <article
            v-for="prompt in prompts"
            :key="prompt.id"
            class="prompt-tile"
            draggable="true"
            @dragstart="drag($event, prompt)"
          >
            <header>
              <Icon name="note" :size="16" />
              <strong>{{ prompt.title }}</strong>
              <button class="icon-button" aria-label="编辑提示词" @click="editPrompt(prompt)">
                <Icon name="settings" :size="15" />
              </button>
            </header>
            <p>{{ prompt.text }}</p>
            <small v-if="prompt.usage">{{ prompt.usage }}</small>
            <div class="resource-tags">
              <span v-for="tag in prompt.tags" :key="tag">{{ tag }}</span>
            </div>
            <footer>
              <button class="text-button" @click="emit('prompt', prompt, false)">填入创作栏</button>
              <button class="text-button" @click="emit('prompt', prompt, true)">放进画布</button>
            </footer>
          </article>
        </div>
        <div v-else class="resource-grid">
          <button
            v-for="asset in assets"
            :key="asset.id"
            class="resource-tile"
            :class="{ active: detail?.id === asset.id }"
            draggable="true"
            @dragstart="drag($event, asset)"
            @click="open(asset)"
            @dblclick="emit('asset', asset, false)"
          >
            <ResourceThumbnail :asset="asset" :store="store" />
            <span class="resource-tile-name">
              {{ asset.meta?.title || asset.name }}
              <Icon v-if="asset.meta?.favorite" name="heart" :size="12" />
            </span>
            <small>
              {{ asset.mimeType.split('/')[1]?.toUpperCase() }} ·
              {{ (asset.sizeBytes / 1048576).toFixed(1) }} MB
              <span v-if="asset.meta?.final">· 最终稿</span>
            </small>
          </button>
        </div>
        <div
          v-if="!busy && !(tab === 'prompts' ? prompts.length : assets.length)"
          class="resource-empty"
        >
          <Icon :name="tab === 'prompts' ? 'note' : 'image'" :size="35" />
          <strong>
            {{
              query
                ? '没有找到匹配内容'
                : tab === 'artworks'
                  ? '下一份作品，从画布开始'
                  : tab === 'prompts'
                    ? '收藏一句好灵感'
                    : '给画布准备一点素材'
            }}
          </strong>
          <span>
            {{
              tab === 'artworks'
                ? '生成和编辑结果会自动保存在这里。'
                : '可以搜索、收藏，或拖进画布继续创作。'
            }}
          </span>
        </div>
      </div>
      <aside v-if="editing" class="resource-detail">
        <header>
          <strong>{{ editing.revision ? '编辑提示词' : '新建提示词' }}</strong>
          <button class="icon-button" aria-label="关闭编辑" @click="editing = undefined">
            <Icon name="close" :size="16" />
          </button>
        </header>
        <label class="panel-field">
          标题
          <input v-model="editing.title" maxlength="120" />
        </label>
        <label class="panel-field">
          提示词
          <textarea v-model="editing.text" rows="9" maxlength="64000" />
        </label>
        <label class="panel-field">
          适用说明
          <input
            v-model="editing.usage"
            placeholder="如：自然语言编辑／SDXL 正向 tags"
            maxlength="1000"
          />
        </label>
        <label class="panel-field">
          标签
          <input v-model="tags" placeholder="以逗号分隔" maxlength="1500" />
        </label>
        <button class="create-button" :disabled="saving" @click="savePrompt()">
          {{ saving ? '保存中' : '保存' }}
        </button>
        <button
          v-if="editing.revision && !confirmingDelete"
          class="text-button danger-button"
          @click="confirmingDelete = true"
        >
          删除提示词
        </button>
        <div v-if="confirmingDelete" class="inline-confirm">
          <span>删除这条提示词？</span>
          <button class="text-button" :disabled="saving" @click="savePrompt(true)">确认删除</button>
          <button class="text-button" @click="confirmingDelete = false">取消</button>
        </div>
      </aside>
      <aside v-else-if="detail" class="resource-detail">
        <header>
          <strong>作品与素材</strong>
          <button class="icon-button" aria-label="关闭详情" @click="detail = undefined">
            <Icon name="close" :size="16" />
          </button>
        </header>
        <div class="resource-preview">
          <video
            v-if="detail.mimeType.startsWith('video/') && store.urls[detail.id]"
            :src="store.urls[detail.id]"
            controls
            preload="metadata"
          />
          <audio
            v-else-if="detail.mimeType.startsWith('audio/') && store.urls[detail.id]"
            :src="store.urls[detail.id]"
            controls
          />
          <img
            v-else-if="detail.mimeType.startsWith('image/') && store.urls[detail.id]"
            :src="store.urls[detail.id]"
            :alt="detail.meta?.title || detail.name"
          />
          <Icon v-else name="image" :size="30" />
        </div>
        <label class="panel-field">
          名称
          <input v-model="title" maxlength="180" />
        </label>
        <label class="panel-field">
          标签
          <input v-model="tags" placeholder="以逗号分隔" maxlength="1500" />
        </label>
        <button
          class="text-button"
          :disabled="saving"
          @click="updateMeta({ title, tags: tagValues() })"
        >
          保存名称与标签
        </button>
        <div class="detail-flags">
          <button
            class="quiet-button"
            :class="{ active: detail.meta?.favorite }"
            :disabled="saving"
            @click="updateMeta({ favorite: !detail.meta?.favorite })"
          >
            <Icon name="heart" :size="15" />
            {{ detail.meta?.favorite ? '已收藏' : '收藏' }}
          </button>
          <button
            v-if="tab === 'artworks'"
            class="quiet-button"
            :class="{ active: detail.meta?.final }"
            :disabled="saving"
            @click="updateMeta({ final: !detail.meta?.final })"
          >
            <Icon name="check" :size="15" />
            {{ detail.meta?.final ? '最终稿' : '标记最终稿' }}
          </button>
        </div>
        <div v-if="detail.meta?.origin === 'output'" class="artwork-provenance">
          <small>{{ detail.meta.model }}</small>
          <p v-if="detail.meta.inputs?.prompt">{{ detail.meta.inputs.prompt }}</p>
          <details>
            <summary>创作参数</summary>
            <pre>{{ JSON.stringify(detail.meta.inputs, null, 2) }}</pre>
          </details>
          <time>
            {{ new Date(detail.meta.createdAt || detail.createdAt || '').toLocaleString() }}
          </time>
        </div>
        <div class="detail-actions">
          <button class="create-button" @click="emit('asset', detail, false)">放入画布</button>
          <button
            v-if="detail.mimeType.startsWith('image/')"
            class="quiet-button outlined"
            @click="emit('asset', detail, true)"
          >
            再次编辑
          </button>
          <button class="icon-button" aria-label="下载资源" @click="download(detail)">
            <Icon name="download" :size="17" />
          </button>
        </div>
      </aside>
    </div>
    <footer class="resource-pagination">
      <small>拖入画布 · 双击添加</small>
      <span>{{ pages }}</span>
      <button
        class="icon-button"
        aria-label="上一页"
        :disabled="busy || offset === 0"
        @click="page(-1)"
      >
        <Icon name="chevron" :size="15" style="transform: rotate(180deg)" />
      </button>
      <button
        class="icon-button"
        aria-label="下一页"
        :disabled="busy || offset + 30 >= total"
        @click="page(1)"
      >
        <Icon name="chevron" :size="15" />
      </button>
    </footer>
  </section>
</template>
