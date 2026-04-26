<script setup lang="ts">
/**
 * OverviewTab — 总览 Tab (像素风)
 *
 * 对标 v1 全部功能模块：
 * 1. 统计卡片 (3 列 variant+glow)
 * 2. 当前状态面板 (心情/氛围/想法 + Agent 切换)
 * 3. 功能开关组 (轻量/陪伴模式)
 * 4. 记忆系统配置 (三模式 Slider)
 * 5. 最近对话时间线
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useDashboardContext } from '../../../composables/dashboard'
import { PixelIcon, PCard, PButton, PSwitch, PSlider, PDialog } from '../../pixel'
import { systemApi } from '../../../api/modules/systemApi'
import { memoryApi } from '../../../api/modules/memoryApi'
import { schedulerApi } from '../../../api/modules/schedulerApi'
import { sessionsApi } from '../../../api/modules/sessionsApi'
import { agentApi, type AgentListItem } from '../../../api/modules/agentApi'
import { chatApi } from '../../../api/modules/chatApi'
import { configApi } from '../../../api/modules/configApi'
import { useGateway } from '../../../composables/dashboard'
import { getApiBaseUrl } from '../../../api/transport'
import { logger } from '../../../lib/logger'

// ══════ DashboardContext 接入 ══════
const ctx = useDashboardContext()

const isLoading = ref(true)

// ══════ 统计数据 ══════
const stats = ref({
  totalMemories: 0,
  totalChats: 0,
  totalTasks: 0,
})

// ══════ Agent 管理 ══════
const agents = ref<AgentListItem[]>([])
const activeAgent = ref<AgentListItem | null>(null)
const isSwitchingAgent = ref(false)
const showAgentDropdown = ref(false)

async function switchAgent(id: string) {
  if (isSwitchingAgent.value || id === activeAgent.value?.id) return
  isSwitchingAgent.value = true
  try {
    await agentApi.setActive(id)
    activeAgent.value = agents.value.find((a) => a.id === id) ?? null
    // 同步到全局 Context
    ctx.activeAgentId.value = id
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
const petState = ref({
  mood: 'neutral',
  vibe: 'idle',
  mind: '...',
})

// ── 中文标签映射 (与 Pet3D usePetState 保持一致) ──
const moodLabels: Record<string, string> = {
  happy: '开心',
  neutral: '平静',
  sleepy: '困了',
  excited: '兴奋',
  curious: '好奇',
}
const vibeLabels: Record<string, string> = {
  active: '活跃',
  relaxed: '轻松',
  tired: '疲惫',
  idle: '闲置',
}

/** 从与 Pet3D 一致的 KV key 加载状态（pet.mood / pet.energy / pet.name） */
async function loadPetState() {
  try {
    const res = await configApi.batch(['pet.mood', 'pet.energy', 'pet.mind', 'pet.name'])
    if (res.data) {
      petState.value.mood = (res.data['pet.mood'] as string) || 'neutral'
      // 能量值转换为氛围 key
      const energy = Number(res.data['pet.energy']) || 50
      petState.value.vibe = energy >= 70 ? 'active' : energy >= 30 ? 'relaxed' : 'tired'
      // mind: 优先 pet.mind，回退 '在发呆...'
      petState.value.mind = (res.data['pet.mind'] as string) || '在发呆...'
    }
  } catch {
    // 静默，使用默认值
  }
}

// ── Gateway 实时推送: 监听 state_update 同步宠物状态 ──
const { onPush: onOverviewPush } = useGateway()
onOverviewPush('state_update', (payload) => {
  if (payload.mood !== undefined) petState.value.mood = payload.mood as string
  if (payload.energy !== undefined) {
    const energy = Number(payload.energy)
    petState.value.vibe = energy >= 70 ? 'active' : energy >= 30 ? 'relaxed' : 'tired'
  }
})

// ══════ 功能开关 (Profile) ══════
const currentProfile = ref<'default' | 'lightweight' | 'companion'>('default')
const isTogglingProfile = ref(false)

const isLightweightEnabled = computed(
  () => currentProfile.value === 'lightweight' || currentProfile.value === 'companion',
)
const isCompanionEnabled = computed(() => currentProfile.value === 'companion')

async function toggleLightweight(val: boolean) {
  if (isTogglingProfile.value) return
  isTogglingProfile.value = true
  try {
    const target = val ? 'lightweight' : 'default'
    const agentId = activeAgent.value?.id ?? 'pero'
    await chatApi.switchProfile(agentId, target)
    currentProfile.value = target
  } catch (e) {
    logger.error('OverviewTab', '切换轻量模式失败', e)
  } finally {
    isTogglingProfile.value = false
  }
}

