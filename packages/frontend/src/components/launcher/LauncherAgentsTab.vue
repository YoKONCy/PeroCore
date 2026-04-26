<script setup lang="ts">
/**
 * LauncherAgentsTab — Agent 管理标签页
 *
 * 功能：列出所有 Agent、启用/禁用、切换活跃角色
 * 数据源：useAgentStore (Pinia) + agentApi
 */
import { ref, onMounted } from 'vue'
import { PixelIcon, PTooltip } from '../pixel'
import { useAgentStore } from '../../stores'
import { agentApi } from '../../api/modules/agentApi'
import { getApiBaseUrl } from '../../api/transport'
import { logger } from '../../lib/logger'

defineOptions({ name: 'LauncherAgentsTab' })

const agentStore = useAgentStore()
const isLoadingAgents = ref(false)

/** 拉取 Agent 列表 */
async function fetchAgents() {
  isLoadingAgents.value = true
  try {
    await agentStore.fetchAgents()
  } finally {
    isLoadingAgents.value = false
  }
}

/** 启用/禁用 Agent */
async function toggleAgentEnabled(agent: { id: string; isEnabled: boolean }) {
  try {
    if (agent.isEnabled) {
      await agentApi.disable(agent.id)
    } else {
      await agentApi.enable(agent.id)
    }
    await agentStore.fetchAgents()
  } catch (err) {
    logger.error('LauncherAgents', '切换 Agent 状态失败', err)
  }
}

/** 设为活跃 Agent */
async function setAsActive(agent: { id: string }) {
  await agentStore.switchAgent(agent.id)
}

/** 根据索引返回边框颜色 class */
function getBorderClass(index: number, isActive: boolean, isEnabled: boolean): string {
  if (isActive) return 'pixel-border-sky bg-sky-50/50 hover:bg-sky-100/50'
  if (!isEnabled) return 'bg-slate-50 pixel-border-sm opacity-60 grayscale hover:opacity-80'
  const colors = [
    'pixel-border-indigo bg-white hover:bg-indigo-50/50',
    'pixel-border-pink bg-white hover:bg-pink-50/50',
    'pixel-border-yellow bg-white hover:bg-yellow-50/50',
    'pixel-border-emerald bg-white hover:bg-emerald-50/50',
  ]
  return colors[index % 4]!
}

onMounted(() => {
  fetchAgents()
})
</script>

