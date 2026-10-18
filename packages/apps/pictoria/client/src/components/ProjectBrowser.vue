<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CanvasCollection } from '../types'
import type { CanvasStore } from '../composables/useCanvas'
import Icon from './PictoriaIcon.vue'
import PictoriaSelect from './PictoriaSelect.vue'

const props = defineProps<{ store: CanvasStore }>()
const emit = defineEmits<{ open: [id: string]; create: [collectionId: string | null]; close: [] }>()
const query = ref(''),
  collapsed = ref<string[]>([]),
  editing = ref<CanvasCollection | null | undefined>(),
  title = ref(''),
  removing = ref('')
const canvases = computed(() => [
  props.store.project,
  ...props.store.projects.value.filter((canvas) => canvas.id !== props.store.project.id),
])
function groupId(id: string | null | undefined) {
  return props.store.collections.value.some((group) => group.id === id) ? id : ''
}
const groups = computed(() =>
  [
    ...props.store.collections.value.map((group) => ({
      id: group.id,
      title: group.title,
      definition: group,
    })),
    { id: '', title: '独立画布', definition: undefined },
  ]
    .map((group) => ({
      ...group,
      canvases: canvases.value.filter(
        (canvas) =>
          groupId(canvas.collectionId) === group.id &&
          (!query.value.trim() ||
            `${canvas.title} ${group.title}`
              .toLocaleLowerCase()
              .includes(query.value.trim().toLocaleLowerCase())),
      ),
    }))
    .filter(
      (group) =>
        !query.value.trim() ||
        group.canvases.length ||
        group.title.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
    ),
)
const options = computed(() => [
  { value: '', label: '独立画布' },
  ...props.store.collections.value.map((group) => ({ value: group.id, label: group.title })),
])
const busy = computed(
  () =>
    props.store.hierarchyBusy.value ||
    props.store.loading.value ||
    props.store.saving.value ||
    props.store.importing.value > 0,
)
function toggle(id: string) {
  collapsed.value = collapsed.value.includes(id)
    ? collapsed.value.filter((value) => value !== id)
    : [...collapsed.value, id]
}
function edit(group?: CanvasCollection) {
  editing.value = group || null
  title.value = group?.title || ''
  removing.value = ''
}
async function save() {
  if (
    title.value.trim() &&
    (await props.store.saveCollection(title.value, editing.value || undefined))
  ) {
    editing.value = undefined
    title.value = ''
  }
}
async function remove(group: CanvasCollection) {
  if (await props.store.removeCollection(group)) removing.value = ''
}
watch(
  () => props.store.agentId.value,
  () => {
    editing.value = undefined
    removing.value = ''
    collapsed.value = []
    query.value = ''
  },
)
</script>

<template>
  <section class="canvas-panel panel-projects project-browser floating-panel" data-ui>
    <header>
      <strong>项目与画布</strong>
      <button class="icon-button" aria-label="关闭项目列表" @click="emit('close')">
        <Icon name="close" :size="17" />
      </button>
    </header>
    <div class="project-browser-actions">
      <button class="quiet-button outlined" :disabled="busy || !store.online.value" @click="edit()">
        <Icon name="folder" :size="15" />
        新建项目
      </button>
      <button
        class="quiet-button outlined"
        :disabled="busy"
        @click="emit('create', store.project.collectionId ?? null)"
      >
        <Icon name="plus" :size="15" />
        新建画布
      </button>
    </div>
    <label class="project-search">
      <Icon name="search" :size="14" />
      <input v-model="query" placeholder="搜索…" aria-label="搜索项目与画布" />
    </label>
    <Transition name="float">
      <form v-if="editing !== undefined" class="project-edit" @submit.prevent="save">
        <input
          v-model="title"
          :placeholder="editing ? '项目名称' : '新项目名称'"
          aria-label="项目名称"
          maxlength="120"
        />
        <button
          class="icon-button"
          :disabled="busy || !title.trim()"
          aria-label="保存项目"
          title="保存"
          type="submit"
        >
          <Icon name="check" :size="15" />
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="取消编辑"
          @click="editing = undefined"
        >
          <Icon name="close" :size="14" />
        </button>
      </form>
    </Transition>
    <div class="project-tree">
      <section v-for="group in groups" :key="group.id" class="project-group">
        <div class="project-group-heading">
          <button
            class="project-group-toggle"
            :aria-expanded="!collapsed.includes(group.id)"
            @click="toggle(group.id)"
          >
            <Icon :name="group.id ? 'folder' : 'grid'" :size="15" />
            <strong>{{ group.title }}</strong>
            <small>{{ group.canvases.length }}</small>
            <Icon
              class="group-chevron"
              :class="{ collapsed: collapsed.includes(group.id) }"
              name="down"
              :size="12"
            />
          </button>
          <button
            class="icon-button"
            :disabled="busy"
            :aria-label="`在${group.title}中新建画布`"
            title="新建画布"
            @click="emit('create', group.id || null)"
          >
            <Icon name="plus" :size="14" />
          </button>
          <button
            v-if="group.definition"
            class="icon-button"
            :disabled="busy || !store.online.value"
            aria-label="重命名项目"
            title="重命名"
            @click="edit(group.definition)"
          >
            <Icon name="edit" :size="13" />
          </button>
          <button
            v-if="group.definition"
            class="icon-button"
            :disabled="busy || !store.online.value"
            aria-label="移除项目"
            title="移除项目"
            @click="removing = removing === group.id ? '' : group.id"
          >
            <Icon name="trash" :size="13" />
          </button>
        </div>
        <Transition name="float">
          <div v-if="removing === group.id && group.definition" class="inline-confirm">
            <span>移除项目？画布会保留。</span>
            <button
              class="text-button danger-button"
              :disabled="busy"
              @click="remove(group.definition)"
            >
              移除
            </button>
            <button class="text-button" @click="removing = ''">取消</button>
          </div>
        </Transition>
        <div
          class="project-group-fold"
          :class="{ collapsed: collapsed.includes(group.id) && !query }"
        >
          <div>
            <div
              v-for="canvas in group.canvases"
              :key="canvas.id"
              class="project-canvas-row"
              :class="{ current: canvas.id === store.project.id }"
            >
              <button class="project-canvas-open" :disabled="busy" @click="emit('open', canvas.id)">
                <Icon name="grid" :size="14" />
                <span>{{ canvas.title }}</span>
                <Icon v-if="canvas.id === store.project.id" name="check" :size="13" />
              </button>
              <PictoriaSelect
                :model-value="canvas.collectionId || ''"
                :options="options"
                :disabled="busy || (!store.online.value && canvas.id !== store.project.id)"
                icon-only
                :label="`移动画布：${canvas.title}`"
                @update:model-value="store.moveToCollection(canvas.id, $event || null)"
              />
            </div>
            <button
              v-if="!group.canvases.length"
              class="project-empty-add"
              :disabled="busy"
              @click="emit('create', group.id || null)"
            >
              <Icon name="plus" :size="13" />
              新建画布
            </button>
          </div>
        </div>
      </section>
      <p v-if="!groups.length" class="panel-empty">没有匹配项</p>
    </div>
  </section>
</template>
