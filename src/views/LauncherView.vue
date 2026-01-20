<template>
  <!-- Global Decorative Elements -->
  <div class="fixed top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 z-50 pointer-events-none"></div>
  <div class="fixed -top-24 -right-24 w-96 h-96 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none"></div>
  <div class="fixed -bottom-24 -left-24 w-96 h-96 bg-blue-500/5 blur-[120px] rounded-full pointer-events-none"></div>

  <CustomTitleBar :transparent="true" />
  
  <div class="flex h-screen w-screen overflow-hidden bg-slate-950/70 text-slate-200 font-sans select-text pt-8">
    <!-- Sidebar Navigation -->
    <aside :class="[
      'glass-effect border-r border-slate-800/30 flex flex-col transition-all duration-300 relative z-20 select-none backdrop-blur-md',
      isSidebarCollapsed ? 'w-20' : 'w-64'
    ]">
      <div class="p-6 mb-6 flex items-center justify-between">
        <div v-if="!isSidebarCollapsed" class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 ring-1 ring-white/20">
            <Zap :size="18" fill="currentColor" />
          </div>
          <span class="font-bold tracking-tight text-lg bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">{{ AGENT_NAME.toUpperCase() }}</span>
        </div>
        <button 
          @click="isSidebarCollapsed = !isSidebarCollapsed"
          class="p-2 hover:bg-white/5 rounded-lg text-slate-500 hover:text-emerald-400 transition-all duration-200 mx-auto active:scale-95"
        >
          <Menu :size="20" />
        </button>
      </div>

      <nav class="flex-1 px-4 space-y-2">
        <button 
          v-for="item in navItems" 
          :key="item.id"
          @click="activeTab = item.id"
          :class="[
            'w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-300 group relative overflow-hidden',
            activeTab === item.id 
              ? 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
              : 'text-slate-500 hover:bg-white/5 hover:text-slate-200'
          ]"
        >
          <div v-if="activeTab === item.id" class="absolute inset-0 bg-emerald-400/5 blur-sm"></div>
          <component :is="item.icon" :size="20" :class="activeTab === item.id ? 'text-emerald-400' : 'group-hover:scale-110 transition-transform duration-300'" />
          <span v-if="!isSidebarCollapsed" class="font-medium text-sm z-10">{{ item.name }}</span>
          <div v-if="activeTab === item.id && !isSidebarCollapsed" class="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] z-10"></div>
        </button>
      </nav>


    </aside>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col relative overflow-hidden bg-transparent">
      <!-- Background Glow (Subtler) -->
      <div class="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[150px] rounded-full pointer-events-none"></div>
      
      <!-- Top Header -->
      <header class="h-20 flex items-center justify-between px-10 border-b border-slate-800/30 backdrop-blur-sm z-10 select-none">
        <div>
          <h1 class="text-2xl font-bold text-white tracking-tight drop-shadow-sm">
            Pero Launcher
          </h1>
          <p class="text-xs text-slate-500 mt-1 font-mono tracking-wider flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            版本 0.1.0 • 系统就绪
          </p>
        </div>

        <div class="flex items-center gap-6">
          <div class="flex items-center gap-4 bg-slate-900/40 px-5 py-2.5 rounded-full border border-slate-700/30 backdrop-blur-md shadow-sm">
            <div class="flex items-center gap-2">
              <div :class="['w-2 h-2 rounded-full shadow-[0_0_8px] transition-colors duration-500', getStatusColor(backendStatus)]"></div>
              <span class="text-xs font-medium text-slate-300 uppercase tracking-tight">核心服务</span>
            </div>
            <div class="w-px h-3 bg-slate-700/50"></div>
            <div class="flex items-center gap-2">
              <div :class="['w-2 h-2 rounded-full shadow-[0_0_8px] transition-colors duration-500', getStatusColor(napcatStatus)]"></div>
              <span class="text-xs font-medium text-slate-300 uppercase tracking-tight">NapCat</span>
            </div>
          </div>
        </div>
      </header>

      <!-- Content Area -->
      <main class="flex-1 overflow-hidden p-8">
        <div v-if="activeTab === 'home'" class="h-full flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          <!-- Status Cards -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 shrink-0">
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-emerald-500/30 transition-colors group">
              <div class="flex items-start justify-between mb-4">
                <div class="p-3 rounded-xl bg-blue-500/10 text-blue-400">
                  <Cpu :size="20" />
                </div>
                <span class="text-xs font-mono text-slate-500 group-hover:text-blue-400 transition-colors">CPU 负载</span>
              </div>
              <div class="text-2xl font-bold">{{ cpuUsage.toFixed(1) }}%</div>
              <div class="w-full bg-slate-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                <div class="bg-blue-500 h-full rounded-full transition-all duration-500" :style="{ width: `${Math.min(cpuUsage, 100)}%` }"></div>
              </div>
            </div>

            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-emerald-500/30 transition-colors group">
              <div class="flex items-start justify-between mb-4">
                <div class="p-3 rounded-xl bg-purple-500/10 text-purple-400">
                  <Database :size="20" />
                </div>
                <span class="text-xs font-mono text-slate-500 group-hover:text-purple-400 transition-colors">内存占用</span>
              </div>
              <div class="text-2xl font-bold">{{ (memoryUsed / 1024 / 1024).toFixed(0) }}MB</div>
              <div class="w-full bg-slate-800/50 h-1.5 rounded-full mt-4 overflow-hidden">
                <div class="bg-purple-500 h-full rounded-full transition-all duration-500" :style="{ width: `${memoryTotal > 0 ? (memoryUsed / memoryTotal * 100) : 0}%` }"></div>
              </div>
            </div>

            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-emerald-500/30 transition-colors group md:col-span-2 lg:col-span-1">
              <div class="flex items-start justify-between mb-4">
                <div class="p-3 rounded-xl bg-orange-500/10 text-orange-400">
                  <Activity :size="20" />
                </div>
                <span class="text-xs font-mono text-slate-500 group-hover:text-orange-400 transition-colors">运行状态</span>
              </div>
              <div class="text-2xl font-bold">{{ isRunning ? '已运行' : '待命' }}</div>
              <div class="flex gap-1.5 mt-4">
                <div v-for="i in 8" :key="i" :class="['h-1.5 flex-1 rounded-full', i <= (isRunning ? 8 : 2) ? 'bg-orange-500' : 'bg-slate-800/50']"></div>
              </div>
            </div>
          </div>

          <!-- Main Launch Section -->
          <div class="flex-1 min-h-[300px] flex flex-col items-center justify-center gap-8 glass-effect rounded-3xl border border-slate-800/50 relative overflow-hidden">
             <!-- Background pattern -->
             <div class="absolute inset-0 opacity-[0.03] pointer-events-none" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"></div>
             
             <div class="relative">
                <div v-if="isStarting" class="absolute inset-[-20px] rounded-full border-2 border-emerald-500/50 border-t-transparent animate-spin"></div>
                <button 
                  @click="toggleLaunch"
                  :disabled="isStarting"
                  :class="[
                    'relative w-32 h-32 md:w-40 md:h-40 rounded-full flex flex-col items-center justify-center gap-2 transition-all duration-500 group',
                    isRunning 
                      ? 'bg-rose-500/10 text-rose-500 border-2 border-rose-500/50 hover:bg-rose-500 hover:text-white hover:shadow-[0_0_40px_rgba(244,63,94,0.4)]' 
                      : 'bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.3)] hover:shadow-[0_0_60px_rgba(16,185,129,0.5)] hover:scale-105 active:scale-95'
                  ]"
                >
                  <Power :size="40" class="md:w-12 md:h-12" :stroke-width="2.5" />
                  <span class="text-xs md:text-sm font-bold uppercase tracking-widest">{{ isRunning ? '停止服务' : '启动 Pero' }}</span>
                </button>

                <button 
                  v-if="isRunning"
                  @click="stopServices"
                  class="absolute -right-20 top-1/2 -translate-y-1/2 p-3 rounded-full bg-slate-800/50 text-slate-400 hover:bg-rose-500 hover:text-white transition-all hover:scale-110 border border-slate-700 hover:border-rose-500/50 shadow-lg backdrop-blur-sm group/close"
                  title="关闭所有服务"
                >
                  <X :size="20" />
                </button>
             </div>

             <div class="flex flex-col items-center gap-2 px-6">
               <h3 class="text-lg md:text-xl font-medium text-center">{{ isRunning ? AGENT_NAME + ' Core 正在运行' : '准备就绪' }}</h3>
               <p class="text-slate-500 text-xs md:text-sm max-w-md text-center">
                 {{ isRunning ? '所有系统在线。角色窗口已激活。' : '点击上方按钮初始化所有后端服务及角色窗口。' }}
               </p>
             </div>
          </div>
        </div>



        <!-- Plugins Tab -->
        <div v-if="activeTab === 'plugins'" class="h-full flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold tracking-tight">插件管理</h2>
            <div class="px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-[10px] font-bold text-purple-500 uppercase tracking-widest">
              Total: {{ plugins.length }}
            </div>
          </div>
          
          <div class="grid grid-cols-1 gap-4 overflow-y-auto pr-2 custom-scrollbar">
            <div v-for="plugin in plugins" :key="plugin.name" class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-purple-500/30 transition-all group">
              <div class="flex justify-between items-start mb-2">
                  <div class="flex items-center gap-3">
                      <div class="p-2 rounded-lg bg-slate-800 text-purple-400">
                          <Plug :size="20" />
                      </div>
                      <div>
                          <h3 class="font-bold text-base">{{ plugin.displayName || plugin.name }}</h3>
                          <div class="flex items-center gap-2 text-xs text-slate-500 font-mono">
                              <span class="bg-slate-800 px-1.5 py-0.5 rounded text-slate-400">{{ plugin.version }}</span>
                              <span>{{ plugin.pluginType }}</span>
                          </div>
                      </div>
                  </div>
                  <div class="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider" 
                        :class="plugin.valid ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'">
                      {{ plugin.valid ? 'Active' : 'Invalid' }}
                  </div>
              </div>
              <p class="text-sm text-slate-400 leading-relaxed mb-4">{{ plugin.description }}</p>
              
              <div v-if="plugin.capabilities?.invocationCommands?.length" class="space-y-2">
                  <p class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Commands</p>
                  <div class="flex flex-wrap gap-2">
                      <span v-for="cmd in plugin.capabilities.invocationCommands" :key="cmd.commandIdentifier" 
                            class="px-2 py-1 rounded bg-slate-900/50 border border-slate-800 text-xs font-mono text-slate-300"
                            :title="cmd.description">
                          {{ cmd.commandIdentifier }}
                      </span>
                  </div>
              </div>
            </div>
            
            <div v-if="plugins.length === 0" class="glass-effect rounded-2xl p-12 border border-slate-800/50 flex flex-col items-center justify-center text-slate-600 opacity-50">
               <Plug :size="48" class="mb-4" />
               <p>未检测到插件</p>
            </div>
          </div>
        </div>

        <!-- Tools Tab -->
        <div v-if="activeTab === 'tools'" class="h-full flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold tracking-tight">内置工具箱</h2>
            <div class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
              本地环境
            </div>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-blue-500/30 transition-all group relative overflow-hidden">
              <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Search :size="64" />
              </div>
              <div class="relative z-10">
                <div class="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4">
                  <Search :size="24" />
                </div>
                <h3 class="text-lg font-bold mb-2">Everything 搜索</h3>
                <p class="text-sm text-slate-500 mb-6 leading-relaxed">
                  高性能本地文件索引工具。{{ APP_TITLE }} 使用此工具快速定位相关资源文件。
                </p>
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-mono uppercase tracking-widest" :class="esStatus === 'INSTALLED' ? 'text-emerald-500' : 'text-slate-600'">
                    {{ esStatus === 'INSTALLED' ? '已集成' : '集成组件' }}
                  </span>
                  <button 
                    @click="installES"
                    :disabled="isInstallingES || esStatus === 'INSTALLED'"
                    class="px-4 py-2 rounded-lg bg-slate-800 text-xs font-bold hover:bg-blue-600 hover:text-white transition-all disabled:opacity-50"
                  >
                    {{ isInstallingES ? '安装中...' : (esStatus === 'INSTALLED' ? '已安装' : '检查/安装') }}
                  </button>
                </div>
              </div>
            </div>

            <!-- NapCat Social Adapter -->
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-pink-500/30 transition-all group relative overflow-hidden">
              <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <MessageSquare :size="64" />
              </div>
              <div class="relative z-10">
                <div class="w-12 h-12 rounded-xl bg-pink-500/10 text-pink-400 flex items-center justify-center mb-4">
                  <MessageSquare :size="24" />
                </div>
                <h3 class="text-lg font-bold mb-2">NapCat 社交集成</h3>
                <p class="text-sm text-slate-500 mb-6 leading-relaxed">
                  通过 NapCat 框架连接 QQ 协议。开启后 {{ AGENT_NAME }} 将具备社交互动、自动回复及消息处理能力。
                </p>
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div 
                      @click="isSocialEnabled = !isSocialEnabled; toggleSocialMode()"
                      class="w-10 h-5 rounded-full relative cursor-pointer transition-colors"
                      :class="isSocialEnabled ? 'bg-pink-600' : 'bg-slate-700'"
                    >
                      <div 
                        class="absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform"
                        :class="isSocialEnabled ? 'translate-x-5' : 'translate-x-0'"
                      ></div>
                    </div>
                    <span class="text-xs font-bold" :class="isSocialEnabled ? 'text-pink-400' : 'text-slate-500'">
                      {{ isSocialEnabled ? '已启用' : '已禁用' }}
                    </span>
                  </div>
                  <div v-if="isSocialEnabled" class="flex gap-2">
                    <span v-if="napcatStatus === 'RUNNING'" class="px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 text-[10px] font-bold">运行中</span>
                    <span v-else class="px-2 py-1 rounded bg-slate-800 text-slate-500 text-[10px] font-bold">已停止</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Placeholder for future tools -->
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 border-dashed flex flex-col items-center justify-center text-slate-700 group hover:border-slate-700 transition-colors">
              <Plus :size="32" class="mb-2 opacity-20 group-hover:opacity-40 transition-opacity" />
              <span class="text-sm font-medium">更多工具开发中</span>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer / Mini Status -->
      <footer class="h-10 px-10 flex items-center justify-between border-t border-slate-800/30 text-[10px] font-mono text-slate-600 select-none">
        <div class="flex items-center gap-6">
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            TAURI v2.0
          </div>
          <div class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
            VITE + VUE 3
          </div>
        </div>
        <div class="flex items-center gap-4">
          <span class="flex items-center gap-1.5">
            <ShieldCheck :size="12" /> SECURE MODE
          </span>
          <span>© 2026 PEROFAMILY</span>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, shallowRef, watch, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import { AGENT_NAME, APP_TITLE } from '../config'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getAllWebviewWindows, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  Sparkles, Home, Settings, FolderOpen,
  Cpu, Database, Activity, Power, ShieldCheck,
  LayoutGrid, ScrollText, Play, Shield,
  Menu, Zap, X, Plug, Search, Plus, Code
} from 'lucide-vue-next'