async function toggleCompanion(val: boolean) {
  if (isTogglingProfile.value) return
  isTogglingProfile.value = true
  try {
    const target = val ? 'companion' : 'lightweight'
    const agentId = activeAgent.value?.id ?? 'pero'
    await chatApi.switchProfile(agentId, target)
    currentProfile.value = target
  } catch (e) {
    logger.error('OverviewTab', '切换陪伴模式失败', e)
  } finally {
    isTogglingProfile.value = false
  }
}

// ══════ 记忆配置 ══════
const activeMemoryTab = ref<'desktop' | 'work' | 'social'>('desktop')
const isSavingMemoryConfig = ref(false)

const memoryConfig = ref({
  modes: {
    desktop: { context_limit: 15, rag_limit: 10 },
    work: { context_limit: 30, rag_limit: 15 },
    social: { context_limit: 50, rag_limit: 10 },
  },
})

async function loadMemoryConfig() {
  try {
    // 使用单个 KV key 存整个 JSON (与 v1 /configs/memory 对齐)
    const res = await configApi.get<{ key: string; value: string }>('memory.config')
    if (res.data?.value) {
      const parsed = JSON.parse(res.data.value)
      if (parsed?.modes) {
        memoryConfig.value = { ...memoryConfig.value, ...parsed }
      }
    }
  } catch {
    // KV key 不存在或解析失败，使用默认值
  }
}

