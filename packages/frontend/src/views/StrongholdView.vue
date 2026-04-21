<script setup lang="ts">
/**
 * StrongholdView — 据点管理页面
 *
 * 三栏布局: 设施/房间侧栏 + 聊天主区 + 成员/管家右栏。
 * 通过 useStronghold composable 接入真实 API。
 *
 * @see 06_FILE_SIZE_LIMITS.md
 */
import { ref } from 'vue'
import { PixelIcon, PButton, PDialog } from '../components/pixel'
import FacilitySidebar from '../components/stronghold/FacilitySidebar.vue'
import AgentPanel from '../components/stronghold/AgentPanel.vue'
import { ChatContainer } from '../components/chat'
import type { Facility, Room } from '../components/stronghold/FacilitySidebar.vue'
import { useStronghold } from '../composables/useStronghold'

defineOptions({ name: 'StrongholdView' })

// ── useStronghold (真实 API) ──

const {
  facilities,
  rooms,
  currentFacility,
  currentRoom,
  isLoading,
  agentsStatus,
  butlerConfig,
  currentRoomAgents,
  selectFacility: selectFac,
  selectRoom: selectRm,
  callButler,
} = useStronghold()

// 管家弹窗
const showButler = ref(false)
const butlerQuery = ref('')
const isCalling = ref(false)

/** 选择设施 (适配 FacilitySidebar emit 类型) */
function selectFacility(fac: Facility) {
  selectFac(fac as any)
}

/** 选择房间 */
function selectRoom(room: Room) {
  selectRm(room as any)
}

/** 召唤智能体 */
function summonAgent(name: string) {
  butlerQuery.value = `把 ${name} 叫到这里来`
  showButler.value = true
}

/** 提交管家指令 */
async function submitButler() {
  if (!butlerQuery.value.trim()) return
  isCalling.value = true
  try {
    await callButler(butlerQuery.value)
  } finally {
    showButler.value = false
    butlerQuery.value = ''
    isCalling.value = false
  }
}

/** 打开管家弹窗 */
function openButler() {
  showButler.value = true
  butlerQuery.value = ''
}
</script>

<template>
  <div class="stronghold">
    <!-- 左侧栏 -->
    <FacilitySidebar
      :facilities="facilities"
      :rooms="rooms"
      :current-facility="currentFacility as any"
      :current-room="currentRoom as any"
      :is-loading="isLoading"
      @select-facility="selectFacility"
      @select-room="selectRoom"
    />

    <!-- 中间: 聊天 -->
    <main class="sh-main">
      <template v-if="currentRoom">
        <!-- 房间标题 -->
        <header class="sh-room-header">
          <div class="sh-room-header-left">
            <div class="sh-room-icon">
              <PixelIcon name="door-open" size="md" />
            </div>
            <div>
              <h1 class="sh-room-title">
                {{ currentRoom.name }}
                <span v-if="currentFacility" class="sh-room-fac-badge">
                  {{ currentFacility.name }}
                </span>
              </h1>
              <p class="sh-room-sub">
                <span class="sh-online-dot" />
                据点通讯链路：已建立加密连接
              </p>
            </div>
          </div>
        </header>

        <!-- 聊天区 -->
        <div class="sh-chat-area">
          <ChatContainer
            :key="currentRoom.id"
            :agent-id="currentRoom.id.toString()"
            :agent-name="currentRoom.name"
          />
        </div>
      </template>

      <!-- 未选择 -->
      <div v-else class="sh-empty">
        <PixelIcon name="building" size="3xl" />
        <h3 class="sh-empty-title">请选择一个房间</h3>
        <p class="sh-empty-sub">等待接入授权中...</p>
      </div>
    </main>

    <!-- 右侧栏 -->
    <AgentPanel
      :current-room-agents="currentRoomAgents as any"
      :all-agents="agentsStatus as any"
      :butler-config="butlerConfig as any"
      @summon="summonAgent"
      @open-butler="openButler"
    />

    <!-- 管家弹窗 -->
    <PDialog v-model="showButler" title="BUTLER INTERFACE">
      <div class="sh-butler-body">
        <textarea
          v-model="butlerQuery"
          class="sh-butler-input"
          placeholder="告诉管家你需要什么..."
          @keydown.ctrl.enter="submitButler"
        />
        <div class="sh-butler-actions">
          <PButton variant="ghost" @click="showButler = false">取消</PButton>
          <PButton
            variant="primary"
            :disabled="!butlerQuery.trim() || isCalling"
            @click="submitButler"
          >
            {{ isCalling ? '发送中...' : '发送指令' }}
          </PButton>
        </div>
      </div>
    </PDialog>
  </div>
</template>

<style scoped>
.stronghold {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  gap: 4px;
  padding: 4px;
  background: var(--color-bg-primary);
}

/* 主区 */
.sh-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  overflow: hidden;
  min-width: 0;
}

.sh-room-header {
  padding: 20px 24px;
  border-bottom: 2px solid var(--color-border);
  flex-shrink: 0;
}

.sh-room-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sh-room-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-sky-500);
  color: white;
}

.sh-room-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 12px;
}

.sh-room-fac-badge {
  padding: 4px 12px;
  background: var(--color-pink-face);
  color: white;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.sh-room-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

.sh-online-dot {
  width: 6px;
  height: 6px;
  background: var(--color-emerald-face);
  animation: pulse 2s infinite;
}

.sh-chat-area {
  flex: 1;
  overflow: hidden;
}

/* 空状态 */
.sh-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: var(--color-text-muted);
}

.sh-empty-title {
  font-size: 24px;
  font-weight: 800;
  color: var(--color-text-secondary);
}

.sh-empty-sub {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.3em;
  animation: pulse 2s infinite;
}

/* 管家弹窗 */
.sh-butler-body {
  padding: 24px;
}

.sh-butler-input {
  width: 100%;
  height: 160px;
  padding: 16px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  font-size: 14px;
  resize: none;
  outline: none;
  transition: border-color 0.2s;
}

.sh-butler-input:focus {
  border-color: var(--color-sky-hover);
}

.sh-butler-input::placeholder {
  color: var(--color-text-muted);
}

.sh-butler-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 1;
  }
}
</style>