const router = useRouter()
const activeTab = ref('home')

watch(activeTab, async (val) => {
  // Logic for other tabs if needed
})

const isSidebarCollapsed = ref(false)
const backendStatus = ref('STOPPED')
const napcatStatus = ref('STOPPED')
const esStatus = ref('CHECKING')
const isRunning = ref(false)
const isStarting = ref(false)
const plugins = ref([])
const isInstallingES = ref(false)
const appConfig = ref({})
const isSocialEnabled = ref(true)

const cpuUsage = ref(0)
const memoryUsed = ref(0)
const memoryTotal = ref(0)
let statsInterval = null

const updateStats = async () => {
  try {
    const stats = await invoke('get_system_stats')
    cpuUsage.value = stats.cpu_usage
    memoryUsed.value = stats.memory_used
    memoryTotal.value = stats.memory_total
  } catch (e) {
    // console.debug("Stats update failed", e)
  }
}

const loadConfig = async () => {
  try {
    const config = await invoke('get_config')
    appConfig.value = config
    isSocialEnabled.value = config.enable_social_mode !== false
  } catch (e) {
    console.error("Failed to load config:", e)
  }
}

const toggleSocialMode = async () => {
  try {
    const newConfig = { ...appConfig.value, enable_social_mode: isSocialEnabled.value }
    await invoke('save_config', { config: newConfig })
    appConfig.value = newConfig
    
    // If disabled, stop NapCat if it's running
    if (!isSocialEnabled.value && napcatStatus.value === 'RUNNING') {
      await invoke('stop_napcat_wrapper')
      napcatStatus.value = 'STOPPED'
    }
  } catch (e) {
    console.error("Failed to save config:", e)
    // Revert UI on failure
    isSocialEnabled.value = !isSocialEnabled.value
  }
}