<template>
  <div class="h-full flex flex-col gap-6">
    <!-- 标题行 -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 pixel-border-sky bg-sky-500 flex items-center justify-center text-white"
        >
          <PixelIcon name="users" size="md" />
        </div>
        <div>
          <h2 class="text-xl font-bold tracking-tight text-slate-800">角色配置</h2>
          <p class="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-0.5">
            Agent Configurations
          </p>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <PTooltip content="刷新列表">
          <button
            :disabled="isLoadingAgents"
            class="p-2.5 bg-white pixel-border-sky text-slate-400 hover:text-sky-500 transition-all disabled:opacity-50"
            @click="fetchAgents"
          >
            <div :class="{ 'animate-spin': isLoadingAgents }">
              <PixelIcon :name="isLoadingAgents ? 'loader' : 'refresh'" size="md" />
            </div>
          </button>
        </PTooltip>
        <div
          class="px-4 py-1.5 pixel-border-sky bg-sky-500/10 text-[10px] font-bold text-sky-500 uppercase tracking-widest"
        >
          {{ `Local: ${agentStore.agents.length}` }}
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-if="agentStore.agents.length === 0"
      class="flex-1 flex flex-col items-center justify-center text-slate-400 gap-6 bg-white/30 pixel-border-sky m-2"
    >
      <div class="p-8 bg-white pixel-border-sky">
        <PixelIcon name="users" class="w-16 h-16 text-sky-200" />
      </div>
      <div class="text-center">
        <h3 class="text-xl font-bold text-slate-600 mb-2">这里空空如也哦~</h3>
        <p class="text-sm text-slate-400 max-w-xs leading-relaxed">
          请检查
          <code class="bg-sky-50 px-1.5 py-0.5 pixel-border-sky text-sky-600 font-mono">
            backend/services/mdp/agents
          </code>
          目录
        </p>
      </div>
    </div>

    <!-- Agent 卡片网格 -->
    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pr-2 p-2"
    >
      <div
        v-for="(agent, idx) in agentStore.agents"
        :key="agent.id"
        class="p-8 transition-all duration-300 group relative overflow-hidden flex flex-col pixel-hover-lift press-effect"
        :class="getBorderClass(idx, agent.id === agentStore.activeAgentId, agent.isEnabled)"
      >
        <!-- 活跃指示角标 -->
        <div
          v-if="agent.id === agentStore.activeAgentId"
          class="absolute -right-6 -top-6 w-20 h-20 bg-sky-500 pixel-border-sky rotate-45 flex items-end justify-center pb-2 text-white shadow-lg z-20"
        >
          <PixelIcon name="star" class="w-4 h-4 animate-pixel-float" />
        </div>

        <!-- 头部：头像 + 名字 + 开关 -->
        <div class="flex items-start justify-between mb-8 relative z-10">
          <div class="flex items-center gap-5">
            <div
              class="w-16 h-16 pixel-border-sky flex items-center justify-center text-white font-black text-2xl transition-all duration-300 relative group-hover:scale-110 overflow-hidden"
              :class="
                agent.id === agentStore.activeAgentId
                  ? 'bg-sky-500'
                  : agent.isEnabled
                    ? 'bg-sky-400'
                    : 'bg-slate-300'
              "
            >
              <!-- 有头像时渲染图片 -->
              <img
                v-if="agent.avatarUrl"
                :src="`${getApiBaseUrl()}${agent.avatarUrl}`"
                :alt="agent.name"
                class="w-full h-full object-cover"
              />
              <!-- 无头像回退字母 -->
              <template v-else>
                {{ agent.name ? agent.name[0]!.toUpperCase() : '?' }}
              </template>
              <div
                v-if="agent.id === agentStore.activeAgentId"
                class="absolute -bottom-1 -right-1 w-6 h-6 bg-pink-500 pixel-border-sky flex items-center justify-center text-white"
              >
                <PixelIcon name="heart" class="w-3 h-3" />
              </div>
            </div>
            <div>
              <h3
                class="font-black text-xl leading-tight text-slate-700 group-hover:text-pink-500 transition-colors"
              >
                {{ agent.name }}
              </h3>
              <span
                class="text-[10px] text-sky-400 font-mono bg-sky-50 px-2 py-0.5 pixel-border-sky mt-1 inline-block"
              >
                {{ agent.id }}
              </span>
            </div>
          </div>

          <!-- 启用/禁用开关 -->
          <div class="relative pt-1 px-1">
            <input
              :id="'check-' + agent.id"
              type="checkbox"
              :checked="agent.isEnabled"
              class="peer sr-only"
              @change="toggleAgentEnabled(agent)"
            />
            <label
              :for="'check-' + agent.id"
              class="block w-14 h-7 pixel-border-sky cursor-pointer transition-all duration-300 relative"
              :class="agent.isEnabled ? 'bg-pink-500' : 'bg-slate-200'"
            >
              <div
                class="absolute top-1.5 w-4 h-4 bg-white pixel-border-sm transition-all duration-300"
                :class="agent.isEnabled ? 'left-[calc(100%-1.5rem)]' : 'left-1.5'"
              />
            </label>
          </div>
        </div>

        <!-- 描述 -->
        <p
          class="text-slate-500 text-xs leading-relaxed line-clamp-2 h-9 mb-6 relative z-10 px-1 font-medium"
        >
          {{ agent.description || '这只 AI 角色还在完善它的自我介绍哦~' }}
        </p>

        <!-- 底部状态 + 操作 -->
        <div
          class="flex items-center justify-between mt-auto pt-4 border-t border-sky-100/30 relative z-10"
        >
          <span
            class="text-[10px] uppercase font-bold tracking-wider flex items-center gap-2"
            :class="
              agent.id === agentStore.activeAgentId
                ? 'text-pink-500'
                : agent.isEnabled
                  ? 'text-slate-400'
                  : 'text-slate-300'
            "
          >
            <PixelIcon
              name="heart"
              :class="
                agent.id === agentStore.activeAgentId
                  ? 'text-pink-500 animate-pixel-bounce w-2.5 h-2.5'
                  : 'text-slate-300 w-2.5 h-2.5'
              "
            />
            {{
              agent.id === agentStore.activeAgentId
                ? '正在活跃中'
                : agent.isEnabled
                  ? '准备就绪'
                  : '休息中'
            }}
          </span>

          <!-- "召唤它！" 按钮 -->
          <button
            v-if="agent.isEnabled && agent.id !== agentStore.activeAgentId"
            class="text-[10px] px-5 py-2 pixel-btn-pink font-black uppercase tracking-widest"
            @click="setAsActive(agent)"
          >
            召唤它！
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
