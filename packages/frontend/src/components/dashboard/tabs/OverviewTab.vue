<script setup lang="ts">
/**
 * OverviewTab — 总览 Tab (像素风)
 *
 * 对标 v1 全部功能模块：
 * 1. 统计卡片 (3 列 variant+glow)
 * 2. 当前状态面板 (心情/氛围/想法 + Agent 切换)
 * 3. 陪伴模式开关
 * 4. 记忆系统配置 (三模式 Slider)
 * 5. 最近对话时间线
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useDashboardContext } from '../../../composables/dashboard'
import { PixelIcon, PCard, PButton, PSwitch, PSlider } from '../../pixel'
import { systemApi } from '../../../api/modules/systemApi'
import { memoryApi } from '../../../api/modules/memoryApi'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import { threadsApi } from '../../../api/modules/threadsApi'
import { agentApi } from '../../../api/modules/agentApi'
import { maintenanceApi, type MemoryRuntimeConfig } from '../../../api/modules/maintenanceApi'
import { useGateway } from '../../../composables/dashboard'
import { getApiBaseUrl } from '../../../api/transport'
import { logger } from '../../../lib/logger'
import { useNotificationStore, useAgentStore, usePetStateStore } from '../../../stores'

// ══════ DashboardContext 接入 ══════
const ctx = useDashboardContext()
const notif = useNotificationStore()
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
    await Promise.allSettled([loadPetState(), loadCompanionState()])
  } catch (e) {
    logger.error('OverviewTab', '切换 Agent 失败', e)
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

/** 从 pet_states 表刷新当前角色的权威状态快照。 */
async function loadPetState() {
  await petStateStore.load(agentStore.activeAgentId)
}

// ── Gateway 实时推送：统一写入 PetStateStore ──
const { onPush: onOverviewPush } = useGateway()
onOverviewPush('state_update', (payload) => {
  const updateAgentId = payload.agentId
  const currentId = activeAgent.value?.id ?? ctx.activeAgentId.value
  if (typeof updateAgentId === 'string' && currentId && updateAgentId !== currentId) return
  petStateStore.apply(currentId, {
    mood: typeof payload.mood === 'string' ? payload.mood : undefined,
    vibe: typeof payload.vibe === 'string' ? payload.vibe : undefined,
    mind: typeof payload.mind === 'string' ? payload.mind : undefined,
  })
  void petStateStore.load(currentId)
})

// ══════ 陪伴模式 ══════
const isCompanionEnabled = ref(false)
const isTogglingCompanion = ref(false)

/** 从后端陪伴调度器读取当前角色的真实运行状态。 */
async function loadCompanionState() {
  const agentId = agentStore.activeAgentId
  if (!agentId) {
    isCompanionEnabled.value = false
    return
  }
  try {
    const response = await agentApi.getCompanionState(agentId)
    isCompanionEnabled.value = response.data?.enabled ?? false
  } catch (error) {
    isCompanionEnabled.value = false
    logger.error('OverviewTab', '读取陪伴模式状态失败', error)
  }
}

/** 启用或关闭当前角色的主动陪伴调度，以后端返回状态为准。 */
async function toggleCompanion(enabled: boolean) {
  if (isTogglingCompanion.value) return
  const agentId = agentStore.activeAgentId
  if (!agentId) return
  isTogglingCompanion.value = true
  try {
    const response = await agentApi.setCompanionState(agentId, enabled)
    isCompanionEnabled.value = response.data?.enabled ?? false
    notif.toast(isCompanionEnabled.value ? '陪伴模式已启用' : '陪伴模式已关闭', {
      type: 'success',
      title: '陪伴模式',
    })
  } catch (error) {
    logger.error('OverviewTab', '切换陪伴模式失败', error)
    notif.toast('切换失败，请稍后重试', { type: 'error', title: '陪伴模式' })
    await loadCompanionState()
  } finally {
    isTogglingCompanion.value = false
  }
}

// ══════ 记忆配置 ══════
type MemoryChannel = 'desktop' | 'group'
const activeMemoryTab = ref<MemoryChannel>('desktop')
const isSavingMemoryConfig = ref(false)

const memoryConfig = ref<MemoryRuntimeConfig>({
  channels: {
    desktop: { contextPairs: 20, retrievalLimit: 8 },
    group: { contextPairs: 20, retrievalLimit: 3 },
  },
  scorerBatchSize: 8,
  retrievalMinScore: 0.3,
})

/** 从专用接口读取经过后端校验的运行配置。 */
async function loadMemoryConfig() {
  try {
    const response = await maintenanceApi.getMemoryConfig()
    if (response.data) memoryConfig.value = response.data
  } catch (error) {
    logger.error('OverviewTab', '读取记忆运行配置失败', error)
  }
}