onMounted(async () => {
  // Show window when ready to avoid white screen
  setTimeout(async () => {
    const win = getCurrentWebviewWindow()
    await win.show()
    await win.setFocus()
  }, 200)

  await loadConfig()

  // Listeners
  // 移除这里的 backend-log 监听，因为它会通过 console.log 被 TerminalPanel 错误拦截为 frontend 日志
  // 现在 TerminalPanel 已经直接监听 backend-log 了
  await listen('es-log', (event) => addLog(`[ES] ${event.payload}`))
  
  await listen('napcat-log', (event) => {
    const logLine = event.payload
    const timestamp = new Date().toLocaleTimeString()
    
    // Add to specific NapCat logs
    napcatLogs.value.push({
      time: timestamp,
      content: logLine,
      id: Date.now() + Math.random()
    })
    
    if (napcatLogs.value.length > 500) napcatLogs.value.shift()
  })

  // Load plugins
  try {
    plugins.value = await invoke('get_plugins')
  } catch (e) {
    console.error("Failed to load plugins:", e)
    addLog(`[ERROR] Failed to load plugins: ${e}`)
  }

  // Check ES status
  try {
    const installed = await invoke('check_es')
    esStatus.value = installed ? 'INSTALLED' : 'NOT_INSTALLED'
  } catch (e) {
    esStatus.value = 'ERROR'
  }

  // Start stats polling
  updateStats()
  statsInterval = setInterval(updateStats, 2000)
})

