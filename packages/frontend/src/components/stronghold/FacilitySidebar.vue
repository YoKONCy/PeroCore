<script setup lang="ts">
/**
 * FacilitySidebar — 据点左侧栏
 *
 * 设施 Tab + 房间列表。
 *
 * @emits select-room - 选中房间
 */
import { PixelIcon } from '../pixel'

export interface Facility {
  id: number
  name: string
  icon?: string
}

export interface Room {
  id: number
  name: string
  description?: string
  environment_json?: string
}

interface Props {
  facilities: Facility[]
  rooms: Room[]
  currentFacility: Facility | null
  currentRoom: Room | null
  isLoading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'select-facility': [fac: Facility]
  'select-room': [room: Room]
}>()
</script>

<template>
  <aside class="sh-sidebar">
    <!-- 标题 -->
    <div class="sh-sidebar-header">
      <div class="sh-sidebar-icon">
        <PixelIcon name="home" size="sm" />
      </div>
      <div>
        <h2 class="sh-sidebar-title">据点中心</h2>
        <span class="sh-sidebar-sub">STRONGHOLD MGMT</span>
      </div>
    </div>

    <!-- 设施 Tab -->
    <div class="sh-fac-tabs">
      <button
        v-for="fac in facilities"
        :key="fac.id"
        :class="['sh-fac-btn', { 'sh-fac-btn-active': currentFacility?.id === fac.id }]"
        @click="emit('select-facility', fac)"
      >
        <PixelIcon :name="fac.icon || 'building'" size="sm" />
        <span class="sh-fac-label">{{ fac.name }}</span>
      </button>
    </div>

    <!-- 房间列表 -->
    <div class="sh-rooms">
      <div class="sh-rooms-header">
        <span class="sh-rooms-title">区域列表</span>
        <div class="sh-rooms-line" />
      </div>

      <div v-if="isLoading" class="sh-loading">
        <PixelIcon name="refresh" size="md" animation="spin" />
        <span>正在扫描据点...</span>
      </div>

      <div
        v-for="room in rooms"
        v-else
        :key="room.id"
        :class="['sh-room', { 'sh-room-active': currentRoom?.id === room.id }]"
        @click="emit('select-room', room)"
      >
        <div v-if="currentRoom?.id === room.id" class="sh-room-indicator" />
        <PixelIcon
          :name="currentRoom?.id === room.id ? 'door-open' : 'door-closed'"
          size="sm"
          class="sh-room-icon"
        />
        <div class="sh-room-info">
          <span class="sh-room-name">{{ room.name }}</span>
          <span class="sh-room-desc">{{ room.description || '据点环境探测中...' }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sh-sidebar {
  width: 280px;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
}

.sh-sidebar-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px;
  border-bottom: 2px solid var(--color-border);
}
.sh-sidebar-icon {
  padding: 10px;
  background: var(--color-pink-200);
  color: var(--color-pink-600);
}
.sh-sidebar-title {
  font-size: 20px;
  font-weight: 800;
  color: var(--color-text-primary);
}
.sh-sidebar-sub {
  font-size: 9px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

/* 设施 Tab */
.sh-fac-tabs {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-bottom: 2px solid var(--color-border);
  overflow-x: auto;
}
.sh-fac-tabs::-webkit-scrollbar { height: 0; }

.sh-fac-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 12px;
  min-width: 64px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 10px;
  font-weight: 700;
  transition: all 0.2s;
  flex-shrink: 0;
}
.sh-fac-btn:hover { color: var(--color-pink-500); border-color: var(--color-pink-200); }
.sh-fac-btn-active {
  background: var(--color-pink-500);
  color: white;
  border-color: var(--color-pink-600);
}
.sh-fac-label {
  text-transform: uppercase;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

/* 房间 */
.sh-rooms {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.sh-rooms::-webkit-scrollbar { width: 4px; }
.sh-rooms::-webkit-scrollbar-track { background: transparent; }
.sh-rooms::-webkit-scrollbar-thumb { background: var(--color-blue-200); }

.sh-rooms-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.sh-rooms-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  flex-shrink: 0;
}
.sh-rooms-line { flex: 1; height: 1px; background: var(--color-border); }

.sh-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
}

.sh-room {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  margin-bottom: 8px;
}
.sh-room:hover { background: var(--color-bg-secondary); }
.sh-room-active {
  background: var(--color-bg-primary);
  border-color: var(--color-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  transform: translateY(-1px);
}
.sh-room-indicator {
  position: absolute;
  left: -1px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--color-pink-500);
}
.sh-room-icon { color: var(--color-text-muted); flex-shrink: 0; }
.sh-room-active .sh-room-icon { color: var(--color-pink-500); }
.sh-room-info { flex: 1; min-width: 0; }
.sh-room-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sh-room-desc {
  display: block;
  font-size: 10px;
  color: var(--color-text-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
