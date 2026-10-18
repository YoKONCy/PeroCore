<script setup lang="ts">
import { onMounted, onBeforeUnmount, shallowRef, nextTick } from 'vue'
import type { DesktopToastAction, DesktopToastSnapshot } from '@infos/shared'
import PToast from '../components/notification/PToast.vue'
import TaskToastContainer from '../components/taskCenter/TaskToastContainer.vue'
import { invoke, listen, send } from '../utils/ipcAdapter'

const snapshot = shallowRef<DesktopToastSnapshot>({
  revision: -1,
  theme: 'light',
  normal: [],
  tasks: [],
})
const cleanup: Array<() => void> = []
let disposed = false,
  pointerOver = false
let point: { x: number; y: number } | null = null
function apply(value: unknown): void {
  const incoming = value as DesktopToastSnapshot
  if (disposed || !incoming || incoming.revision < snapshot.value.revision) return
  snapshot.value = incoming
  document.documentElement.dataset.theme = incoming.theme
  document.documentElement.style.colorScheme = incoming.theme
  void nextTick().then(updateHitTest)
}
function action(value: DesktopToastAction): void {
  send('desktop-toasts:action', value)
}
function setPointer(over: boolean): void {
  if (pointerOver === over) return
  pointerOver = over
  send('desktop-toasts:pointer', over)
}
function onPointerMove(event: MouseEvent): void {
  point = { x: event.clientX, y: event.clientY }
  const target = event.target
  setPointer(target instanceof Element && !!target.closest('.toast-item, .task-toast'))
}
function updateHitTest(): void {
  if (disposed || !point) return
  const target = document.elementFromPoint(point.x, point.y)
  setPointer(!!target?.closest('.toast-item, .task-toast'))
}
function onPointerLeave(): void {
  point = null
  setPointer(false)
}
onMounted(async () => {
  document.addEventListener('mousemove', onPointerMove)
  document.addEventListener('mouseleave', onPointerLeave)
  window.addEventListener('blur', onPointerLeave)
  for (const [event, handler] of [
    ['desktop-toasts:changed', apply],
    [
      'desktop-toasts:active',
      (active: unknown) => {
        pointerOver = false
        if (active === true) void nextTick().then(updateHitTest)
        else send('desktop-toasts:pointer', false)
      },
    ],
  ] as const) {
    const stop = await listen(event, handler)
    if (disposed) {
      stop()
      return
    }
    cleanup.push(stop)
  }
  apply(await invoke('desktop-toasts:get-state'))
})
onBeforeUnmount(() => {
  disposed = true
  for (const stop of cleanup) stop()
  setPointer(false)
  document.removeEventListener('mousemove', onPointerMove)
  document.removeEventListener('mouseleave', onPointerLeave)
  window.removeEventListener('blur', onPointerLeave)
})
</script>

<template>
  <PToast :items="snapshot.normal" native :on-dismiss="(id) => action({ kind: 'normal', id })" />
  <TaskToastContainer
    :items="snapshot.tasks"
    native
    :on-dismiss="(id) => action({ kind: 'task', id })"
    :on-hover="(id, hovered) => action({ kind: 'hover', id, hovered })"
  />
</template>

<style>
html[data-toast-overlay],
html[data-toast-overlay] body,
html[data-toast-overlay] #app {
  background: transparent !important;
  background-image: none !important;
  border: 0 !important;
  box-shadow: none !important;
  overflow: hidden !important;
}
</style>