onUnmounted(() => {
  if (statsInterval) clearInterval(statsInterval)
})

const navItems = [
  { id: 'home', name: '控制面板', icon: Home },
  { id: 'plugins', name: '插件管理', icon: Plug },
  { id: 'tools', name: '工具箱', icon: LayoutGrid },
]

const getStatusColor = (status) => {
  switch (status) {
    case 'RUNNING': return 'bg-emerald-500 shadow-emerald-500/50'
    case 'STARTING': return 'bg-amber-500 shadow-amber-500/50'
    case 'ERROR': return 'bg-rose-500 shadow-rose-500/50'
    default: return 'bg-slate-700 shadow-transparent'
  }
}

const addLog = (msg) => {
  // Directly use console.log/error to feed into TerminalPanel
  if (msg.toLowerCase().includes('error')) {
    console.error(msg)
  } else if (msg.toLowerCase().includes('warn')) {
    console.warn(msg)
  } else {
    console.log(msg)
  }
}

const stopServices = async () => {
  try {
    addLog("[SYSTEM] Stopping services...")
    await invoke('stop_backend')
    await invoke('stop_napcat_wrapper')
    isRunning.value = false
    backendStatus.value = 'STOPPED'
    napcatStatus.value = 'STOPPED'
    
    const windows = await getAllWebviewWindows()
    
    // Use Rust command to hide pet window reliably
    await invoke('hide_pet_window')

    const dashboardWin = windows.find(w => w.label === 'dashboard')
    if (dashboardWin) await dashboardWin.close()
      
  } catch (e) {
    addLog(`[ERROR] Failed to stop: ${e}`)
  }
}

