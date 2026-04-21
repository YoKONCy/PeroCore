<template>
  <div v-if="groupedButtons.size > 0" class="feature-controls">
    <div v-for="[group, buttons] in groupedButtons" :key="group" class="feature-group">
      <div v-if="group !== 'default'" class="group-title">{{ group }}</div>
      <div class="button-list">
        <button
          v-for="btn in buttons"
          :key="btn.id"
          :class="['feature-btn', { active: getState(btn.id) }]"
          :title="btn.label"
          @click="toggleState(btn.id)"
        >
          <span v-if="btn.icon" class="btn-icon">{{ btn.icon }}</span>
          <span class="btn-label">{{ btn.label }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FeatureButton } from './lib/adapter/IAvatarManifest'

const props = defineProps<{
  featureButtons: FeatureButton[]
  modelValue: Record<string, boolean>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, boolean>): void
}>()

const groupedButtons = computed(() => {
  const groups = new Map<string, FeatureButton[]>()

  props.featureButtons.forEach((btn) => {
    const group = btn.group || 'default'
    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group)!.push(btn)
  })

  return groups
})

const getState = (id: string): boolean => {
  return props.modelValue[id] ?? false
}

const toggleState = (id: string) => {
  emit('update:modelValue', {
    ...props.modelValue,
    [id]: !getState(id),
  })
}
</script>

<style scoped>
.feature-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(4px);
  border: 2px solid rgba(249, 168, 212, 0.3); /* 萌粉色 */
  border-radius: 0; /* 像素风格 */
  min-width: 120px;
  box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.1);
}

.feature-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-title {
  font-size: 10px;
  color: #2d1b1e; /* 萌可可色 */
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 2px;
  font-family: 'Press Start 2P', cursive, sans-serif; /* 回退 */
}

.button-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.feature-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 2px solid transparent;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.5);
  color: #2d1b1e;
  font-size: 10px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
  font-family: monospace;
}

.feature-btn:hover {
  background: white;
  transform: translateY(-1px);
  box-shadow: 2px 2px 0 rgba(249, 168, 212, 0.2);
}

.feature-btn.active {
  background: #f9a8d4; /* 萌粉色 */
  color: white;
  border-color: #f472b6;
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.1);
  transform: translateY(1px);
}
</style>