async function saveMemoryConfig() {
  isSavingMemoryConfig.value = true
  try {
    // 将整个配置对象序列化为 JSON string 存入单个 KV key
    await configApi.set('memory.config', JSON.stringify(memoryConfig.value))
  } catch (e) {
    logger.error('OverviewTab', '保存记忆配置失败', e)
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
    const [sysRes, memRes, taskRes, sessRes, agentsRes] = await Promise.allSettled([
      systemApi.info(),
      memoryApi.list({ page: 1, pageSize: 1 }),
      schedulerApi.reminders(),
      sessionsApi.list({ pageSize: 5 }),
      agentApi.list(),
    ])

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

    // 最近对话
    if (sessRes.status === 'fulfilled' && sessRes.value.data) {
      stats.value.totalChats = sessRes.value.data.total
      recentChats.value = sessRes.value.data.items.map((s, i) => ({
        id: i,
        summary: s.preview || '新对话',
        agent: s.agentId || 'Pero',
        time: new Date(s.lastMessageAt).toLocaleString('zh-CN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        tokenCount: s.messageCount || 0,
      }))
    }

    // Agent 列表
    if (agentsRes.status === 'fulfilled' && agentsRes.value.data) {
      agents.value = agentsRes.value.data
      activeAgent.value = agents.value.find((a) => a.isActive) ?? agents.value[0] ?? null
    }

    // 加载宠物状态和记忆配置
    await Promise.allSettled([loadPetState(), loadMemoryConfig()])
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
  { id: 'desktop' as const, label: '桌面模式', icon: 'desktop' },
  { id: 'work' as const, label: '工作模式', icon: 'settings' },
  { id: 'social' as const, label: '社交模式', icon: 'chat' },
]

// ══════ 故事导入 ══════
const showImportStory = ref(false)
const importStoryText = ref('')
const isImportingStory = ref(false)

async function handleImportStory() {
  if (!importStoryText.value.trim()) return
  isImportingStory.value = true
  try {
    const res = await memoryApi.importStory({
      text: importStoryText.value,
      agentId: activeAgent.value?.id ?? 'pero',
    })
    if (res.data) {
      // 导入成功，刷新统计
      stats.value.totalMemories += res.data.imported
      importStoryText.value = ''
      showImportStory.value = false
    }
  } catch (e) {
    logger.error('OverviewTab', '故事导入失败', e)
  } finally {
    isImportingStory.value = false
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
  <div class="p-6 space-y-6 overflow-y-auto h-full custom-scrollbar">
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
        <PCard pixel hoverable variant="purple" glow class="group">
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
        <PCard pixel hoverable variant="sky" glow class="group">
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
        <PCard pixel hoverable variant="orange" glow class="group">
          <div class="flex items-center gap-4 relative">
            <div
              class="p-4 bg-orange-100 pixel-border-orange text-orange-500 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500"
            >
              <PixelIcon name="flash" size="xl" animation="bounce" />
            </div>
            <div class="relative z-10">
              <h3 class="text-base font-bold text-slate-600 flex items-center gap-1.5">
                待办提醒
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
                  class="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-sky-50 pixel-border-sky text-sm transition-all press-effect group/btn"
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
                  class="absolute right-0 top-full mt-2 w-full py-2 bg-white/90 backdrop-blur-xl border border-sky-100 shadow-2xl z-50"
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
            class="bg-sky-50/40 pixel-border-sky p-5 transition-all hover:bg-white hover:pixel-border-pink group relative"
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
              {{ moodLabels[petState.mood] || petState.mood }}
            </div>
            <div class="h-1.5 bg-sky-100/50 overflow-hidden relative z-10">
              <div
                class="h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
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
            class="bg-sky-50/40 pixel-border-sky p-5 transition-all hover:bg-white hover:pixel-border-pink group relative"
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
              {{ vibeLabels[petState.vibe] || petState.vibe }}
            </div>
            <div class="h-1.5 bg-sky-100/50 overflow-hidden relative z-10">
              <div
                class="h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
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
            class="bg-sky-50/40 pixel-border-sky p-5 transition-all hover:bg-white hover:pixel-border-pink group relative"
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
                class="h-full bg-gradient-to-r from-sky-400 to-sky-300 transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
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

      <!-- ═══ 功能开关组 ═══ -->
      <div class="space-y-4">
        <!-- 轻量模式 -->
        <PCard pixel class="group/switch">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div class="text-2xl group-hover/switch:scale-110 transition-transform duration-300">
                <PixelIcon name="leaf" size="lg" />
              </div>
              <div>
                <div class="font-bold text-slate-800 flex items-center gap-2 text-lg">
                  轻量聊天模式
                  <span class="text-xs text-sky-400/60 font-mono font-normal">Lightweight</span>
                </div>
                <div class="text-sm text-slate-500 mt-1 leading-relaxed">
                  开启后，将禁用大部分高级工具以节省资源。仅保留视觉感知、记忆管理和基础管理功能。
                </div>
              </div>
            </div>
            <PSwitch
              :model-value="isLightweightEnabled"
              :loading="isTogglingProfile"
              @update:model-value="toggleLightweight"
            />
          </div>
        </PCard>

        <!-- 陪伴模式 -->
        <PCard
          pixel
          class="group/switch"
          :class="{ 'opacity-50 pointer-events-none': !isLightweightEnabled }"
        >
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
                  {{ activeAgent?.name || 'Pero' }}
                  将自动观察你的屏幕动态并进行互动。
                  <span v-if="!isLightweightEnabled" class="text-rose-500 font-bold ml-2 text-xs">
                    (需要先开启"轻量模式")
                  </span>
                </div>
              </div>
            </div>
            <PSwitch
              :model-value="isCompanionEnabled"
              :loading="isTogglingProfile"
              :disabled="!isLightweightEnabled"
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
                  配置不同模式下的记忆召回与上下文长度
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
              class="bg-sky-50/50 p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
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
                  {{ memoryConfig.modes[activeMemoryTab].context_limit }}
                </span>
              </div>
              <PSlider
                v-model="memoryConfig.modes[activeMemoryTab].context_limit"
                :min="activeMemoryTab === 'social' ? 20 : 5"
                :max="activeMemoryTab === 'work' ? 100 : activeMemoryTab === 'social' ? 200 : 50"
              />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:rotate-12 transition-transform">
                  <PixelIcon name="thought" size="sm" />
                </span>
                <p class="leading-relaxed">
                  最近对话的条数，用于维持对话连贯性。
                  <PixelIcon name="sparkle" size="xs" />
                </p>
              </div>
            </div>

            <!-- RAG 召回数量 -->
            <div
              class="bg-sky-50/50 p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
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
                  {{ memoryConfig.modes[activeMemoryTab].rag_limit }}
                </span>
              </div>
              <PSlider
                v-model="memoryConfig.modes[activeMemoryTab].rag_limit"
                :min="0"
                :max="activeMemoryTab === 'work' ? 50 : 30"
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

    <!-- ═══ 故事导入弹窗 ═══ -->
    <PDialog v-model="showImportStory" title="导入故事生成记忆" width="600px">
      <div class="space-y-4">
        <div class="text-sm text-slate-600 leading-relaxed space-y-1.5">
          <p>你可以将小说设定、人物背景、日记或长篇回忆录粘贴在这里。</p>
          <p>
            {{ activeAgent?.name || 'Pero' }}
            将会阅读这些内容，并将其拆解为一系列关键记忆节点存入数据库， 作为它的“长期记忆”。
          </p>
          <p
            class="mt-2 text-amber-600 text-xs font-bold flex items-center gap-1.5 bg-amber-50 px-3 py-2 border border-amber-200"
          >
            <PixelIcon name="alert" size="xs" />
            注意：这是一个耗时操作，且会消耗较多 Token。
          </p>
        </div>
        <textarea
          v-model="importStoryText"
          rows="10"
          placeholder="在此粘贴长文本..."
          class="w-full px-4 py-3 bg-sky-50/50 border-2 border-sky-100 focus:border-sky-300 text-sm leading-relaxed text-slate-700 resize-none outline-none transition-all duration-300 placeholder:text-slate-300"
        />
      </div>
      <template #footer>
        <PButton variant="secondary" size="sm" @click="showImportStory = false">取消</PButton>
        <PButton
          variant="primary"
          size="sm"
          :loading="isImportingStory"
          :disabled="!importStoryText.trim()"
          @click="handleImportStory"
        >
          开始生成
        </PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
