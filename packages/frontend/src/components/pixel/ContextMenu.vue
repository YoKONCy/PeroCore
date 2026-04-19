<script setup lang="ts">
/**
 * ContextMenu — 像素风右键菜单
 *
 * 迁移自 v1，用 useEventListener 管理生命周期。
 */
import { useEventListener } from '../../composables'

export interface ContextMenuItem {
  label?: string
  action?: () => void
  type?: 'item' | 'separator'
  disabled?: boolean
  shortcut?: string
}

interface Props {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
  action: [item: ContextMenuItem]
}>()

function handleClick(item: ContextMenuItem) {
  if (item.disabled) return
  item.action?.()
  emit('close')
}

function close() {
  emit('close')
}

// 点击/右键/Esc 关闭
useEventListener(window, 'click', close)
useEventListener(window, 'contextmenu', close)
useEventListener(window, 'keydown', ((e: KeyboardEvent) => {
  if (e.key === 'Escape') close()
}) as EventListener)
</script>

<template>
  <Teleport to="body">
    <Transition name="ctx-menu">
      <div
        v-if="visible"
        class="p-context-menu"
        :style="{ top: `${y}px`, left: `${x}px` }"
        @click.stop
        @contextmenu.prevent
      >
        <template v-for="(item, idx) in items" :key="idx">
          <div v-if="item.type === 'separator'" class="p-ctx-separator" />
          <button
            v-else
            :class="['p-ctx-item', { 'p-ctx-item-disabled': item.disabled }]"
            :disabled="item.disabled"
            @click="handleClick(item)"
          >
            <span>{{ item.label }}</span>
            <span v-if="item.shortcut" class="p-ctx-shortcut">{{ item.shortcut }}</span>
          </button>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.p-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.12);
  padding: 4px 0;
}

.p-ctx-separator {
  height: 2px;
  background: var(--color-border);
  margin: 4px 8px;
}

.p-ctx-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 700;
  background: none;
  border: none;
  color: var(--color-text-primary);
  cursor: pointer;
  text-align: left;
  transition: all 0.1s;
}
.p-ctx-item:hover:not(:disabled) {
  background: var(--color-blue-500);
  color: white;
}
.p-ctx-item-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.p-ctx-shortcut {
  font-size: 10px;
  font-family: var(--font-pixel), monospace;
  color: var(--color-text-muted);
  margin-left: 16px;
}
.p-ctx-item:hover .p-ctx-shortcut {
  color: rgba(255, 255, 255, 0.8);
}

/* 动画 */
.ctx-menu-enter-active { transition: all 0.1s ease-out; }
.ctx-menu-leave-active { transition: all 0.075s ease-in; }
.ctx-menu-enter-from,
.ctx-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
