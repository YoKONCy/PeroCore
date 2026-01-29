<template>
  <!-- Global Decorative Elements -->
  <!-- 全局装饰元素 -->
  <div class="fixed top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500/0 via-emerald-500/40 to-emerald-500/0 z-50 pointer-events-none"></div>
  <div class="fixed -top-24 -right-24 w-96 h-96 bg-emerald-500/5 blur-[120px] rounded-full pointer-events-none"></div>
  <div class="fixed -bottom-24 -left-24 w-96 h-96 bg-blue-500/5 blur-[120px] rounded-full pointer-events-none"></div>

  <CustomTitleBar :transparent="true" />
  
  <div class="flex h-screen w-screen overflow-hidden bg-slate-950/80 text-slate-200 font-sans select-text pt-8">
    <!-- Sidebar Navigation -->
    <!-- 侧边导航栏 -->
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
    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col relative overflow-hidden bg-transparent">
      <!-- Background Glow (Subtler) -->
      <!-- 背景光晕 (更柔和) -->
      <div class="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[150px] rounded-full pointer-events-none"></div>
      
      <!-- Top Header -->
      <!-- 顶部标题栏 -->
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
      <!-- 内容区域 -->
      <main class="flex-1 overflow-hidden p-8">
        <div v-if="activeTab === 'home'" class="h-full flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
          <!-- Status Cards -->
          <!-- 状态卡片 -->
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
          <!-- 主要启动区域 -->
          <div class="flex-1 min-h-[300px] flex flex-col items-center justify-center gap-8 glass-effect rounded-3xl border border-slate-800/50 relative overflow-hidden">
             <!-- Background pattern -->
             <!-- 背景图案 -->
             <div class="absolute inset-0 opacity-[0.03] pointer-events-none" style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"></div>
             
             <div class="relative">
                <div v-if="isStarting" class="absolute inset-[-20px] rounded-full border-2 border-emerald-500/50 border-t-transparent animate-spin"></div>
                <button 
                  @click="toggleLaunch"
                  :disabled="isStarting || envStatus === 'error'"
                  :class="[
                    'relative w-32 h-32 md:w-40 md:h-40 rounded-full flex flex-col items-center justify-center gap-2 transition-all duration-500 group',
                    isRunning 
                      ? 'bg-rose-500/10 text-rose-500 border-2 border-rose-500/50 hover:bg-rose-500 hover:text-white hover:shadow-[0_0_40px_rgba(244,63,94,0.4)]' 
                      : (envStatus === 'error' 
                          ? 'bg-slate-700 text-slate-500 border-2 border-slate-600 cursor-not-allowed opacity-80' 
                          : 'bg-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.3)] hover:shadow-[0_0_60px_rgba(16,185,129,0.5)] hover:scale-105 active:scale-95')
                  ]"
                >
                  <div v-if="envStatus === 'error'" class="flex flex-col items-center gap-1">
                    <XCircle :size="32" class="opacity-50" />
                    <span class="text-xs font-bold">环境缺失</span>
                  </div>
                  <template v-else>
                    <Power :size="40" class="md:w-12 md:h-12" :stroke-width="2.5" />
                    <span class="text-xs md:text-sm font-bold uppercase tracking-widest">{{ isRunning ? '停止服务' : '启动 Pero' }}</span>
                  </template>
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

        <!-- Agents Tab -->
        <!-- 角色标签页 -->
        <div v-if="activeTab === 'agents'" class="h-full flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold tracking-tight">角色配置</h2>
            <div class="flex items-center gap-3">
              <button 
                @click="fetchAgents" 
                :disabled="isLoadingAgents"
                class="p-2 rounded-lg bg-slate-800/50 hover:bg-white/10 text-slate-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                title="刷新列表"
              >
                <div :class="{'animate-spin': isLoadingAgents}">
                   <component :is="isLoadingAgents ? Sparkles : Search" :size="16" />
                </div>
              </button>
              <div class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                {{ `Local: ${agentList.length}` }}
              </div>
            </div>
          </div>

          <div v-if="agentList.length === 0" class="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4">
             <div class="p-6 rounded-full bg-slate-800/50 border border-slate-700/50">
               <Users :size="48" class="opacity-30" />
             </div>
             <div class="text-center">
               <h3 class="text-lg font-medium text-slate-400 mb-1">未找到角色配置</h3>
               <p class="text-sm opacity-60">请检查 backend/services/mdp/agents 目录</p>
             </div>
          </div>

          <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-2 custom-scrollbar">
             <div v-for="agent in agentList" :key="agent.id" 
                  class="glass-effect rounded-2xl p-5 border border-slate-800/50 transition-all duration-300 group relative overflow-hidden"
                  :class="agent.is_enabled ? 'hover:border-emerald-500/30 hover:shadow-lg hover:shadow-emerald-500/10' : 'opacity-60 grayscale hover:opacity-80'"
             >
                <!-- Background Gradient -->
                <!-- 背景渐变 -->
                <div v-if="agent.is_active" class="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none"></div>

                <div class="flex items-start justify-between mb-4 relative z-10">
                   <div class="flex items-center gap-4">
                      <div class="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg ring-1 ring-white/10"
                           :class="agent.is_enabled ? 'bg-gradient-to-br from-emerald-400 to-cyan-500' : 'bg-slate-700'"
                      >
                         {{ agent.name ? agent.name[0].toUpperCase() : '?' }}
                      </div>
                      <div>
                         <h3 class="font-bold text-lg leading-tight">{{ agent.name }}</h3>
                         <span class="text-[10px] text-slate-500 font-mono bg-slate-800/50 px-1.5 py-0.5 rounded">{{ agent.id }}</span>
                      </div>
                   </div>
                   <div class="relative">
                      <input type="checkbox" :checked="agent.is_enabled" @change="toggleAgentEnabled(agent)" 
                             class="peer sr-only" :id="'check-' + agent.id">
                      <label :for="'check-' + agent.id" 
                             class="block w-11 h-6 bg-slate-700/80 rounded-full cursor-pointer transition-colors peer-checked:bg-emerald-500 relative after:absolute after:top-1 after:left-1 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5 shadow-inner">
                      </label>
                   </div>
                </div>
                
                <p class="text-xs text-slate-400 leading-relaxed line-clamp-2 h-9 mb-4 relative z-10">
                   {{ agent.description || '暂无描述' }}
                </p>

                <div class="flex items-center justify-between mt-auto pt-3 border-t border-white/5 relative z-10">
                   <span class="text-[10px] uppercase font-bold tracking-wider flex items-center gap-1.5" 
                         :class="agent.is_active ? 'text-emerald-400' : (agent.is_enabled ? 'text-slate-400' : 'text-slate-600')">
                      <div class="w-1.5 h-1.5 rounded-full" :class="agent.is_active ? 'bg-emerald-400 shadow-[0_0_5px_currentColor]' : 'bg-slate-600'"></div>
                      {{ agent.is_active ? 'Active Agent' : (agent.is_enabled ? 'Ready' : 'Disabled') }}
                   </span>
                   
                   <!-- Only show "Set Active" if enabled but not active -->
                   <!-- 仅在已启用但未活跃时显示“设为活跃” -->
                   <button v-if="agent.is_enabled && !agent.is_active" 
                           @click="setAsActive(agent)"
                           class="text-[10px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-emerald-500 hover:text-white transition-all font-medium border border-slate-700 hover:border-emerald-400"
                   >
                      设为活跃
                   </button>
                </div>
             </div>
          </div>
        </div>

        <!-- Plugins Tab -->
        <!-- 插件标签页 -->
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

        <!-- Environment Tab -->
        <!-- 环境标签页 -->
        <div v-if="activeTab === 'environment'" class="h-full flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold tracking-tight">环境检测</h2>
            <div class="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest"
                 :class="{
                    'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20': envStatus === 'ok',
                    'bg-amber-500/10 text-amber-500 border border-amber-500/20': envStatus === 'warning',
                    'bg-rose-500/10 text-rose-500 border border-rose-500/20': envStatus === 'error',
                    'bg-slate-500/10 text-slate-500 border border-slate-500/20': envStatus === 'checking'
                 }">
               <div class="w-2 h-2 rounded-full animate-pulse" 
                    :class="{
                        'bg-emerald-500': envStatus === 'ok',
                        'bg-amber-500': envStatus === 'warning',
                        'bg-rose-500': envStatus === 'error',
                        'bg-slate-500': envStatus === 'checking'
                    }"></div>
               {{ envStatus === 'checking' ? '正在检测...' : (envStatus === 'ok' ? '环境就绪' : (envStatus === 'warning' ? '部分就绪' : '环境异常')) }}
            </div>
          </div>

          <div v-if="envReport" class="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-6">
             <!-- Critical Components -->
             <!-- 关键组件 -->
             <div class="space-y-4">
               <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <Shield :size="14" /> 核心运行时 (必须)
               </h3>
               
               <div class="grid grid-cols-1 gap-3">
                 <!-- Python -->
                 <!-- Python 环境 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-yellow-500/10 text-yellow-500">
                       <Code :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">Python 运行时</div>
                       <div class="text-xs text-slate-500 font-mono mt-0.5">
                         {{ envReport.python_exists ? `v${envReport.python_version}` : '未检测到' }}
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <span class="text-[10px] font-mono text-slate-600 hidden md:inline-block max-w-[150px] truncate" :title="envReport.python_path">
                       {{ envReport.python_path || 'PATH NOT FOUND' }}
                     </span>
                     <CheckCircle2 v-if="envReport.python_exists" :size="20" class="text-emerald-500" />
                     <XCircle v-else :size="20" class="text-rose-500" />
                   </div>
                 </div>

                 <!-- Backend Script -->
                 <!-- 后端脚本 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-blue-500/10 text-blue-500">
                       <ScrollText :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">后端核心脚本</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         main.py 入口文件
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.script_exists" :size="20" class="text-emerald-500" />
                     <XCircle v-else :size="20" class="text-rose-500" />
                   </div>
                 </div>

                 <!-- VC++ Redist -->
                 <!-- VC++ 运行库 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-500">
                       <Database :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">Visual C++ 运行库</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         VCRUNTIME140.dll
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.vc_redist_installed" :size="20" class="text-emerald-500" />
                     <div v-else class="flex items-center gap-2">
                        <a href="https://aka.ms/vs/17/release/vc_redist.x64.exe" target="_blank" class="text-xs text-blue-400 hover:underline">下载安装</a>
                        <XCircle :size="20" class="text-rose-500" />
                     </div>
                   </div>
                 </div>
                 
                 <!-- Data Dir -->
                 <!-- 数据目录 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-slate-700/30 text-slate-400">
                       <FolderOpen :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">数据目录权限</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         读写访问检查
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.data_dir_writable" :size="20" class="text-emerald-500" />
                     <XCircle v-else :size="20" class="text-rose-500" />
                   </div>
                 </div>
               </div>
             </div>

             <!-- Optional Components -->
             <!-- 可选组件 -->
             <div class="space-y-4">
               <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                 <Sparkles :size="14" /> 功能组件 (可选)
               </h3>
               
               <div class="grid grid-cols-1 gap-3">
                 <!-- WebView2 -->
                 <!-- WebView2 组件 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-500">
                       <LayoutGrid :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">Edge WebView2</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         UI 渲染引擎
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.webview2_installed" :size="20" class="text-emerald-500" />
                     <AlertCircle v-else :size="20" class="text-amber-500" title="缺失可能导致界面无法显示" />
                   </div>
                 </div>

                 <!-- Node.js -->
                 <!-- Node.js 环境 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-green-500/10 text-green-500">
                       <Terminal :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">Node.js 运行时</div>
                       <div class="text-xs text-slate-500 font-mono mt-0.5">
                         {{ envReport.node_exists ? `v${envReport.node_version}` : '未检测到' }}
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <span class="text-[10px] font-mono text-slate-600 hidden md:inline-block max-w-[150px] truncate" :title="envReport.node_path">
                       {{ envReport.node_path || 'PATH NOT FOUND' }}
                     </span>
                     <CheckCircle2 v-if="envReport.node_exists" :size="20" class="text-emerald-500" />
                     <AlertCircle v-else :size="20" class="text-amber-500" title="NapCat 依赖此组件" />
                   </div>
                 </div>

                 <!-- NapCat -->
                 <!-- NapCat 组件 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-pink-500/10 text-pink-500">
                       <MessageSquare :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">NapCat 适配器</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         QQ 协议支持
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                      <span v-if="!isSocialEnabled" class="text-[10px] uppercase font-bold text-slate-600 bg-slate-800 px-2 py-1 rounded">Disabled</span>
                      <CheckCircle2 v-else-if="envReport.napcat_installed" :size="20" class="text-emerald-500" />
                      <div v-else class="flex items-center gap-2">
                         <span class="text-xs text-amber-500">未安装</span>
                         <AlertCircle :size="20" class="text-amber-500" />
                      </div>
                   </div>
                 </div>

                 <!-- Port 9120 -->
                 <!-- 9120 端口 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-orange-500/10 text-orange-500">
                       <Activity :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">端口占用 (9120)</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         API 服务端口
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.port_9120_free" :size="20" class="text-emerald-500" />
                     <div v-else class="flex items-center gap-2">
                        <span class="text-xs text-rose-500 font-bold">已占用</span>
                        <XCircle :size="20" class="text-rose-500" />
                     </div>
                   </div>
                 </div>
                 
                 <!-- Memory Core -->
                 <!-- 记忆核心 -->
                 <div class="glass-effect p-4 rounded-xl border border-slate-800/50 flex items-center justify-between group hover:border-slate-700 transition-colors">
                   <div class="flex items-center gap-4">
                     <div class="p-2.5 rounded-lg bg-purple-500/10 text-purple-500">
                       <Cpu :size="20" />
                     </div>
                     <div>
                       <div class="font-bold text-sm">Pero Memory Core</div>
                       <div class="text-xs text-slate-500 mt-0.5">
                         Rust 加速模块
                       </div>
                     </div>
                   </div>
                   <div class="flex items-center gap-3">
                     <CheckCircle2 v-if="envReport.core_available" :size="20" class="text-emerald-500" />
                     <AlertCircle v-else :size="20" class="text-amber-500" title="性能将受限" />
                   </div>
                 </div>
               </div>
             </div>
             
             <!-- Error Log -->
             <!-- 错误日志 -->
             <div v-if="envReport.errors && envReport.errors.length > 0" class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <h3 class="text-xs font-bold text-rose-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                  <AlertCircle :size="14" /> 错误详情
                </h3>
                <ul class="space-y-1">
                  <li v-for="(err, idx) in envReport.errors" :key="idx" class="text-xs text-rose-300 font-mono">
                    • {{ err }}
                  </li>
                </ul>
             </div>
          </div>
          
          <div v-else class="flex-1 flex items-center justify-center">
             <div class="flex flex-col items-center gap-4 text-slate-500">
                <div class="w-12 h-12 border-2 border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
                <span class="text-sm font-medium animate-pulse">正在全面检测运行环境...</span>
             </div>
          </div>
        </div>

        <!-- Tools Tab -->
        <!-- 工具标签页 -->
        <div v-if="activeTab === 'tools'" class="h-full flex flex-col gap-6">
          <div class="flex items-center justify-between">
            <h2 class="text-xl font-bold tracking-tight">内置工具箱</h2>
            <div class="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
              本地环境
            </div>
          </div>
          
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-blue-500/30 transition-all group relative overflow-hidden">
              <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
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
            <!-- NapCat 社交适配器 -->
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 hover:border-pink-500/30 transition-all group relative overflow-hidden">
              <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity pointer-events-none">
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
                      @click="toggleSocialMode"
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
            <!-- 未来工具占位符 -->
            <div class="glass-effect rounded-2xl p-6 border border-slate-800/50 border-dashed flex flex-col items-center justify-center text-slate-700 group hover:border-slate-700 transition-colors">
              <Plus :size="32" class="mb-2 opacity-20 group-hover:opacity-40 transition-opacity" />
              <span class="text-sm font-medium">更多工具开发中</span>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer / Mini Status -->
      <!-- 底部 / 迷你状态 -->
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
import { invoke, listen } from '@/utils/ipcAdapter'
// import { invoke } from '@tauri-apps/api/core'
// import { listen } from '@tauri-apps/api/event'
// import { getAllWebviewWindows, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  Sparkles, Home, Settings, FolderOpen,
  Cpu, Database, Activity, Power, ShieldCheck,
  LayoutGrid, ScrollText, Play, Shield,
  Menu, Zap, X, Plug, Search, Plus, Code, MessageSquare, Users,
  CheckCircle2, XCircle, AlertCircle, Terminal
} from 'lucide-vue-next'

