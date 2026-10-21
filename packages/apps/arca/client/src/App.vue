<script setup lang="ts">
import { t as __t } from './i18n'

/**
 * App.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onBeforeUnmount, onMounted, watch } from 'vue'
import ArcaTitleBar from './components/ArcaTitleBar.vue'
import ApplicationBar from './components/ApplicationBar.vue'
import { openDialogs } from './services/dialogState'
import { useWorkbenchStore } from './stores/workbench'

const store = useWorkbenchStore()
interface DesktopBridge {
  embedded?: boolean
  invoke: (channel: string) => Promise<unknown>
  on?: (channel: string, listener: (value: unknown) => void) => () => void
  send?: (channel: string, value: unknown) => void
}
const desktop = (window as unknown as { electron?: DesktopBridge }).electron
const embedded = Boolean(desktop?.embedded)
let stopTheme: (() => void) | undefined
let stopDirty: (() => void) | undefined
let themeReceived = false
let disposed = false
const receiveTheme = (value: unknown) => {
  if (value !== 'light' && value !== 'dark') return
  themeReceived = true
  store.hostTheme = value
  store.applyTheme()
}
const guardUnsavedDrafts = (event: BeforeUnloadEvent) => {
  if (store.applicationStopped) return
  if (!store.drafts.length && !store.officeDirty && store.editState !== 'saving') return
  event.preventDefault()
  event.returnValue = ''
}
function dismissMenus(event: Event) {
  const target = event.target instanceof Element ? event.target : undefined
  if (event.type !== 'click' && target?.closest('.arca-select-popup')) return
  const escape = event instanceof KeyboardEvent && event.key === 'Escape'
  if (event instanceof KeyboardEvent && !escape) return
  const action =
    event.type === 'click' && !!target?.closest('.context-menu button:not(.arca-select-trigger)')
  const selecting = event.type === 'click' && !!target?.closest('.arca-select-popup')
  const origin = target?.closest<HTMLDetailsElement>(
    'details.editor-file-menu, details.ribbon-format-menu',
  )
  let focusTarget: HTMLElement | null | undefined
  for (const menu of document.querySelectorAll<HTMLDetailsElement>(
    'details.editor-file-menu[open], details.ribbon-format-menu[open]',
  )) {
    if (escape || !target || !menu.contains(target) || action) {
      if (
        (escape && (!focusTarget || menu.contains(document.activeElement))) ||
        (selecting && menu.contains(document.activeElement))
      )
        focusTarget = menu.querySelector<HTMLElement>(':scope > summary')
      menu.open = false
    }
  }
  if (escape && focusTarget) {
    event.preventDefault()
    event.stopPropagation()
    focusTarget.focus({ preventScroll: true })
  } else if (selecting && focusTarget) {
    focusTarget.focus({ preventScroll: true })
  } else if (
    action &&
    origin &&
    (origin.contains(document.activeElement) || document.activeElement === document.body)
  ) {
    origin.querySelector<HTMLElement>(':scope > summary')?.focus({ preventScroll: true })
  }
}
function menuKeys(event: KeyboardEvent) {
  const target = event.target instanceof Element ? event.target : undefined
  const menu = target?.closest<HTMLDetailsElement>(
    'details.editor-file-menu, details.ribbon-format-menu',
  )
  if (!menu || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  if (target?.closest('input, textarea, select')) return
  const summary = menu.querySelector<HTMLElement>(':scope > summary')
  if (!menu.open && target !== summary) return
  event.preventDefault()
  event.stopPropagation()
  menu.open = true
  const elements = [
    ...menu.querySelectorAll<HTMLElement>(
      '.context-menu button:not(:disabled), .context-menu select:not(:disabled), .context-menu input:not(:disabled)',
    ),
  ].filter((element) => element.getClientRects().length && !element.closest('[inert]'))
  if (!elements.length) return
  const index = elements.findIndex((element) => element === document.activeElement)
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? elements.length - 1
        : index < 0
          ? event.key === 'ArrowUp'
            ? elements.length - 1
            : 0
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + elements.length) % elements.length
  elements[next]?.focus({ preventScroll: true })
}
const media = window.matchMedia('(prefers-color-scheme: dark)')
const handleSystemTheme = () => {
  if (store.themePreference === 'system') store.applyTheme()
}
onMounted(() => {
  store.applyTheme()
  document.documentElement.dataset.motion = localStorage.getItem('arca-motion') ?? 'system'
  media.addEventListener('change', handleSystemTheme)
  window.addEventListener('beforeunload', guardUnsavedDrafts)
  document.addEventListener('pointerdown', dismissMenus)
  document.addEventListener('click', dismissMenus)
  document.addEventListener('keydown', dismissMenus)
  document.addEventListener('keydown', menuKeys)
  document.addEventListener('focusin', dismissMenus)
  if (embedded && desktop) {
    stopDirty = watch(
      () =>
        !store.applicationStopped &&
        (store.drafts.length > 0 || store.officeDirty || store.editState === 'saving'),
      (dirty) => {
        desktop.send?.('desktop-tabs:unsaved-changes', dirty)
      },
      { immediate: true, flush: 'sync' },
    )
    stopTheme = desktop.on?.('desktop-shell:theme-changed', receiveTheme)
    void desktop
      .invoke('desktop-tabs:get-theme')
      .then((value) => {
        if (!disposed && !themeReceived) receiveTheme(value)
      })
      .catch(() => {})
  }
  void store.connect()
})
onBeforeUnmount(() => {
  disposed = true
  stopTheme?.()
  stopDirty?.()
  media.removeEventListener('change', handleSystemTheme)
  window.removeEventListener('beforeunload', guardUnsavedDrafts)
  document.removeEventListener('pointerdown', dismissMenus)
  document.removeEventListener('click', dismissMenus)
  document.removeEventListener('keydown', dismissMenus)
  document.removeEventListener('keydown', menuKeys)
  document.removeEventListener('focusin', dismissMenus)
})
</script>

<template>
  <div class="arca-app-shell">
    <ArcaTitleBar />
    <ApplicationBar />
    <div v-if="store.applicationStopped" class="surface-empty stopped-page">
      <strong>{{ __t('apps.arca.ui', 'Arca 已停止') }}</strong>
      <p>{{ __t('apps.arca.ui', '可以关闭此标签页。') }}</p>
    </div>
    <div v-else class="arca-app-content" :inert="store.applicationStopping || openDialogs > 0">
      <div v-if="store.errorMessage" class="workbench-error" role="alert">
        <span>{{ store.errorMessage }}</span>
        <button
          class="icon-button"
          :aria-label="__t('apps.arca.ui', '关闭提示')"
          @click="store.errorMessage = ''"
        >
          ×
        </button>
      </div>
      <RouterView v-slot="{ Component, route }">
        <component :is="Component" :key="route.name ?? route.path" class="route-work-surface" />
      </RouterView>
    </div>
  </div>
</template>
