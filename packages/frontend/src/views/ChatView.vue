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
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { useAgentStore, useThreadStore } from '../stores'
import { useNotificationStore } from '../stores/useNotificationStore'
import { isElectron } from '../utils/ipcAdapter'

defineOptions({ name: 'ChatView' })

const agentStore = useAgentStore()
const threadStore = useThreadStore()
const notify = useNotificationStore()

const searchQuery = ref('')
const isLoading = ref(false)
const isCreatingSession = ref(false)

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

/** 新建当前 Agent 的空白会话 */
async function createNewChatSession() {
  if (!activeAgent.value || threadStore.isGenerating || isCreatingSession.value) return

  isCreatingSession.value = true
  try {
    await threadStore.createNewThread(activeAgent.value.id, 'desktop')
    notify.toast('新会话已创建', { type: 'success', title: '聊天会话' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '新建会话失败'
    notify.toast(message, { type: 'error', title: '聊天会话' })
  } finally {
    isCreatingSession.value = false
  }
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
  <div class="chat-window-shell">
    <CustomTitleBar v-if="isElectron()" title="PeroperoChat" transparent />

    <div class="chat-view-root" :class="{ 'chat-view-root-electron': isElectron() }">
      <div class="chat-ambient-light" />

      <!-- 侧边栏 -->
      <aside class="chat-sidebar pixel-border-moe">
        <div class="chat-sidebar-header">
          <div class="chat-sidebar-title">
            <div class="chat-sidebar-icon">
              <PixelIcon name="chat" size="sm" />
            </div>
            <div>
              <div class="chat-sidebar-name">PeroperoChat</div>
              <div class="chat-sidebar-subtitle">萌动链接</div>
            </div>
          </div>
        </div>

        <!-- 搜索 -->
        <div class="chat-search-wrap">
          <div class="chat-search-box pixel-border-moe">
            <PixelIcon name="search" size="xs" class="chat-search-icon" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索助手..."
              class="chat-search-input"
            />
          </div>
        </div>

        <!-- Agent 列表 -->
        <div class="chat-agent-list chat-scrollbar">
          <div class="chat-agent-list-head">
            <span class="chat-agent-list-title">
              AGENTS
              <span class="chat-pulse-dot" />
            </span>
            <PTooltip content="刷新列表" placement="top">
              <button class="chat-refresh-btn pixel-border-moe" @click="loadAgents">
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
              'chat-agent-card pixel-border-moe',
              activeAgent?.id === agent.id ? 'chat-agent-card-active' : '',
            ]"
            @click="switchAgent(agent)"
          >
            <div v-if="activeAgent?.id === agent.id" class="chat-agent-active-mark" />

            <div
              :class="[
                'chat-agent-avatar pixel-border-moe',
                activeAgent?.id === agent.id ? 'chat-agent-avatar-active' : '',
              ]"
            >
              {{ agent.name?.[0]?.toUpperCase() ?? '?' }}
            </div>

            <div class="chat-agent-info">
              <span
                :class="[
                  'chat-agent-name',
                  activeAgent?.id === agent.id ? 'chat-agent-name-active' : '',
                ]"
              >
                {{ agent.name }}
              </span>
              <span class="chat-agent-status">
                {{ activeAgent?.id === agent.id ? 'ONLINE' : 'STANDBY' }}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <!-- 主聊天区 -->
      <div class="chat-main pixel-border-moe">
        <header class="chat-main-header">
          <div class="chat-main-title-wrap">
            <div class="chat-main-icon">
              <PixelIcon name="chat" size="sm" />
            </div>
            <span class="chat-main-title">
              {{ activeAgent?.name ?? 'Pero' }}
            </span>
            <span class="chat-connected-badge pixel-border-moe">CONNECTED</span>
          </div>

          <PTooltip content="新建会话" placement="bottom">
            <button
              class="chat-new-session-btn pixel-border-moe"
              :disabled="!activeAgent || threadStore.isGenerating || isCreatingSession"
              @click="createNewChatSession"
            >
              <PixelIcon name="plus" size="xs" :animation="isCreatingSession ? 'spin' : ''" />
              <span>NEW CHAT</span>
            </button>
          </PTooltip>
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
        <div v-else class="chat-empty-state">
          <div class="chat-empty-icon pixel-border-moe">
            <PixelIcon name="chat" size="3xl" />
          </div>
          <div class="text-center">
            <p class="chat-empty-title">等待连接...</p>
            <p class="chat-empty-subtitle">请从左侧选择一个助手开始聊天</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-window-shell {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.chat-view-root {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  padding: 16px;
  gap: 16px;
  background: var(--color-moe-bg-gradient);
  color: var(--color-moe-cocoa);
}

.chat-view-root-electron {
  padding-top: 40px;
}

.chat-ambient-light {
  position: absolute;
  inset: -20%;
  pointer-events: none;
  background:
    radial-gradient(circle at 18% 22%, rgba(249, 168, 212, 0.36), transparent 34%),
    radial-gradient(circle at 82% 72%, rgba(167, 216, 240, 0.42), transparent 36%),
    radial-gradient(circle at 50% 8%, rgba(253, 224, 71, 0.2), transparent 28%);
  filter: blur(56px);
  opacity: 0.9;
}

.chat-sidebar {
  position: relative;
  z-index: 1;
  width: 272px;
  height: 100%;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(255, 252, 249, 0.88);
  backdrop-filter: blur(14px);
  box-shadow:
    0 24px 60px rgba(249, 168, 212, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.64);
}

.chat-sidebar-header {
  padding: 18px 16px 12px;
  border-bottom: 1px solid rgba(45, 27, 30, 0.08);
}

.chat-sidebar-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-sidebar-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: rgba(249, 168, 212, 0.18);
  color: var(--color-moe-pink);
}