const router = useRouter()
const activeTab = ref('home')
const napcatLogs = ref([])

const envReport = ref(null)
const envStatus = ref('checking') // checking (检查中), ok (正常), warning (警告), error (错误)

watch(activeTab, async (val) => {
  if (val === 'environment') {
     await checkEnvironment()
  }
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
  // Optimistic update
  isSocialEnabled.value = !isSocialEnabled.value
  
  try {
    const newConfig = { ...appConfig.value, enable_social_mode: isSocialEnabled.value }
    // Deep clone to remove Vue Proxies which cause "An object could not be cloned" error in IPC
    const cleanConfig = JSON.parse(JSON.stringify(newConfig))
    
    // console.log("Saving config:", cleanConfig)
    await invoke('save_config', { config: cleanConfig })
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
    
    if (window.$notify) {
      window.$notify(`配置保存失败: ${e}`, "error", "设置错误")
    } else {
      alert(`配置保存失败: ${e}`)
    }
  }
}

onMounted(async () => {
  // Show window when ready to avoid white screen
  setTimeout(async () => {
    try {
        // const win = getCurrentWebviewWindow()
        // if (win) {
        //     await win.show()
        //     await win.setFocus()
        // }
        await invoke('show_window')
    } catch (e) {
        console.warn("Window control error", e)
    }
  }, 200)

  await loadConfig()

  // Listeners
  // 监听器
  // 移除这里的 backend-log 监听，因为它会通过 console.log 被 TerminalPanel 错误拦截为 frontend 日志
  // 现在 TerminalPanel 已经直接监听 backend-log 了
  await listen('es-log', (event) => addLog(`[ES] ${event.payload}`))
  
  await listen('napcat-log', (event) => {
    const logLine = event.payload
    const timestamp = new Date().toLocaleTimeString()
    
    // Add to specific NapCat logs
    // 添加到特定的 NapCat 日志
    napcatLogs.value.push({
      time: timestamp,
      content: logLine,
      id: Date.now() + Math.random()
    })
    
    if (napcatLogs.value.length > 500) napcatLogs.value.shift()
  })

  // Load plugins
  // 加载插件
  try {
    plugins.value = await invoke('get_plugins')
  } catch (e) {
    console.error("Failed to load plugins:", e)
    addLog(`[ERROR] Failed to load plugins: ${e}`)
  }

  // Check ES status
  // 检查 ES 状态
  try {
    const installed = await invoke('check_es')
    esStatus.value = installed ? 'INSTALLED' : 'NOT_INSTALLED'
  } catch (e) {
    esStatus.value = 'ERROR'
  }

  // Auto install NapCat if needed
  // 如果需要，自动安装 NapCat
  if (isSocialEnabled.value) {
    invoke('install_napcat').then(async (success) => {
      if (success) {
        addLog("[SYSTEM] NapCat 环境已就绪")
        // Refresh environment status to update UI
        await checkEnvironment()
      } else {
        addLog("[SYSTEM] NapCat 环境检查/安装失败")
      }
    }).catch(e => {
       console.error("NapCat auto-install check failed", e)
    })
  }

  // Start stats polling
  // 开始统计轮询
  updateStats()
  statsInterval = setInterval(updateStats, 2000)

  // 初始环境检查
  const status = await checkEnvironment()
  if (status === 'error') {
     if (window.$notify) {
       window.$notify("关键运行环境缺失，启动已禁用。请前往环境检测页修复。", "error", "环境缺失", 8000)
     }
  } else if (status === 'warning') {
     if (window.$notify) {
       window.$notify("环境存在警告，建议检查。", "warning", "环境警告", 5000)
     }
  }
})

onUnmounted(() => {
  if (statsInterval) clearInterval(statsInterval)
})

const navItems = [
  { id: 'home', name: '控制面板', icon: Home },
  { id: 'agents', name: '角色配置', icon: Users },
  { id: 'plugins', name: '插件管理', icon: Plug },
  { id: 'tools', name: '工具箱', icon: LayoutGrid },
  { id: 'environment', name: '环境检测', icon: ShieldCheck },
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
  // 直接使用 console.log/error 输入到 TerminalPanel
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
    
    // Use Rust command to hide pet window reliably
    await invoke('hide_pet_window')

    await invoke('close_dashboard')
      
  } catch (e) {
    addLog(`[ERROR] Failed to stop: ${e}`)
  }
}