const toggleLaunch = async () => {
  if (isRunning.value) {
    await stopServices()
  } else {
    isStarting.value = true
    try {
      addLog("[SYSTEM] Starting services...")
      
      // 1. Start Backend
      backendStatus.value = 'STARTING'
      await invoke('start_backend', {
        enableSocialMode: isSocialEnabled.value
      })
      backendStatus.value = 'RUNNING'
      addLog('[SYSTEM] 核心服务已启动。')
      
      // 2. Start NapCat
      if (isSocialEnabled.value) {
        napcatStatus.value = 'STARTING'
        await invoke('start_napcat')
        napcatStatus.value = 'RUNNING'
        addLog('[SYSTEM] NapCat 容器已初始化。')
      } else {
        addLog('[SYSTEM] 社交模式已禁用，跳过 NapCat 启动。')
      }

      // 3. Open Pet Window
      await invoke('open_pet_window')
      addLog('[SYSTEM] 角色窗口已激活。')
      
      isStarting.value = false
      isRunning.value = true
      addLog('[SYSTEM] PeroCore 系统在线。')

    } catch (e) {
      addLog(`[ERROR] Start failed: ${e}`)
      console.error("[ERROR] Start failed details:", e)
      isStarting.value = false
      isRunning.value = false
      backendStatus.value = 'ERROR'
    }
  }
}

const openConfig = () => {
  addLog("Config editor not implemented yet.")
}

const openFolder = async () => {
  await invoke('open_root_folder')
}

const installES = async () => {
  if (isInstallingES.value || esStatus.value === 'INSTALLED') return
  isInstallingES.value = true
  try {
    addLog("[SYSTEM] Installing Everything Search...")
    await invoke('install_es')
    addLog("[SYSTEM] Everything Search installed.")
    esStatus.value = 'INSTALLED'
  } catch (e) {
    addLog(`[ERROR] ES Install failed: ${e}`)
  } finally {
    isInstallingES.value = false
  }
}
</script>

<style>
/* 继承全局样式中的 glass-effect */
</style>
