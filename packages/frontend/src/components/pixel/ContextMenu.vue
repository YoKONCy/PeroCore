<script setup lang="ts">
/**
 * ContextMenu — 像素风右键菜单
 *
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
}) as (e: Event) => void)
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
  background: var(--dash-panel-elevated);
  border: 2px solid var(--ui-border-strong);
  box-shadow: var(--ui-shadow-md);
  padding: 4px 0;
}

.p-ctx-separator {
  height: 2px;
  background: var(--ui-border-default);
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
  color: var(--ui-text-primary);
  cursor: pointer;
  text-align: left;
  transition: all 0.1s;
}
.p-ctx-item:hover:not(:disabled) {
  background: var(--ui-accent-sky-soft);
  color: var(--ui-accent-sky);
}
.p-ctx-item-disabled {
  color: var(--ui-text-disabled);
  cursor: not-allowed;
}

.p-ctx-shortcut {
  font-size: 10px;
  font-family: var(--ui-font-pixel);
  color: var(--ui-text-tertiary);
  margin-left: 16px;
}
.p-ctx-item:hover .p-ctx-shortcut {
  color: var(--ui-accent-sky);
}

/* 动画 */
.ctx-menu-enter-active {
  transition: all 0.1s ease-out;
}
.ctx-menu-leave-active {
  transition: all 0.075s ease-in;
}
.ctx-menu-enter-from,
.ctx-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
