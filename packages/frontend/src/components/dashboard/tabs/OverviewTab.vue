<script setup lang="ts">
import { getDisplayLocale } from '../../../i18n/index'

import { t as __t } from '../../../i18n/index'

/**
 * OverviewTab — 总览 Tab (像素风)
 *
 * 对标 v1 全部功能模块：
 * 1. 统计卡片 (3 列 variant+glow)
 * 2. 当前状态面板 (心情/氛围/想法 + Agent 切换)
 * 3. 全局互斥的智能陪伴与自主行动设置
 * 4. 最近对话时间线
 */
import { ref, computed, onMounted, watch } from 'vue'
import WeatherCard from '../../weather/WeatherCard.vue'
import TokenUsageCard from '../../usage/TokenUsageCard.vue'
import { useDashboardContext } from '../../../composables/dashboard'
import { PixelIcon, PCard } from '../../pixel'
import { systemApi } from '../../../api/modules/systemApi'
import { memoryApi } from '../../../api/modules/memoryApi'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import { threadsApi } from '../../../api/modules/threadsApi'
import ProactiveModePanel from '../ProactiveModePanel.vue'
import { useGateway } from '../../../composables/dashboard'
import { getApiBaseUrl } from '../../../api/transport'
import { logger } from '../../../lib/logger'
import { useAgentStore, usePetStateStore } from '../../../stores'

// ══════ DashboardContext 接入 ══════
const ctx = useDashboardContext()
const agentStore = useAgentStore()
const petStateStore = usePetStateStore()

const isLoading = ref(true)

// ══════ 统计数据 ══════
const stats = ref({
  totalMemories: 0,
  totalChats: 0,
  totalTasks: 0,
})

// ══════ Agent 管理 ══════
const agents = computed(() => agentStore.agents)
const activeAgent = computed(() => agentStore.currentAgent)
const isSwitchingAgent = ref(false)
const showAgentDropdown = ref(false)

async function switchAgent(id: string) {
  if (isSwitchingAgent.value || id === activeAgent.value?.id) return
  isSwitchingAgent.value = true
  try {
    await agentStore.switchAgent(id)
    ctx.activeAgentId.value = agentStore.activeAgentId
    await loadPetState()
  } catch (e) {
    logger.error('OverviewTab', __t('logs.frontend.settings', '切换 Agent 失败'), e)
  } finally {
    isSwitchingAgent.value = false
  }
}

/** 选择 Agent 并关闭下拉菜单 */
function selectAgent(id: string) {
  switchAgent(id)
  showAgentDropdown.value = false
}

// ══════ 宠物状态 (心情/氛围/想法) ══════
// 三状态唯一由 PetStateStore 管理；总览与 Pet3DView 读取同一响应式数据。
const petState = computed(() => petStateStore.stateFor(agentStore.activeAgentId))

/** 刷新当前所选会话的角色状态投影。 */
async function loadPetState() {
  await petStateStore.load(agentStore.activeAgentId)
}

// ── Gateway 实时推送：统一写入 PetStateStore ──
const { onPush: onOverviewPush } = useGateway()
onOverviewPush('state_update', (payload) => {
  const updateAgentId = payload.agentId
  const currentId = activeAgent.value?.id ?? ctx.activeAgentId.value
  if (typeof updateAgentId === 'string' && currentId && updateAgentId !== currentId) return
  petStateStore.applyPush(payload)
})

// ══════ 最近对话 ══════
const recentChats = ref<
  Array<{
    id: string
    summary: string
    agent: string
    time: string
    messageCount: number
    pairCount: number
  }>
>([])

// ══════ 系统健康 ══════
const systemHealth = ref({
  cpu: 0,
  memoryUsed: 0,
  memoryTotal: 0,
  sqliteSize: 0,
  triviumSize: 0,
  vectorCount: 0,
})

