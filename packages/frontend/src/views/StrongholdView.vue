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
  <div class="flex w-full h-full overflow-hidden gap-1 p-1 bg-white">
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
    <main class="flex-1 flex flex-col border-2 border-slate-200 bg-white overflow-hidden min-w-0">
      <template v-if="currentRoom">
        <!-- 房间标题 -->
        <header class="px-6 py-5 border-b-2 border-slate-200 flex-shrink-0">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 flex items-center justify-center bg-sky-500 text-white">
              <PixelIcon name="door-open" size="md" />
            </div>
            <div>
              <h1 class="text-2xl font-black text-slate-800 flex items-center gap-3">
                {{ currentRoom.name }}
                <span
                  v-if="currentFacility"
                  class="px-3 py-1 bg-pink-500 text-white text-[10px] font-bold uppercase tracking-[0.15em]"
                >
                  {{ currentFacility.name }}
                </span>
              </h1>
              <p
                class="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-[0.2em]"
              >
                <span class="w-1.5 h-1.5 bg-emerald-500 sh-pulse" />
                据点通讯链路：已建立加密连接
              </p>
            </div>
          </div>
        </header>

        <!-- 聊天区 -->
        <div class="flex-1 overflow-hidden">
          <ChatContainer
            :key="currentRoom.id"
            :agent-id="currentRoom.id.toString()"
            :agent-name="currentRoom.name"
          />
        </div>
      </template>

      <!-- 未选择 -->
      <div v-else class="flex flex-col items-center justify-center h-full gap-4 text-slate-400">
        <PixelIcon name="building" size="3xl" />
        <h3 class="text-2xl font-black text-slate-500">请选择一个房间</h3>
        <p class="text-[10px] font-bold uppercase tracking-[0.3em] sh-pulse">等待接入授权中...</p>
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
      <div class="p-6">
        <textarea
          v-model="butlerQuery"
          class="w-full h-40 p-4 border-2 border-slate-200 bg-white text-slate-800 text-sm resize-none outline-none transition-colors focus:border-sky-300 placeholder:text-slate-400"
          placeholder="告诉管家你需要什么..."
          @keydown.ctrl.enter="submitButler"
        />
        <div class="flex justify-end gap-3 mt-4">
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
@keyframes sh-pulse-anim {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.sh-pulse {
  animation: sh-pulse-anim 2s infinite;
}
</style>
