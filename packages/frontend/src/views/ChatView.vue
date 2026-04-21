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
  <div class="chat-view">
    <!-- 侧边栏 -->
    <aside class="chat-sidebar">
      <!-- 搜索 -->
      <div class="sidebar-search">
        <div class="sidebar-search-wrapper">
          <PixelIcon name="search" size="xs" class="sidebar-search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索助手..."
            class="sidebar-search-input"
          />
        </div>
      </div>

      <!-- Agent 列表 -->
      <div class="sidebar-list">
        <div class="sidebar-list-header">
          <span class="sidebar-list-label"> AGENTS <span class="sidebar-dot" /> </span>
          <PTooltip content="刷新列表" placement="top">
            <button class="sidebar-refresh-btn" @click="loadAgents">
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
          :class="['sidebar-agent', { 'sidebar-agent-active': activeAgent?.id === agent.id }]"
          @click="switchAgent(agent)"
        >
          <!-- 活跃指示器 -->
          <div v-if="activeAgent?.id === agent.id" class="sidebar-agent-indicator" />

          <!-- 头像 -->
          <div
            :class="[
              'sidebar-agent-avatar',
              { 'sidebar-agent-avatar-active': activeAgent?.id === agent.id },
            ]"
          >
            {{ agent.name?.[0]?.toUpperCase() ?? '?' }}
          </div>

          <!-- 信息 -->
          <div class="sidebar-agent-info">
            <span
              :class="[
                'sidebar-agent-name',
                { 'sidebar-agent-name-active': activeAgent?.id === agent.id },
              ]"
            >
              {{ agent.name }}
            </span>
            <span class="sidebar-agent-status">
              {{ activeAgent?.id === agent.id ? 'ONLINE' : 'STANDBY' }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 主聊天区 -->
    <div class="chat-main">
      <!-- 头部 -->
      <header class="chat-header">
        <div class="chat-header-left">
          <div class="chat-header-icon">
            <PixelIcon name="chat" size="sm" />
          </div>
          <span class="chat-header-name">{{ activeAgent?.name ?? 'Pero' }}</span>
          <span class="chat-header-badge">CONNECTED</span>
        </div>
      </header>

      <!-- 聊天容器 -->
      <ChatContainer
        v-if="activeAgent"
        :key="activeAgent.id"
        :agent-id="activeAgent.id"
        :agent-name="activeAgent.name"
        class="chat-main-body"
      />

      <!-- 无选中状态 -->
      <div v-else class="chat-empty">
        <div class="chat-empty-icon-wrap">
          <PixelIcon name="chat" size="3xl" />
        </div>
        <div class="chat-empty-text">
          <p class="chat-empty-title">等待连接...</p>
          <p class="chat-empty-sub">请从左侧选择一个助手开始聊天</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg-primary);
}

/* ── 侧边栏 ── */

.chat-sidebar {
  width: 256px;
  display: flex;
  flex-direction: column;
  height: 100%;
  border-right: 2px solid var(--color-border);
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.4));
}

.sidebar-search {
  padding: 8px 16px 16px;
  flex-shrink: 0;
}
.sidebar-search-wrapper {
  position: relative;
}
.sidebar-search-icon {
  position: absolute;
  left: 12px;
  top: 10px;
  color: var(--color-text-muted);
}
.sidebar-search-input {
  width: 100%;
  padding: 8px 12px 8px 36px;
  font-size: 12px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.2s;
}
.sidebar-search-input:focus {
  border-color: var(--color-sky-hover);
}
.sidebar-search-input::placeholder {
  color: var(--color-text-muted);
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
}
.sidebar-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 8px;
}
.sidebar-list-label {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  display: flex;
  align-items: center;
  gap: 4px;
}
.sidebar-dot {
  width: 4px;
  height: 4px;
  background: var(--color-sky-hover);
  animation: pulse 2s infinite;
}
.sidebar-refresh-btn {
  padding: 6px;
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: all 0.15s;
}
.sidebar-refresh-btn:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
}

/* Agent 卡片 */
.sidebar-agent {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
  margin-bottom: 4px;
}
.sidebar-agent:hover {
  background: var(--color-bg-primary);
  transform: translateX(2px);
}
.sidebar-agent-active {
  background: var(--color-bg-primary);
  border: 2px solid var(--color-border);
}

.sidebar-agent-indicator {
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  background: var(--color-sky-500);
}

.sidebar-agent-avatar {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 700;
  font-size: 14px;
  background: var(--color-sky-hover);
  border: 2px solid var(--color-border);
  transition: all 0.2s;
}
.sidebar-agent-avatar-active {
  background: var(--color-sky-500);
  border-color: var(--color-sky-shadow);
}

.sidebar-agent-info {
  flex: 1;
  min-width: 0;
}
.sidebar-agent-name {
  display: block;
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-agent-name-active {
  color: var(--color-sky-500);
}
.sidebar-agent-status {
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-muted);
}

/* ── 主聊天区 ── */

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-header {
  height: 56px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 2px solid var(--color-border);
  background: var(--color-bg-secondary, rgba(255, 255, 255, 0.3));
  flex-shrink: 0;
}
.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.chat-header-icon {
  padding: 6px;
  background: rgba(56, 189, 248, 0.1);
  color: var(--color-sky-500);
}
.chat-header-name {
  font-size: 18px;
  font-weight: 800;
  color: var(--color-text-primary);
  letter-spacing: 0.03em;
}
.chat-header-badge {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  border: 1px solid var(--color-sky-light);
  background: rgba(56, 189, 248, 0.05);
  color: var(--color-sky-500);
}

.chat-main-body {
  flex: 1;
  overflow: hidden;
}

/* 空状态 */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--color-text-muted);
}
.chat-empty-icon-wrap {
  padding: 24px;
  background: rgba(56, 189, 248, 0.05);
  border: 2px solid var(--color-border);
  color: var(--color-sky-light);
}
.chat-empty-text {
  text-align: center;
}
.chat-empty-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-secondary);
}
.chat-empty-sub {
  font-size: 12px;
  margin-top: 4px;
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

/* 滚动条 */
.sidebar-list::-webkit-scrollbar {
  width: 4px;
}
.sidebar-list::-webkit-scrollbar-track {
  background: transparent;
}
.sidebar-list::-webkit-scrollbar-thumb {
  background: var(--color-sky-light);
}
</style>