// ══════ 加载 ══════
async function loadOverview() {
  isLoading.value = true
  try {
    const [sysRes, memRes, taskRes, sessRes] = await Promise.allSettled([
      systemApi.info(),
      memoryApi.archive({ agentId: ctx.activeAgentId.value ?? 'pero', pageSize: 1 }),
      schedulerApi.reminders(),
      threadsApi.list({ pageSize: 5 }),
    ])
    await agentStore.fetchAgents()
    ctx.activeAgentId.value = agentStore.activeAgentId

    // 系统信息
    if (sysRes.status === 'fulfilled' && sysRes.value.data) {
      const info = sysRes.value.data
      systemHealth.value.memoryUsed = info.runtime.memoryUsage.rss
      systemHealth.value.memoryTotal = info.runtime.totalMemoryMB
      systemHealth.value.cpu = info.runtime.cpuPercent
      systemHealth.value.sqliteSize = info.storage.sqliteSizeMB
      systemHealth.value.triviumSize = info.storage.triviumSizeMB
      systemHealth.value.vectorCount = info.storage.triviumNodeCount
    }

    // EventNote 数量用于顶部核心记忆统计，TDB 节点总数由系统信息接口提供。
    if (memRes.status === 'fulfilled' && memRes.value.data) {
      stats.value.totalMemories = memRes.value.data.total
    }

    // 待触发提醒统计 (用户通过 Agent 创建的 reminder/topic/reaction)
    if (taskRes.status === 'fulfilled' && taskRes.value.data) {
      stats.value.totalTasks = taskRes.value.data.total
    }

    // 最近对话 (Thread 列表)
    // totalChats 统计真实消息总数（各 Thread messageCount 之和），而非 Thread 数
    if (sessRes.status === 'fulfilled' && sessRes.value.data) {
      const threadItems = sessRes.value.data.items
      stats.value.totalChats = threadItems.reduce((sum, t) => sum + (t.messageCount ?? 0), 0)
      recentChats.value = threadItems.map((thread) => ({
        id: thread.id,
        summary: thread.title || '未命名会话',
        agent: thread.agentId || 'Pero',
        time: new Date(thread.lastMessageAt || thread.updatedAt || thread.createdAt).toLocaleString(
          getDisplayLocale(),
          {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          },
        ),
        messageCount: thread.messageCount ?? 0,
        pairCount: thread.pairCount ?? 0,
      }))
    }

    // 加载当前角色状态
    await loadPetState()
  } catch (err) {
    logger.error('OverviewTab', __t('logs.frontend.settings', '加载总览数据失败'), err)
  } finally {
    isLoading.value = false
  }
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => loadOverview(),
)

onMounted(loadOverview)
</script>