.chat-sidebar-name {
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.04em;
  color: var(--color-moe-cocoa);
}

.chat-sidebar-subtitle {
  margin-top: 2px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: rgba(45, 27, 30, 0.45);
}

.chat-search-wrap {
  flex-shrink: 0;
  padding: 14px 14px 10px;
}

.chat-search-box {
  position: relative;
  background: rgba(255, 255, 255, 0.74);
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.chat-search-box:focus-within {
  transform: translateY(-1px);
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    0 8px 22px rgba(249, 168, 212, 0.16);
}

.chat-search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(45, 27, 30, 0.38);
}

.chat-search-input {
  width: 100%;
  padding: 10px 12px 10px 36px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-moe-cocoa);
  font-size: 12px;
  font-weight: 700;
}

.chat-search-input::placeholder {
  color: rgba(45, 27, 30, 0.34);
}

.chat-agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 14px;
}

.chat-agent-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 10px;
}

.chat-agent-list-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgba(45, 27, 30, 0.42);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.16em;
}

.chat-pulse-dot {
  width: 6px;
  height: 6px;
  background: var(--color-moe-pink);
  animation: chat-pulse 2s infinite;
}

.chat-refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.72);
  color: rgba(45, 27, 30, 0.45);
  cursor: pointer;
  transition: all 0.18s ease;
}

.chat-refresh-btn:hover {
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.14);
  transform: translateY(-1px);
}

.chat-agent-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  padding: 10px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.48);
  transition: all 0.2s ease;
}

.chat-agent-card:hover,
.chat-agent-card-active {
  background: rgba(255, 252, 249, 0.96);
  transform: translateX(3px);
  box-shadow:
    -2px 0 0 0 var(--color-moe-cocoa),
    2px 0 0 0 var(--color-moe-cocoa),
    0 -2px 0 0 var(--color-moe-cocoa),
    0 2px 0 0 var(--color-moe-cocoa),
    0 12px 28px rgba(249, 168, 212, 0.16);
}

.chat-agent-active-mark {
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 4px;
  background: var(--color-moe-pink);
}

.chat-agent-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  background: linear-gradient(135deg, var(--color-moe-sky), #7dd3fc);
  color: white;
  font-size: 14px;
  font-weight: 900;
  text-shadow: 0 1px 0 rgba(45, 27, 30, 0.24);
}

.chat-agent-avatar-active {
  background: linear-gradient(135deg, var(--color-moe-pink), var(--color-moe-purple));
}

.chat-agent-info {
  min-width: 0;
  flex: 1;
}

.chat-agent-name {
  display: block;
  overflow: hidden;
  color: rgba(45, 27, 30, 0.64);
  font-size: 13px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-agent-name-active {
  color: var(--color-moe-pink);
}

.chat-agent-status {
  font-family: var(--font-pixel);
  color: rgba(45, 27, 30, 0.34);
  font-size: 10px;
  font-weight: 800;
}

.chat-main {
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(255, 252, 249, 0.86);
  backdrop-filter: blur(16px);
  box-shadow:
    0 28px 80px rgba(167, 216, 240, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.66);
}

.chat-main-header {
  height: 58px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid rgba(45, 27, 30, 0.08);
  background: rgba(255, 255, 255, 0.32);
}

.chat-main-title-wrap {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-main-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: rgba(249, 168, 212, 0.14);
  color: var(--color-moe-pink);
}

.chat-main-title {
  color: var(--color-moe-cocoa);
  font-size: 18px;
  font-weight: 950;
  letter-spacing: 0.04em;
}

.chat-connected-badge {
  padding: 3px 8px;
  background: rgba(249, 168, 212, 0.08);
  color: var(--color-moe-pink);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.chat-new-session-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  background: rgba(255, 252, 249, 0.8);
  color: var(--color-moe-cocoa);
  font-family: var(--font-pixel);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.18s ease;
}

.chat-new-session-btn:hover:not(:disabled) {
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.14);
  transform: translateY(-1px);
}

.chat-new-session-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.chat-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: rgba(45, 27, 30, 0.4);
}

.chat-empty-icon {
  padding: 24px;
  background: rgba(255, 255, 255, 0.34);
  color: rgba(249, 168, 212, 0.28);
  animation: chat-pulse 2.4s infinite;
}

.chat-empty-title {
  color: rgba(45, 27, 30, 0.62);
  font-size: 18px;
  font-weight: 900;
}

.chat-empty-subtitle {
  margin-top: 4px;
  font-size: 12px;
}

.chat-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.chat-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(249, 168, 212, 0.72);
  border-radius: 0;
}

@keyframes chat-pulse {
  0%,
  100% {
    opacity: 0.42;
  }
  50% {
    opacity: 1;
  }
}
</style>