async function saveMemoryConfig() {
  isSavingMemoryConfig.value = true
  try {
    const response = await maintenanceApi.setMemoryConfig(memoryConfig.value)
    if (response.data) memoryConfig.value = response.data
    notif.toast('记忆配置已保存并生效', { type: 'success', title: '记忆配置' })
  } catch (error) {
    logger.error('OverviewTab', '保存记忆配置失败', error)
    notif.toast('保存失败，请稍后重试', { type: 'error', title: '记忆配置' })
  } finally {
    isSavingMemoryConfig.value = false
  }
}

// ══════ 最近对话 ══════
const recentChats = ref<
  Array<{ id: number; summary: string; agent: string; time: string; tokenCount: number }>
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
      memoryApi.list({ page: 1, pageSize: 1 }),
      schedulerApi.reminders(),
      threadsApi.list({ pageSize: 5 }),
    ])
    await agentStore.fetchAgents()
    ctx.activeAgentId.value = agentStore.activeAgentId

    // 系统信息
    if (sysRes.status === 'fulfilled' && sysRes.value.data) {
      const info = sysRes.value.data
      systemHealth.value.memoryUsed = info.runtime.memoryUsage.rss || 0
      systemHealth.value.memoryTotal = info.runtime.totalMemoryMB || 0
      systemHealth.value.cpu = info.runtime.cpuPercent || 0
      if (info.storage) {
        systemHealth.value.sqliteSize = info.storage.sqliteSizeMB || 0
        systemHealth.value.triviumSize = info.storage.triviumSizeMB || 0
      }
    }

    // 记忆统计
    if (memRes.status === 'fulfilled' && memRes.value.data) {
      stats.value.totalMemories = memRes.value.data.total
      systemHealth.value.vectorCount = memRes.value.data.total
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
      recentChats.value = threadItems.map((s, i) => ({
        id: i,
        summary: s.title || '未命名会话',
        agent: s.agentId || 'Pero',
        time: new Date(s.updatedAt || s.createdAt).toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        tokenCount: 0,
      }))
    }

    // 加载宠物状态和记忆配置
    await Promise.allSettled([loadPetState(), loadCompanionState(), loadMemoryConfig()])
  } catch (err) {
    logger.error('OverviewTab', '加载总览数据失败', err)
  } finally {
    isLoading.value = false
  }
}

function formatTokens(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
}

// 记忆 Tab 列表
const memoryTabs = [
  { id: 'desktop' as const, label: '桌面对话', icon: 'desktop' },
  { id: 'group' as const, label: '据点群聊', icon: 'chat' },
]

const scorerOptions = [
  { value: 4 as const, label: '积极', help: '每 4 轮整理一次' },
  { value: 8 as const, label: '均衡', help: '每 8 轮整理一次' },
  { value: 16 as const, label: '节省', help: '每 16 轮整理一次' },
]
const retrievalOptions = [
  { value: 0.2 as const, label: '广泛联想', help: '允许更多弱相关记忆参与回答' },
  { value: 0.3 as const, label: '均衡', help: '兼顾召回数量与相关性' },
  { value: 0.45 as const, label: '精准', help: '只注入高度相关的记忆' },
]

// ══════ 故事导入 ══════
const showImportStory = ref(false)

