<script setup lang="ts">
/**
 * ChatView — 聊天页面
 *
 * 聊天模式的顶层 View，包含：
 * - 左侧 Agent 列表侧边栏
 * - 右侧 ChatContainer 主聊天区
 *
 */
import { ref, computed, onMounted } from 'vue'
import { ChatContainer } from '../components/chat'
import { PixelIcon, PTooltip, PEmpty } from '../components/pixel'
import { useAgentStore } from '../stores'

defineOptions({ name: 'ChatView' })

const agentStore = useAgentStore()

const searchQuery = ref('')
const isLoading = ref(false)

/** 过滤后的 Agent 列表 */
const filteredAgents = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return agentStore.agents
  return agentStore.agents.filter((a) => a.name?.toLowerCase().includes(q))
})

/** 当前活跃的 Agent */
const activeAgent = computed(() => agentStore.currentAgent)

/** 切换 Agent */
async function switchAgent(agent: { id: string; name: string }) {
  await agentStore.switchAgent(agent.id)
}

/** 加载 Agent 列表 */
async function loadAgents() {
  isLoading.value = true
  try {
    await agentStore.fetchAgents()
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadAgents()
})
</script>

<template>
  <div class="flex w-full h-full overflow-hidden bg-white">
    <!-- 侧边栏 -->
    <aside class="w-64 flex flex-col h-full border-r-2 border-slate-200 bg-slate-50/40">
      <!-- 搜索 -->
      <div class="px-4 pt-2 pb-4 flex-shrink-0">
        <div class="relative">
          <PixelIcon name="search" size="xs" class="absolute left-3 top-2.5 text-slate-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索助手..."
            class="w-full py-2 px-3 pl-9 text-xs border-2 border-slate-200 bg-white text-slate-800 outline-none transition-colors focus:border-sky-300 placeholder:text-slate-400"
          />
        </div>
      </div>

      <!-- Agent 列表 -->
      <div class="flex-1 overflow-y-auto px-3 pb-3 chat-scrollbar">
        <div class="flex items-center justify-between px-2 pb-2">
          <span
            class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em] flex items-center gap-1"
          >
            AGENTS
            <span class="w-1 h-1 bg-sky-300 sidebar-pulse" />
          </span>
          <PTooltip content="刷新列表" placement="top">
            <button
              class="p-1.5 bg-white border-2 border-slate-200 text-slate-400 cursor-pointer transition-all hover:border-sky-300 hover:text-sky-500"
              @click="loadAgents"
            >
              <PixelIcon name="refresh" size="xs" :animation="isLoading ? 'spin' : ''" />
            </button>
          </PTooltip>
        </div>

        <!-- 空状态 -->
        <PEmpty
          v-if="filteredAgents.length === 0 && !isLoading"
          message="暂无助手"
          sub-message="No Agents"
        />

        <!-- Agent 卡片 -->
        <div
          v-for="agent in filteredAgents"
          :key="agent.id"
          :class="[
            'flex items-center gap-3 p-2 cursor-pointer relative transition-all mb-1 hover:bg-white hover:translate-x-0.5',
            activeAgent?.id === agent.id ? 'bg-white border-2 border-slate-200' : '',
          ]"
          @click="switchAgent(agent)"
        >
          <!-- 活跃指示器 -->
          <div
            v-if="activeAgent?.id === agent.id"
            class="absolute left-0 top-2 bottom-2 w-[3px] bg-sky-500"
          />

          <!-- 头像 -->
          <div
            :class="[
              'w-10 h-10 flex items-center justify-center text-white font-bold text-sm border-2 transition-all',
              activeAgent?.id === agent.id
                ? 'bg-sky-500 border-sky-600'
                : 'bg-sky-300 border-slate-200',
            ]"
          >
            {{ agent.name?.[0]?.toUpperCase() ?? '?' }}
          </div>

          <!-- 信息 -->
          <div class="flex-1 min-w-0">
            <span
              :class="[
                'block text-[13px] font-bold truncate',
                activeAgent?.id === agent.id ? 'text-sky-500' : 'text-slate-500',
              ]"
            >
              {{ agent.name }}
            </span>
            <span class="text-[10px] font-mono text-slate-400">
              {{ activeAgent?.id === agent.id ? 'ONLINE' : 'STANDBY' }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 主聊天区 -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- 头部 -->
      <header
        class="h-14 px-6 flex items-center justify-between border-b-2 border-slate-200 bg-white/30 flex-shrink-0"
      >
        <div class="flex items-center gap-3">
          <div class="p-1.5 bg-sky-50 text-sky-500">
            <PixelIcon name="chat" size="sm" />
          </div>
          <span class="text-lg font-black text-slate-800 tracking-wide">
            {{ activeAgent?.name ?? 'Pero' }}
          </span>
          <span
            class="px-2 py-0.5 text-[10px] font-bold border border-sky-200 bg-sky-50/50 text-sky-500"
          >
            CONNECTED
          </span>
        </div>
      </header>

      <!-- 聊天容器 -->
      <ChatContainer
        v-if="activeAgent"
        :key="activeAgent.id"
        :agent-id="activeAgent.id"
        :agent-name="activeAgent.name"
        class="flex-1 overflow-hidden"
      />

      <!-- 无选中状态 -->
      <div v-else class="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400">
        <div class="p-6 bg-sky-50/50 border-2 border-slate-200 text-sky-200">
          <PixelIcon name="chat" size="3xl" />
        </div>
        <div class="text-center">
          <p class="text-lg font-bold text-slate-500">等待连接...</p>
          <p class="text-xs mt-1">请从左侧选择一个助手开始聊天</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.chat-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.chat-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}

/* 侧边栏脉冲点 */
@keyframes sidebar-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.sidebar-pulse {
  animation: sidebar-pulse 2s infinite;
}
</style>