<template>
  <div class="overview-tab p-6 space-y-6 overflow-y-auto h-full custom-scrollbar">
    <!-- 加载中 -->
    <div
      v-if="isLoading"
      class="flex flex-col items-center justify-center gap-3 h-72 text-slate-400 font-bold"
    >
      <PixelIcon name="refresh" size="lg" animation="spin" />
      <span class="font-pixel text-sm">{{ __t('ui.settings', '加载中...') }}</span>
    </div>

    <template v-else>
      <div class="overview-utilities">
        <WeatherCard />
        <TokenUsageCard />
      </div>
      <!-- ═══ 统计卡片 (3 列彩色) ═══ -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- 核心记忆 -->
        <PCard pixel hoverable class="group overview-stat overview-stat--purple">
          <div class="flex items-center gap-4 relative">
            <div
              class="p-4 bg-purple-100 pixel-border-pink text-purple-500 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500"
            >
              <PixelIcon name="brain" size="xl" animation="bounce" />
            </div>
            <div class="relative z-10">
              <h3 class="text-base font-bold text-slate-600 flex items-center gap-1.5">
                {{ __t('ui.settings', '核心记忆') }}
                <span class="text-xs text-purple-400 font-mono">Core</span>
              </h3>
              <div class="text-3xl font-black text-slate-800">
                {{ stats.totalMemories }}
              </div>
            </div>
            <!-- 装饰元素 -->
            <div
              class="absolute -right-4 -bottom-4 text-purple-200/20 group-hover:opacity-10 group-hover:scale-150 transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="paw" size="3xl" />
            </div>
          </div>
        </PCard>

        <!-- 近期对话 -->
        <PCard pixel hoverable class="group overview-stat overview-stat--sky">
          <div class="flex items-center gap-4 relative">
            <div
              class="p-4 bg-sky-100 pixel-border-sky text-sky-500 group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-500"
            >
              <PixelIcon name="chat" size="xl" animation="bounce" />
            </div>
            <div class="relative z-10">
              <h3 class="text-base font-bold text-slate-600 flex items-center gap-1.5">
                {{ __t('ui.settings', '近期对话') }}
                <span class="text-xs text-sky-400 font-mono">Logs</span>
              </h3>
              <div class="text-3xl font-black text-slate-800">
                {{ stats.totalChats }}
              </div>
            </div>
            <!-- 装饰元素 -->
            <div
              class="absolute -right-4 -bottom-4 text-sky-200/20 group-hover:opacity-10 group-hover:scale-150 transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="thought" size="3xl" />
            </div>
          </div>
        </PCard>

        <!-- 待办任务 -->
        <PCard pixel hoverable class="group overview-stat overview-stat--orange">
          <div class="flex items-center gap-4 relative">
            <div
              class="p-4 bg-orange-100 pixel-border-orange text-orange-500 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500"
            >
              <PixelIcon name="flash" size="xl" animation="bounce" />
            </div>
            <div class="relative z-10">
              <h3 class="text-base font-bold text-slate-600 flex items-center gap-1.5">
                {{ __t('ui.settings', '任务中心') }}
                <span class="text-xs text-orange-400 font-mono">Reminders</span>
              </h3>
              <div class="text-3xl font-black text-slate-800">
                {{ stats.totalTasks }}
              </div>
            </div>
            <!-- 装饰元素 -->
            <div
              class="absolute -right-4 -bottom-4 text-orange-200/20 group-hover:opacity-10 group-hover:scale-150 transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="sparkle" size="3xl" />
            </div>
          </div>
        </PCard>
      </div>

      <!-- ═══ 当前状态面板 ═══ -->
      <PCard pixel overflow-visible class="z-30">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-bold text-lg text-slate-800 flex items-center gap-2">
              {{ __t('ui.settings', '当前状态') }}
              <span class="text-xs font-normal text-slate-400 font-mono">Status</span>
            </span>
            <!-- Agent 选择器 -->
            <div class="flex flex-col gap-1.5 min-w-[160px]">
              <label
                class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>
                {{ __t('ui.settings', '当前角色') }}
                <span class="opacity-50 font-normal">Agent</span>
              </label>
              <div class="relative group/agent">
                <button
                  class="agent-trigger w-full flex items-center justify-between px-4 py-2.5 pixel-border-sky text-sm transition-all press-effect group/btn"
                  :class="isSwitchingAgent ? 'opacity-50 cursor-not-allowed' : ''"
                  @click="showAgentDropdown = !showAgentDropdown"
                >
                  <div class="flex items-center gap-2.5">
                    <div
                      class="w-6 h-6 pixel-border-sky overflow-hidden flex items-center justify-center shrink-0"
                      :class="activeAgent?.avatarUrl ? 'bg-sky-50' : 'bg-sky-100'"
                    >
                      <img
                        v-if="activeAgent?.avatarUrl"
                        :src="`${getApiBaseUrl()}${activeAgent.avatarUrl}`"
                        :alt="activeAgent?.name"
                        class="w-full h-full object-cover group-hover/btn:scale-110 transition-transform"
                      />
                      <PixelIcon
                        v-else
                        name="paw"
                        size="xs"
                        class="text-sky-400 group-hover/btn:scale-110 transition-transform"
                      />
                    </div>
                    <span class="text-sky-600 font-bold">
                      {{ activeAgent?.name || __t('ui.settings', '未知') }}
                      <span
                        class="opacity-0 group-hover/btn:opacity-100 transition-opacity duration-300 ml-1 inline-block"
                      >
                        <PixelIcon name="sparkle" size="xs" />
                      </span>
                    </span>
                  </div>
                  <PixelIcon
                    name="chevron-down"
                    size="xs"
                    class="text-slate-400 transition-transform duration-500"
                    :class="showAgentDropdown ? 'rotate-180' : ''"
                  />
                </button>

                <!-- 下拉菜单 -->
                <div
                  v-if="showAgentDropdown"
                  class="agent-dropdown absolute right-0 top-full mt-2 w-full py-2 backdrop-blur-xl z-50"
                >
                  <div class="px-3 py-1.5 mb-1 border-b border-sky-50">
                    <span
                      class="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1"
                    >
                      {{ __t('ui.settings', '切换角色') }}
                      <PixelIcon name="sparkle" size="xs" class="animate-bounce" />
                    </span>
                  </div>
                  <button
                    v-for="agent in agents"
                    :key="agent.id"
                    class="w-full text-left px-4 py-2.5 text-sm hover:bg-sky-50 transition-all flex items-center justify-between group/item"
                    :class="{
                      'text-sky-600 font-bold bg-sky-50/50': agent.id === activeAgent?.id,
                      'text-slate-500': agent.id !== activeAgent?.id,
                      'opacity-50 cursor-not-allowed': !agent.isEnabled,
                    }"
                    :disabled="agent.id === activeAgent?.id || !agent.isEnabled"
                    @click="selectAgent(agent.id)"
                  >
                    <div class="flex items-center gap-2.5">
                      <div
                        class="w-5 h-5 pixel-border-sky overflow-hidden flex items-center justify-center shrink-0"
                        :class="[
                          agent.id === activeAgent?.id ? 'border-sky-400' : 'border-sky-100',
                          agent.avatarUrl ? 'bg-sky-50' : 'bg-slate-100',
                        ]"
                      >
                        <img
                          v-if="agent.avatarUrl"
                          :src="`${getApiBaseUrl()}${agent.avatarUrl}`"
                          :alt="agent.name"
                          class="w-full h-full object-cover group-hover/item:scale-110 transition-transform"
                        />
                        <PixelIcon
                          v-else
                          name="paw"
                          size="xs"
                          class="text-slate-400 group-hover/item:scale-110 transition-transform"
                        />
                      </div>
                      <span :class="{ 'font-bold text-sky-600': agent.id === activeAgent?.id }">
                        {{ agent.name }}
                      </span>
                    </div>
                    <span
                      v-if="!agent.isEnabled"
                      class="text-[10px] text-slate-400 font-bold px-1.5 py-0.5 bg-sky-50"
                    >
                      DISABLED
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- 心情 / 氛围 / 想法 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div
            class="status-card pixel-border-sky p-5 transition-all hover:pixel-border-pink group relative"
          >
            <div
              class="text-sm text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
            >
              {{ __t('ui.settings', '心情') }}
              <span class="text-[10px] text-sky-400/60 font-mono">Mood</span>
              <span
                class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:rotate-12 text-sky-500"
              >
                <PixelIcon name="paw" size="xs" />
              </span>
            </div>
            <div
              class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
            >
              {{ petState.mood }}
            </div>
            <div class="h-1.5 bg-sky-100/50 overflow-hidden relative z-10">
              <div
                class="status-progress h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000"
                style="width: 80%"
              ></div>
            </div>
            <!-- 装饰 -->
            <div
              class="absolute -right-2 -bottom-2 opacity-[0.05] group-hover:opacity-[0.1] transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="paw" size="3xl" />
            </div>
          </div>

          <div
            class="status-card pixel-border-sky p-5 transition-all hover:pixel-border-pink group relative"
          >
            <div
              class="text-sm text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
            >
              {{ __t('ui.settings', '氛围') }}
              <span class="text-[10px] text-sky-400/60 font-mono">Vibe</span>
              <span
                class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:-rotate-12 text-sky-500"
              >
                <PixelIcon name="sparkle" size="xs" />
              </span>
            </div>
            <div
              class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
            >
              {{ petState.vibe }}
            </div>
            <div class="h-1.5 bg-sky-100/50 overflow-hidden relative z-10">
              <div
                class="status-progress h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000"
                style="width: 60%"
              ></div>
            </div>
            <div
              class="absolute -right-2 -bottom-2 opacity-[0.05] group-hover:opacity-[0.1] transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="thought" size="3xl" />
            </div>
          </div>

          <div
            class="status-card pixel-border-sky p-5 transition-all hover:pixel-border-pink group relative"
          >
            <div
              class="text-sm text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
            >
              {{ __t('ui.settings', '想法') }}
              <span class="text-[10px] text-sky-400/60 font-mono">Mind</span>
              <span
                class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:rotate-12 text-sky-500"
              >
                <PixelIcon name="thought" size="xs" />
              </span>
            </div>
            <div
              class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
            >
              {{ petState.mind || __t('ui.settings', '在发呆...') }}
            </div>
            <div class="h-1.5 bg-sky-100/50 overflow-hidden relative z-10">
              <div
                class="status-progress h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000"
                style="width: 90%"
              ></div>
            </div>
            <div
              class="absolute -right-2 -bottom-2 opacity-[0.05] group-hover:opacity-[0.1] transition-all duration-700 pointer-events-none"
            >
              <PixelIcon name="sparkle" size="3xl" />
            </div>
          </div>
        </div>
      </PCard>

      <ProactiveModePanel />

      <!-- ═══ 最近对话 + 系统健康 ═══ -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 最近对话 -->
        <PCard pixel>
          <h3
            class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 font-pixel"
          >
            <PixelIcon name="chat" size="xs" />
            {{ __t('ui.settings', '最近对话') }}
          </h3>
          <div class="flex flex-col">
            <div
              v-for="chat in recentChats"
              :key="chat.id"
              class="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-b-0"
            >
              <div class="w-1.5 h-1.5 bg-sky-400 mt-1.5 flex-shrink-0" />
              <div class="min-w-0">
                <span class="text-sm font-bold text-slate-700 block truncate">
                  {{ chat.summary }}
                </span>
                <div class="flex gap-2.5 mt-0.5 text-[10px] text-slate-400 font-bold font-pixel">
                  <span>{{ chat.agent }}</span>
                  <span>{{ chat.pairCount }} {{ __t('ui.settings', '轮') }}</span>
                  <span>{{ chat.messageCount }} {{ __t('ui.settings', '条') }}</span>
                  <span>{{ chat.time }}</span>
                </div>
              </div>
            </div>
          </div>
        </PCard>

        <!-- 系统健康 -->
        <PCard pixel>
          <h3
            class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 font-pixel"
          >
            <PixelIcon name="desktop" size="xs" />
            {{ __t('ui.settings', '系统健康') }}
          </h3>
          <div class="flex flex-col gap-2.5">
            <!-- CPU -->
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold text-slate-400 min-w-8 font-pixel">CPU</span>
              <div class="flex-1 h-1.5 bg-slate-100">
                <div
                  class="h-full transition-all duration-500"
                  :class="
                    systemHealth.cpu > 80
                      ? 'bg-rose-400'
                      : systemHealth.cpu > 50
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  "
                  :style="{ width: systemHealth.cpu + '%' }"
                />
              </div>
              <span class="text-[10px] font-bold text-slate-500 min-w-12 text-right font-pixel">
                {{ systemHealth.cpu }}%
              </span>
            </div>
            <!-- 内存 -->
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold text-slate-400 min-w-8 font-pixel">MEM</span>
              <div class="flex-1 h-1.5 bg-slate-100">
                <div
                  class="h-full bg-pink-face transition-all duration-500"
                  :style="{
                    width:
                      systemHealth.memoryTotal > 0
                        ? (systemHealth.memoryUsed / systemHealth.memoryTotal) * 100 + '%'
                        : '0%',
                  }"
                />
              </div>
              <span class="text-[10px] font-bold text-slate-500 min-w-12 text-right font-pixel">
                {{ systemHealth.memoryUsed }}MB
              </span>
            </div>
            <!-- SQLite -->
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold text-slate-400 min-w-8 font-pixel">SQL</span>
              <span class="text-[10px] font-bold text-slate-500 ml-auto font-pixel">
                {{ systemHealth.sqliteSize }} MB
              </span>
            </div>
            <!-- TriviumDB -->
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold text-slate-400 min-w-8 font-pixel">TDB</span>
              <span class="text-[10px] font-bold text-slate-500 ml-auto font-pixel">
                {{ systemHealth.triviumSize }} MB
              </span>
            </div>
            <!-- 向量 -->
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-bold text-slate-400 min-w-8 font-pixel">VEC</span>
              <span class="text-[10px] font-bold text-slate-500 ml-auto font-pixel">
                {{ systemHealth.vectorCount }} {{ __t('ui.settings', '条') }}
              </span>
            </div>
          </div>
        </PCard>
      </div>
    </template>
  </div>
</template>
