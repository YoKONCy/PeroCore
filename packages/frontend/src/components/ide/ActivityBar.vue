<script setup lang="ts">
/**
 * ActivityBar — IDE 左侧活动栏
 *
 * 提供 Explorer / Search / Settings 三个面板切换按钮。
 *
 * @props activeTab - 当前激活的面板 ID
 * @emits update:activeTab - 切换面板
 */
import PixelIcon from '../pixel/PixelIcon.vue'

interface Props {
  activeTab?: string
}

withDefaults(defineProps<Props>(), {
  activeTab: 'explorer',
})

defineEmits<{
  'update:activeTab': [tab: string]
}>()

/** 活动项按钮配置 */
const items = [
  { id: 'explorer', icon: 'folder', title: 'Explorer (Ctrl+Shift+E)' },
  { id: 'search', icon: 'search', title: 'Search (Ctrl+Shift+F)' },
] as const
</script>

<template>
  <div class="activity-bar">
    <!-- 功能按钮 -->
    <button
      v-for="item in items"
      :key="item.id"
      :class="['ab-item', { 'ab-item-active': activeTab === item.id }]"
      :title="item.title"
      @click="$emit('update:activeTab', item.id)"
    >
      <div v-if="activeTab === item.id" class="ab-indicator" />
      <PixelIcon :name="item.icon" size="sm" />
    </button>

    <!-- 弹性空间 -->
    <div class="ab-spacer" />

    <!-- 设置 (底部固定) -->
    <button class="ab-item ab-item-bottom" title="Settings">
      <PixelIcon name="settings" size="sm" />
    </button>
  </div>
</template>

<style scoped>
.activity-bar {
  width: 48px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  background: var(--color-bg-secondary);
  border-right: 2px solid var(--color-border);
  user-select: none;
}

.ab-item {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  position: relative;
  margin-bottom: 4px;
  transition: all 0.15s;
}
.ab-item:hover {
  color: var(--color-blue-500);
  background: var(--color-bg-hover);
}

.ab-item-active {
  color: var(--color-blue-500);
  background: var(--color-bg-hover);
}

.ab-indicator {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 3px;
  background: var(--color-blue-500);
}

.ab-spacer { flex: 1; }

.ab-item-bottom {
  margin-bottom: 0;
  margin-top: 4px;
}
</style>