const checkEnvironment = async () => {
  try {
    envStatus.value = 'checking'
    const report = await invoke('get_diagnostics')
    envReport.value = report
    
    // Determine overall status
    let criticalMissing = false
    let warning = false
    
    // Critical checks
    if (!report.python_exists) criticalMissing = true
    if (!report.script_exists) criticalMissing = true
    if (!report.data_dir_writable) criticalMissing = true
    if (!report.vc_redist_installed) criticalMissing = true
    
    // Warning checks
    if (!report.port_9120_free) warning = true
    if (!report.core_available) warning = true
    if (!report.webview2_installed) warning = true // Should be critical but let's be lenient
    if (isSocialEnabled.value && !report.napcat_installed) warning = true // Optional based on setting
    if (isSocialEnabled.value && !report.node_exists) warning = true // Node.js required for NapCat
    
    if (criticalMissing) {
       envStatus.value = 'error'
    } else if (warning) {
       envStatus.value = 'warning'
    } else {
       envStatus.value = 'ok'
    }
    
    return envStatus.value
  } catch (e) {
    console.error("Env check failed:", e)
    envStatus.value = 'error'
    return 'error'
  }
}

const toggleLaunch = async () => {
  if (isRunning.value) {
    await stopServices()
  } else {
    // 启动前强制检查
    const status = await checkEnvironment()
    if (status === 'error') {
       if (window.$notify) {
         window.$notify("环境检测未通过，缺少关键组件，无法启动。", "error", "启动阻止")
       }
       // 自动跳转到环境页
       activeTab.value = 'environment'
       return
    }

    if (status === 'warning') {
       if (window.$notify) {
         window.$notify("环境存在警告，可能影响部分功能。", "warning", "系统警告")
       }
    }

    isStarting.value = true
    try {
      addLog("[SYSTEM] Starting services...")
      
      // 1. Start Backend
      // 1. 启动后端
      backendStatus.value = 'STARTING'
      await invoke('start_backend', {
        enableSocialMode: isSocialEnabled.value
      })
      backendStatus.value = 'RUNNING'
      addLog('[SYSTEM] 核心服务已启动。')
      
      // 2. Start NapCat
      // 2. 启动 NapCat
      if (isSocialEnabled.value) {
        napcatStatus.value = 'STARTING'
        await invoke('start_napcat')
        napcatStatus.value = 'RUNNING'
        addLog('[SYSTEM] NapCat 容器已初始化。')
      } else {
        addLog('[SYSTEM] 社交模式已禁用，跳过 NapCat 启动。')
      }

      // 3. Open Pet Window
      // 3. 打开角色窗口
      await invoke('open_pet_window')
      addLog('[SYSTEM] 角色窗口已激活。')
      
      isStarting.value = false
      isRunning.value = true
      addLog('[SYSTEM] PeroCore 系统在线。')

    } catch (e) {
      addLog(`[ERROR] Start failed: ${e}`)
      console.error("[ERROR] Start failed details:", e)
      
      // 使用 NotificationManager 显示非模态错误
      if (window.$notify) {
          window.$notify(`启动失败: ${e}`, 'error', '启动异常', 10000)
      }

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

// --- Agent Logic ---
const agentList = ref([])
const isLoadingAgents = ref(false)

const fetchAgents = async () => {
  isLoadingAgents.value = true
  try {
    // 使用 Tauri 本地命令替代 fetch API
    const agents = await invoke('scan_local_agents')
    agentList.value = agents
  } catch (e) {
    console.error("Failed to fetch agents via Rust", e)
    addLog(`[ERROR] Failed to fetch agents: ${e}`)
  } finally {
    isLoadingAgents.value = false
  }
}

const toggleAgentEnabled = async (agent) => {
  // Optimistic update
  const originalState = agent.is_enabled
  agent.is_enabled = !agent.is_enabled
  
  await saveAgentConfig()
}

const setAsActive = async (agent) => {
  // Update local state
  agentList.value.forEach(a => a.is_active = (a.id === agent.id))
  await saveAgentConfig()
  addLog(`[CONFIG] Active agent set to: ${agent.name}`)
}

const saveAgentConfig = async () => {
  const enabledIds = agentList.value.filter(a => a.is_enabled).map(a => a.id)
  const activeAgent = agentList.value.find(a => a.is_active)
  const activeId = activeAgent ? activeAgent.id : (enabledIds.length > 0 ? enabledIds[0] : 'pero')

  try {
    await invoke('save_agent_launch_config', {
      enabledAgents: enabledIds,
      activeAgent: activeId
    })
  } catch (e) {
    console.error("Failed to save agent config", e)
    addLog(`[ERROR] Failed to save agent config: ${e}`)
  }
}

// Watchers
watch(activeTab, (val) => {
  if (val === 'agents') {
    fetchAgents()
  }
})

// Removed watch(isRunning) since we now load independently
</script>

<style>
/* 继承全局样式中的 glass-effect */
</style>
