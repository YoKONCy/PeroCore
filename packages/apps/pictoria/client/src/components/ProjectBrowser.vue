<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const contextMenu = ref<{
  id: string
  left: number
  top: number
  mode: 'menu' | 'delete' | 'rename'
} | null>(null)
const canvasTitle = ref('')
const menuElement = ref<HTMLElement | null>(null)
const menuCanvas = computed(() =>
  canvases.value.find((canvas) => canvas.id === contextMenu.value?.id),
)
let menuTrigger: HTMLElement | null = null
function closeMenu(restoreFocus = false) {
  contextMenu.value = null
  if (restoreFocus) menuTrigger?.focus({ preventScroll: true })
}
async function placeMenu() {
  await nextTick()
  const box = menuElement.value?.getBoundingClientRect()
  if (!box || !contextMenu.value) return
  contextMenu.value.left = Math.max(
    8,
    Math.min(contextMenu.value.left, window.innerWidth - box.width - 8),
  )
  contextMenu.value.top = Math.max(
    8,
    Math.min(contextMenu.value.top, window.innerHeight - box.height - 8),
  )
  const input = menuElement.value?.querySelector<HTMLInputElement>('input')
  if (input) {
    input.focus({ preventScroll: true })
    input.select()
  } else {
    menuElement.value
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true })
  }
}
function openMenu(event: MouseEvent, id: string) {
  if (busy.value) return
  const row = event.currentTarget as HTMLElement
  menuTrigger = row.querySelector<HTMLButtonElement>('.project-canvas-open')
  const box = row.getBoundingClientRect()
  contextMenu.value = {
    id,
    left: event.clientX || box.left,
    top: event.clientY || box.bottom,
    mode: 'menu',
  }
  void placeMenu()
}
function confirmRemoval() {
  if (!contextMenu.value || busy.value) return
  contextMenu.value.mode = 'delete'
  void placeMenu()
}
function editCanvasName() {
  if (!contextMenu.value || !menuCanvas.value || busy.value) return
  canvasTitle.value = menuCanvas.value.title
  contextMenu.value.mode = 'rename'
  void placeMenu()
}
async function renameCanvas() {
  const id = contextMenu.value?.id
  if (!id || busy.value || !canvasTitle.value.trim()) return
  if (await props.store.renameProject(id, canvasTitle.value)) closeMenu(true)
}
async function removeCanvas() {
  const id = contextMenu.value?.id
  if (!id || busy.value) return
  if (await props.store.removeProject(id)) closeMenu()
}
function outside(event: PointerEvent) {
  if (!menuElement.value?.contains(event.target as Node)) closeMenu()
}
function menuKey(event: KeyboardEvent) {
  if (!contextMenu.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
  } else if (event.key === 'Tab' && contextMenu.value.mode === 'menu') closeMenu()
}
function dismissMenu(event?: Event) {
  if (event?.target instanceof Node && menuElement.value?.contains(event.target)) return
  closeMenu()
}
onMounted(() => {
  window.addEventListener('pointerdown', outside, true)
  window.addEventListener('keydown', menuKey, true)
  window.addEventListener('scroll', dismissMenu, true)
  window.addEventListener('resize', dismissMenu)
  window.addEventListener('blur', dismissMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('keydown', menuKey, true)
  window.removeEventListener('scroll', dismissMenu, true)
  window.removeEventListener('resize', dismissMenu)
  window.removeEventListener('blur', dismissMenu)
})
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
    {
      id: '',
      get title() {
        return __t('apps.pictoria.ui', '独立画布')
      },
      definition: undefined,
    },
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
  {
    value: '',
    get label() {
      return __t('apps.pictoria.ui', '独立画布')
    },
  },
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
    closeMenu()
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
      <strong>{{ __t('apps.pictoria.ui', '项目与画布') }}</strong>
      <button
        class="icon-button"
        :aria-label="__t('apps.pictoria.ui', '关闭项目列表')"
        @click="emit('close')"
      >
        <Icon name="close" :size="17" />
      </button>
    </header>
    <div class="project-browser-actions">
      <button class="quiet-button outlined" :disabled="busy || !store.online.value" @click="edit()">
        <Icon name="folder" :size="15" />
        {{ __t('apps.pictoria.ui', '新建项目') }}
      </button>
      <button
        class="quiet-button outlined"
        :disabled="busy"
        @click="emit('create', store.project.collectionId ?? null)"
      >
        <Icon name="plus" :size="15" />
        {{ __t('apps.pictoria.ui', '新建画布') }}
      </button>
    </div>
    <label class="project-search">
      <Icon name="search" :size="14" />
      <input
        v-model="query"
        :placeholder="__t('apps.pictoria.ui', '搜索…')"
        :aria-label="__t('apps.pictoria.ui', '搜索项目与画布')"
      />
    </label>
    <Transition name="float">
      <form v-if="editing !== undefined" class="project-edit" @submit.prevent="save">
        <input
          v-model="title"
          :placeholder="
            editing ? __t('apps.pictoria.ui', '项目名称') : __t('apps.pictoria.ui', '新项目名称')
          "
          :aria-label="__t('apps.pictoria.ui', '项目名称')"
          maxlength="120"
        />
        <button
          class="icon-button"
          :disabled="busy || !title.trim()"
          :aria-label="__t('apps.pictoria.ui', '保存项目')"
          :title="__t('apps.pictoria.ui', '保存')"
          type="submit"
        >
          <Icon name="check" :size="15" />
        </button>
        <button
          class="icon-button"
          type="button"
          :aria-label="__t('apps.pictoria.ui', '取消编辑')"
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
            :aria-label="__t('apps.pictoria.ui', '在{0}中新建画布', [group.title])"
            :title="__t('apps.pictoria.ui', '新建画布')"
            @click="emit('create', group.id || null)"
          >
            <Icon name="plus" :size="14" />
          </button>
          <button
            v-if="group.definition"
            class="icon-button"
            :disabled="busy || !store.online.value"
            :aria-label="__t('apps.pictoria.ui', '重命名项目')"
            :title="__t('apps.pictoria.ui', '重命名')"
            @click="edit(group.definition)"
          >
            <Icon name="edit" :size="13" />
          </button>
          <button
            v-if="group.definition"
            class="icon-button"
            :disabled="busy || !store.online.value"
            :aria-label="__t('apps.pictoria.ui', '移除项目')"
            :title="__t('apps.pictoria.ui', '移除项目')"
            @click="removing = removing === group.id ? '' : group.id"
          >
            <Icon name="trash" :size="13" />
          </button>
        </div>
        <Transition name="float">
          <div v-if="removing === group.id && group.definition" class="inline-confirm">
            <span>{{ __t('apps.pictoria.ui', '移除项目？画布会保留。') }}</span>
            <button
              class="text-button danger-button"
              :disabled="busy"
              @click="remove(group.definition)"
            >
              {{ __t('apps.pictoria.ui', '移除') }}
            </button>
            <button class="text-button" @click="removing = ''">
              {{ __t('apps.pictoria.ui', '取消') }}
            </button>
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
              @contextmenu.prevent.stop="openMenu($event, canvas.id)"
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
                :label="__t('apps.pictoria.ui', '移动画布：{0}', [canvas.title])"
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
              {{ __t('apps.pictoria.ui', '新建画布') }}
            </button>
          </div>
        </div>
      </section>
      <p v-if="!groups.length" class="panel-empty">{{ __t('apps.pictoria.ui', '没有匹配项') }}</p>
    </div>
    <Teleport to="body">
      <div
        v-if="contextMenu && menuCanvas"
        ref="menuElement"
        class="project-context-menu floating-panel"
        :style="{ left: `${contextMenu.left}px`, top: `${contextMenu.top}px` }"
        :role="
          contextMenu.mode === 'menu'
            ? 'menu'
            : contextMenu.mode === 'delete'
              ? 'alertdialog'
              : 'dialog'
        "
        :aria-label="
          contextMenu.mode === 'rename'
            ? __t('apps.pictoria.ui', '重命名画布')
            : contextMenu.mode === 'delete'
              ? __t('apps.pictoria.ui', '确认删除画布')
              : __t('apps.pictoria.ui', '画布操作')
        "
        data-ui
        @contextmenu.prevent
        @keydown.stop
      >
        <form
          v-if="contextMenu.mode === 'rename'"
          class="project-rename-form"
          @submit.prevent="renameCanvas"
        >
          <label>
            {{ __t('apps.pictoria.ui', '重命名画布') }}
            <input
              v-model="canvasTitle"
              :aria-label="__t('apps.pictoria.ui', '画布名称')"
              maxlength="120"
              :disabled="busy"
            />
          </label>
          <footer>
            <button type="button" class="text-button" :disabled="busy" @click="closeMenu(true)">
              {{ __t('apps.pictoria.ui', '取消') }}
            </button>
            <button type="submit" class="text-button" :disabled="busy || !canvasTitle.trim()">
              {{ busy ? __t('apps.pictoria.ui', '正在保存…') : __t('apps.pictoria.ui', '保存') }}
            </button>
          </footer>
        </form>
        <template v-else-if="contextMenu.mode === 'delete'">
          <strong>{{ __t('apps.pictoria.ui', '删除「') }}{{ menuCanvas.title }}」？</strong>
          <p>
            {{
              __t(
                'apps.pictoria.ui',
                '画布及未保存的修改将被删除，无法恢复。素材库中的素材会保留。',
              )
            }}
          </p>
          <footer>
            <button class="text-button" :disabled="busy" @click="closeMenu(true)">
              {{ __t('apps.pictoria.ui', '取消') }}
            </button>
            <button class="text-button danger-button" :disabled="busy" @click="removeCanvas">
              {{
                busy ? __t('apps.pictoria.ui', '正在删除…') : __t('apps.pictoria.ui', '确认删除')
              }}
            </button>
          </footer>
        </template>
        <template v-else>
          <button
            class="project-context-action"
            role="menuitem"
            :disabled="busy || (!store.online.value && menuCanvas.id !== store.project.id)"
            @click="editCanvasName"
          >
            <Icon name="edit" :size="15" />
            {{ __t('apps.pictoria.ui', '重命名') }}
          </button>
          <button
            class="project-context-action project-context-delete"
            role="menuitem"
            :disabled="busy || (!store.online.value && menuCanvas.revision > 0)"
            @click="confirmRemoval"
          >
            <Icon name="trash" :size="15" />
            {{ __t('apps.pictoria.ui', '删除画布') }}
          </button>
        </template>
      </div>
    </Teleport>
  </section>
</template>