/** 统一故事导入完成后刷新总览统计。 */
function handleStoryImported(imported: number): void {
  stats.value.totalMemories += imported
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
      <span class="font-pixel text-sm">加载中...</span>
    </div>

    <template v-else>
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
                核心记忆
                <span class="text-xs text-purple-400 font-mono">Core</span>
              </h3>
              <div class="text-3xl font-black text-slate-800">
                {{ stats.totalMemories }}
              </div>
              <button
                class="mt-1.5 text-xs text-purple-500 hover:text-purple-600 font-bold flex items-center gap-1 transition-colors group/btn"
                @click="showImportStory = true"
              >
                <PixelIcon
                  name="download"
                  size="xs"
                  class="rotate-180 group-hover/btn:-translate-y-0.5 transition-transform"
                />
                导入故事
                <PixelIcon name="thought" size="xs" class="ml-0.5" />
              </button>
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
                近期对话
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
                任务中心
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
              当前状态
              <span class="text-xs font-normal text-slate-400 font-mono">Status</span>
            </span>
            <!-- Agent 选择器 -->
            <div class="flex flex-col gap-1.5 min-w-[160px]">
              <label
                class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>
                当前角色
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
                      {{ activeAgent?.name || '未知' }}
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
                      切换角色
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
              心情
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
              氛围
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
              想法
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
              {{ petState.mind || '在发呆...' }}
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

      <!-- ═══ 陪伴模式 ═══ -->
      <div class="space-y-4">
        <PCard pixel class="group/switch">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div class="text-2xl group-hover/switch:scale-110 transition-transform duration-300">
                <PixelIcon name="eye" size="lg" />
              </div>
              <div>
                <div class="font-bold text-slate-800 flex items-center gap-2 text-lg">
                  智能陪伴模式
                  <span class="text-xs text-sky-400/60 font-mono font-normal">Companion</span>
                </div>
                <div class="text-sm text-slate-500 mt-1 leading-relaxed">
                  开启后，{{ activeAgent?.name || '助手' }} 会在你空闲时通过陪伴频道主动发起互动。
                </div>
              </div>
            </div>
            <PSwitch
              :model-value="isCompanionEnabled"
              :loading="isTogglingCompanion"
              @update:model-value="toggleCompanion"
            />
          </div>
        </PCard>
      </div>

      <!-- ═══ 记忆系统配置 ═══ -->
      <PCard pixel>
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="text-2xl text-sky-500">
                <PixelIcon name="brain" size="lg" />
              </div>
              <div>
                <div class="font-bold text-slate-800 flex items-center gap-2 text-lg">
                  记忆系统配置
                  <span class="text-xs font-normal text-slate-400 font-mono">Memory System</span>
                  <span class="text-xs animate-pulse">
                    <PixelIcon name="sparkle" size="xs" />
                  </span>
                </div>
                <div class="text-sm text-slate-500 font-medium flex items-center gap-1.5">
                  配置桌面对话、轻量陪伴与据点群聊的上下文和长期记忆预算
                  <PixelIcon name="paw" size="xs" />
                </div>
              </div>
            </div>
            <PButton
              variant="primary"
              size="sm"
              :loading="isSavingMemoryConfig"
              class="shadow-lg shadow-sky-300/30"
              @click="saveMemoryConfig"
            >
              保存配置
            </PButton>
          </div>
        </template>

        <!-- 模式切换 Tab -->
        <div class="border-b border-sky-100 flex gap-8 mb-8 overflow-x-auto pb-1 custom-scrollbar">
          <button
            v-for="tab in memoryTabs"
            :key="tab.id"
            class="pb-4 text-sm font-bold transition-all relative active:scale-95 flex items-center gap-2 group/tab"
            :class="
              activeMemoryTab === tab.id ? 'text-sky-600' : 'text-slate-500 hover:text-sky-500'
            "
            @click="activeMemoryTab = tab.id"
          >
            <span class="relative z-10 flex items-center gap-2">
              <span class="group-hover/tab:scale-125 transition-transform duration-300">
                <PixelIcon :name="tab.icon" size="sm" />
              </span>
              {{ tab.label }}
              <span v-if="activeMemoryTab === tab.id" class="animate-bounce">
                <PixelIcon name="sparkle" size="xs" />
              </span>
            </span>
            <div
              v-if="activeMemoryTab === tab.id"
              class="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 to-sky-300 shadow-[0_0_12px_rgba(56,189,248,0.3)]"
            ></div>
          </button>
        </div>

        <!-- Slider 配置区 -->
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <!-- 短期记忆上下文 -->
            <div
              class="memory-config-block p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-base font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  短期记忆上下文
                  <span class="text-[11px] text-sky-400 font-bold font-mono">Context</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 text-xs font-mono font-bold border border-sky-200"
                >
                  {{ memoryConfig.channels[activeMemoryTab].contextPairs }} 轮
                </span>
              </div>
              <PSlider
                v-model="memoryConfig.channels[activeMemoryTab].contextPairs"
                :min="4"
                :max="activeMemoryTab === 'group' ? 60 : 100"
              />
              <div class="memory-config-note mt-4 text-xs font-medium flex items-start gap-2 p-3">
                <span class="text-base group-hover/mconfig:rotate-12 transition-transform">
                  <PixelIcon name="thought" size="sm" />
                </span>
                <p class="leading-relaxed">
                  最近完整对话轮数。桌面与陪伴的一轮包含一次提问和一次回复；据点群聊的一轮包含一条发言及其关联回复。
                  <PixelIcon name="sparkle" size="xs" />
                </p>
              </div>
            </div>

            <!-- RAG 召回数量 -->
            <div
              class="memory-config-block p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-base font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  RAG 召回数量
                  <span class="text-[11px] text-slate-400 font-bold">Retrieval</span>
                </label>
                <span class="px-2 py-0.5 bg-sky-500/10 text-sky-400 text-xs font-mono font-bold">
                  {{ memoryConfig.channels[activeMemoryTab].retrievalLimit }}
                </span>
              </div>
              <PSlider
                v-model="memoryConfig.channels[activeMemoryTab].retrievalLimit"
                :min="0"
                :max="30"
              />
              <div
                class="mt-4 text-xs text-slate-500 flex items-start gap-2 bg-sky-50/50 p-3 border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:scale-110 transition-transform">
                  <PixelIcon name="book" size="sm" />
                </span>
                <p class="leading-relaxed">
                  从长期记忆库中检索的相关记忆条数。
                  <PixelIcon name="paw" size="xs" />
                </p>
              </div>
            </div>
          </div>

          <!-- 全局记忆策略 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div class="memory-config-block p-6 pixel-border-sky">
              <div class="mb-4">
                <b class="text-base text-slate-700">记忆整理频率</b>
                <p class="text-xs text-slate-500 mt-1">控制对话积累多少轮后提炼长期记忆。</p>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="option in scorerOptions"
                  :key="option.value"
                  class="p-3 border text-left transition-colors"
                  :class="
                    memoryConfig.scorerBatchSize === option.value
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-slate-200 text-slate-500 hover:border-sky-300'
                  "
                  @click="memoryConfig.scorerBatchSize = option.value"
                >
                  <b class="block text-sm">{{ option.label }}</b>
                  <small class="block mt-1 text-[10px]">{{ option.help }}</small>
                </button>
              </div>
            </div>
            <div class="memory-config-block p-6 pixel-border-sky">
              <div class="mb-4">
                <b class="text-base text-slate-700">召回精度</b>
                <p class="text-xs text-slate-500 mt-1">控制长期记忆进入上下文所需的最低相关度。</p>
              </div>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="option in retrievalOptions"
                  :key="option.value"
                  class="p-3 border text-left transition-colors"
                  :class="
                    memoryConfig.retrievalMinScore === option.value
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-slate-200 text-slate-500 hover:border-sky-300'
                  "
                  @click="memoryConfig.retrievalMinScore = option.value"
                >
                  <b class="block text-sm">{{ option.label }}</b>
                  <small class="block mt-1 text-[10px]">{{ option.help }}</small>
                </button>
              </div>
            </div>
          </div>
        </div>
      </PCard>

      <!-- ═══ 最近对话 + 系统健康 ═══ -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 最近对话 -->
        <PCard pixel>
          <h3
            class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 font-pixel"
          >
            <PixelIcon name="chat" size="xs" />
            最近对话
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
                  <span>{{ formatTokens(chat.tokenCount) }} msgs</span>
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
            系统健康
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
                {{ systemHealth.vectorCount }} 条
              </span>
            </div>
          </div>
        </PCard>
      </div>
    </template>

    <!-- 共享故事导入弹窗：与核心记忆页使用同一表现和后端导入链路 -->
    <StoryImportDialog
      v-model="showImportStory"
      :agent-id="activeAgent?.id ?? 'pero'"
      @imported="handleStoryImported"
    />
  </div>
</template>

<style scoped>
/* 页面语义色统一承接亮暗主题，保留语义色作为强调。 */
.overview-tab {
  color: var(--ui-text-primary);
}
.overview-tab :is(.text-slate-800, .text-slate-700, .text-slate-600) {
  color: var(--ui-text-primary);
}
.overview-tab :is(.text-slate-500, .text-slate-400) {
  color: var(--ui-text-secondary);
}
.overview-stat {
  border-left: 4px solid var(--stat-accent);
  background: var(--dash-panel-bg);
}
.overview-stat--purple {
  --stat-accent: var(--ui-accent-purple);
}
.overview-stat--sky {
  --stat-accent: var(--ui-accent-sky);
}
.overview-stat--orange {
  --stat-accent: var(--ui-warning);
}
.agent-trigger,
.status-card,
.memory-config-block {
  background: var(--dash-panel-soft);
  color: var(--ui-text-primary);
}
.agent-trigger:hover,
.status-card:hover {
  background: var(--ui-bg-hover);
}
.status-card:hover .status-progress {
  box-shadow: var(--ui-glow-sky);
}
.agent-dropdown {
  border: 1px solid var(--dash-panel-border);
  background: var(--dash-panel-elevated);
  box-shadow: var(--ui-shadow-lg);
}
.memory-config-note {
  border: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-hover);
  color: var(--ui-text-secondary);
}
.story-copy {
  color: var(--ui-text-secondary);
}
.story-input {
  border-color: var(--dash-input-border);
  background: var(--dash-input-bg);
  color: var(--ui-text-primary);
}
.story-input:focus {
  border-color: var(--ui-accent-sky);
}
.story-input::placeholder {
  color: var(--ui-text-disabled);
}

/* 像素风滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ui-scrollbar-thumb);
  border-radius: 0;
}
</style>
