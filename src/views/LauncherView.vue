<template>
  <div
    class="fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] pointer-events-none z-0 animate-pixel-bg-float"
  ></div>

  <!-- 像素装饰贴纸 -->
  <div class="fixed inset-0 pointer-events-none z-10 overflow-hidden select-none">
    <div
      class="absolute top-[15%] right-[5%] text-pink-300/40 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 0.5s"
    >
      <PixelIcon name="heart" class="w-8 h-8" />
    </div>
    <div
      class="absolute bottom-[25%] left-[18%] text-amber-300/30 animate-pixel-bounce pixel-hover-lift"
      style="animation-delay: 1.2s"
    >
      <PixelIcon name="star" class="w-6 h-6" />
    </div>
    <div
      class="absolute top-[40%] left-[2%] text-indigo-300/20 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 2s"
    >
      <PixelIcon name="mood-happy" class="w-10 h-10" />
    </div>
    <div
      class="absolute bottom-[10%] right-[12%] text-emerald-300/40 animate-pixel-bounce pixel-hover-lift"
      style="animation-delay: 0.8s"
    >
      <PixelIcon name="heart" class="w-5 h-5" />
    </div>
    <div
      class="absolute top-[8%] left-[25%] text-sky-300/30 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 1.5s"
    >
      <PixelIcon name="sparkle" class="w-7 h-7" />
    </div>
    <div
      class="absolute bottom-[40%] right-[3%] text-amber-200/20 animate-pixel-bounce pixel-hover-lift"
      style="animation-delay: 2.5s"
    >
      <PixelIcon name="star" class="w-9 h-9" />
    </div>
    <!-- 新增猫娘元素 -->
    <div
      class="absolute top-[60%] right-[8%] text-pink-200/30 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 3s"
    >
      <PixelIcon name="cat" class="w-12 h-12" />
    </div>
    <div
      class="absolute top-[25%] left-[10%] text-sky-200/20 animate-pixel-bounce pixel-hover-lift"
      style="animation-delay: 3.5s"
    >
      <PixelIcon name="cat" class="w-8 h-8" />
    </div>
    <div
      class="absolute bottom-[15%] left-[5%] text-emerald-300/30 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 4s"
    >
      <PixelIcon name="circle" class="w-4 h-4" />
    </div>
    <div
      class="absolute top-[5%] right-[20%] text-yellow-200/40 animate-pixel-bounce pixel-hover-lift"
      style="animation-delay: 2.2s"
    >
      <PixelIcon name="sparkle" class="w-6 h-6" />
    </div>
    <div
      class="absolute bottom-[5%] left-[30%] text-pink-300/20 animate-pixel-float pixel-hover-lift"
      style="animation-delay: 1.5s"
    >
      <PixelIcon name="heart" class="w-6 h-6" />
    </div>
    <div
      class="absolute top-[50%] left-[50%] -translate-x-1/2 -translate-y-1/2 text-sky-200/5 opacity-[0.05] pointer-events-none rotate-12"
    >
      <PixelIcon name="cat" class="w-[600px] h-[600px]" />
    </div>

    <!-- 动态背景装饰：星星与气泡 -->
    <div
      v-for="i in 12"
      :key="'star-' + i"
      class="absolute animate-pixel-star text-amber-200/30 pointer-events-none"
      :style="{
        top: Math.random() * 100 + '%',
        left: Math.random() * 100 + '%',
        animationDelay: Math.random() * 3 + 's'
      }"
    >
      <PixelIcon
        name="star"
        :style="{ width: Math.random() * 12 + 8 + 'px', height: Math.random() * 12 + 8 + 'px' }"
      />
    </div>
    <div
      v-for="i in 15"
      :key="'bubble-' + i"
      class="absolute animate-pixel-bubble text-sky-200/20 pointer-events-none"
      :style="{
        bottom: '-20px',
        left: Math.random() * 100 + '%',
        animationDelay: Math.random() * 5 + 's'
      }"
    >
      <PixelIcon
        name="circle"
        :style="{ width: Math.random() * 8 + 4 + 'px', height: Math.random() * 8 + 4 + 'px' }"
      />
    </div>
  </div>

  <div
    class="h-screen w-screen overflow-hidden bg-sky-50 text-slate-800 font-sans select-text relative pixel-ui pixel-grid-overlay"
  >
    <!-- 引导图层喵~ 🎭 -->
    <OnboardingOverlay
      v-model:is-visible="showOnboarding"
      type="launcher"
      @finish="handleOnboardingFinish"
    />

    <CustomTitleBar v-if="isElectron()" :transparent="true" />

    <div
      class="flex h-full w-full pixel-grid-overlay"
      :style="{
        zoom: scale,
        paddingTop: isElectron() ? `${32 / scale}px` : '0px'
      }"
    >
      <!-- 侧边导航栏 -->
      <aside
        id="nav-sidebar"
        :class="[
          'bg-white pixel-border-sky flex flex-col transition-all duration-300 relative z-20 select-none',
          isSidebarCollapsed ? 'w-20' : 'w-64'
        ]"
      >
        <div class="p-6 mb-6 flex items-center justify-between">
          <div v-if="!isSidebarCollapsed" class="flex items-center gap-3">
            <div
              class="w-8 h-8 pixel-border-sky bg-sky-500 flex items-center justify-center text-white pixel-hover-lift overflow-hidden"
            >
              <img
                v-if="activeAgent?.avatarUrl"
                :src="activeAgent.avatarUrl"
                class="w-full h-full object-cover"
                alt="Logo"
              />
              <PixelIcon v-else name="cat" size="sm" />
            </div>
            <span
              class="font-bold tracking-tight text-lg text-sky-600 group-hover:text-pink-500 transition-colors"
              >{{ (activeAgent?.name || AGENT_NAME).toUpperCase() }}</span
            >
          </div>
          <button
            class="p-2 hover:bg-sky-50 text-slate-500 hover:text-sky-500 transition-all duration-200 mx-auto"
            @click="isSidebarCollapsed = !isSidebarCollapsed"
          >
            <PixelIcon name="menu" size="md" />
          </button>
        </div>

        <nav class="flex-1 px-4 space-y-2">
          <button
            v-for="item in navItems"
            :id="'nav-' + item.id"
            :key="item.id"
            :class="[
              'w-full flex items-center gap-4 px-4 py-3.5 transition-all duration-300 group relative overflow-hidden pixel-hover-lift press-effect',
              activeTab === item.id
                ? item.id === 'home'
                  ? 'bg-sky-500 text-white pixel-border-sky shadow-[4px_4px_0_0_#0ea5e940]'
                  : item.id === 'agents'
                    ? 'bg-emerald-500 text-white pixel-border-emerald shadow-[4px_4px_0_0_#10b98140]'
                    : item.id === 'tools'
                      ? 'bg-amber-500 text-white pixel-border-amber shadow-[4px_4px_0_0_#f59e0b40]'
                      : 'bg-indigo-500 text-white pixel-border-indigo shadow-[4px_4px_0_0_#6366f140]'
                : 'text-slate-500 hover:bg-sky-50 hover:text-sky-600'
            ]"
            @click="activeTab = item.id"
          >
            <PixelIcon
              :name="item.icon"
              size="md"
              :class="
                activeTab === item.id
                  ? 'text-white'
                  : 'group-hover:scale-110 transition-transform duration-300'
              "
            />
            <span v-if="!isSidebarCollapsed" class="font-bold text-sm z-10 tracking-wide">{{
              item.name
            }}</span>
            <div
              v-if="activeTab === item.id && !isSidebarCollapsed"
              class="ml-auto text-white/50 animate-pixel-float"
            >
              <PixelIcon name="heart" size="sm" />
            </div>
          </button>
        </nav>

        <!-- 侧边栏底部：像素看板娘 -->
        <div class="mt-auto p-4 flex flex-col items-center border-t-2 border-sky-100/50">
          <div
            class="w-12 h-12 pixel-border-sky flex items-center justify-center mb-2 group cursor-pointer transition-colors duration-300 relative"
            :class="[
              isRunning
                ? 'bg-emerald-100 text-emerald-500 animate-pixel-bounce'
                : 'bg-sky-100 text-sky-500 animate-pixel-float'
            ]"
          >
            <img
              v-if="activeAgent?.avatarUrl"
              :src="activeAgent.avatarUrl"
              class="w-10 h-10 object-cover pixel-border-sm"
              alt="Mascot"
            />
            <PixelIcon v-else name="cat" size="lg" />
            <!-- 情绪气泡 -->
            <div
              class="absolute -top-6 -right-4 bg-white pixel-border-sm px-2 py-0.5 text-[8px] font-bold animate-pixel-float whitespace-nowrap"
              :class="isRunning ? 'text-emerald-500' : 'text-sky-500'"
            >
              {{ isRunning ? '加油中！' : '在发呆...' }}
            </div>
          </div>
          <div
            v-if="!isSidebarCollapsed"
            class="text-[10px] font-bold text-sky-400 font-mono tracking-widest uppercase flex items-center gap-1"
          >
            <PixelIcon name="sparkle" class="w-2 h-2 text-amber-400" />
            Pero Mascot
            <PixelIcon name="sparkle" class="w-2 h-2 text-amber-400" />
          </div>
        </div>
      </aside>

      <!-- 主内容区 -->
      <div class="flex-1 flex flex-col relative overflow-hidden bg-transparent">
        <!-- 顶部标题栏 -->
        <header
          class="h-20 flex items-center justify-between px-10 border-b-2 border-sky-600 bg-white z-10 select-none"
        >
          <div>
            <h1 class="text-2xl font-bold text-slate-800 tracking-tight">Pero Launcher</h1>
            <p class="text-xs text-slate-400 mt-1 font-mono tracking-wider flex items-center gap-2">
              <PixelIcon name="mood-happy" class="w-2.5 h-2.5 text-sky-500 animate-pixel-float" />
              版本 {{ appVersion }} • 系统就绪
            </p>
          </div>

          <div class="flex items-center gap-6">
            <div class="flex items-center gap-4 bg-white px-5 py-2.5 pixel-border-sky">
              <!-- Steam 用户状态 -->
              <PTooltip v-if="steamUser" content="Steam 已连接" placement="bottom">
                <div class="flex items-center gap-2 border-r-2 border-pink-100 pr-4 mr-1">
                  <div
                    class="w-6 h-6 bg-[#171a21] flex items-center justify-center text-[#66c0f4] pixel-border-sky pixel-hover-lift"
                  >
                    <PixelIcon name="gamepad" class="w-3.5 h-3.5" />
                  </div>
                  <div class="flex flex-col">
                    <span class="text-xs font-bold text-pink-500 leading-none">{{
                      steamUser.name
                    }}</span>
                    <span class="text-[9px] text-slate-400 font-mono leading-none mt-0.5"
                      >在线</span
                    >
                  </div>
                </div>
              </PTooltip>

              <div class="flex items-center gap-2 group cursor-help">
                <div
                  :class="[
                    'w-3 h-3 pixel-border-mint transition-colors duration-500 animate-pixel-float',
                    getStatusColor(backendStatus)
                  ]"
                ></div>
                <span
                  class="text-xs font-medium text-slate-500 uppercase tracking-tight group-hover:text-emerald-500 transition-colors"
                  >核心服务</span
                >
              </div>
              <div class="w-0.5 h-3 bg-sky-100"></div>
              <div class="flex items-center gap-2 group cursor-help">
                <div
                  :class="[
                    'w-3 h-3 pixel-border-pink transition-colors duration-500 animate-pixel-bounce',
                    getStatusColor(napcatStatus)
                  ]"
                ></div>
                <span
                  class="text-xs font-medium text-slate-500 uppercase tracking-tight group-hover:text-pink-500 transition-colors"
                  >NapCat</span
                >
              </div>
            </div>
          </div>
        </header>

        <!-- 内容区域 -->
        <main class="flex-1 overflow-hidden p-8">
          <div
            v-if="activeTab === 'home'"
            class="h-full flex flex-col gap-6 overflow-y-auto pr-2 pb-6 custom-scrollbar"
          >
            <!-- 状态卡片 -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 shrink-0">
              <div
                class="bg-white pixel-border-mint p-6 transition-all group pixel-hover-lift press-effect"
              >
                <div class="flex items-start justify-between mb-4">
                  <div class="p-3 pixel-border-mint bg-emerald-500/10 text-emerald-500">
                    <PixelIcon name="cpu" size="md" />
                  </div>
                  <span
                    class="text-xs font-mono text-slate-400 group-hover:text-emerald-500 transition-colors"
                    >CPU 负载</span
                  >
                </div>
                <div class="text-2xl font-bold text-slate-700">{{ cpuUsage.toFixed(1) }}%</div>
                <div
                  class="w-full bg-emerald-50 h-4 pixel-border-mint mt-4 overflow-hidden relative group/bar"
                >
                  <div
                    class="bg-emerald-400 h-full transition-all duration-500 shadow-[inset_-2px_-2px_0_0_#059669,inset_2px_2px_0_0_#a7f3d0] relative"
                    :style="{ width: `${Math.min(cpuUsage, 100)}%` }"
                  >
                    <!-- 进度条上的微光 -->
                    <div class="absolute inset-0 bg-white/20 animate-pixel-bg-float"></div>
                  </div>
                </div>
              </div>

              <div
                class="bg-white pixel-border-pink p-6 transition-all group pixel-hover-lift press-effect"
              >
                <div class="flex items-start justify-between mb-4">
                  <div class="p-3 pixel-border-pink bg-pink-500/10 text-pink-500">
                    <PixelIcon name="database" size="md" />
                  </div>
                  <span
                    class="text-xs font-mono text-slate-400 group-hover:text-pink-500 transition-colors"
                    >内存占用</span
                  >
                </div>
                <div class="text-2xl font-bold text-slate-700">
                  {{ (memoryUsed / 1024 / 1024).toFixed(0) }}MB
                </div>
                <div
                  class="w-full bg-pink-50 h-4 pixel-border-pink mt-4 overflow-hidden relative group/bar"
                >
                  <div
                    class="bg-pink-400 h-full transition-all duration-500 shadow-[inset_-2px_-2px_0_0_#db2777,inset_2px_2px_0_0_#fbcfe8] relative"
                    :style="{ width: `${memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0}%` }"
                  >
                    <!-- 进度条上的微光 -->
                    <div class="absolute inset-0 bg-white/20 animate-pixel-bg-float"></div>
                  </div>
                </div>
              </div>

              <div
                class="bg-white pixel-border-yellow p-6 transition-all group md:col-span-2 lg:col-span-1 pixel-hover-lift press-effect"
              >
                <div class="flex items-start justify-between mb-4">
                  <div class="p-3 pixel-border-yellow bg-amber-500/10 text-amber-500">
                    <PixelIcon name="activity" size="md" />
                  </div>
                  <span
                    class="text-xs font-mono text-slate-400 group-hover:text-amber-500 transition-colors"
                    >运行状态</span
                  >
                </div>
                <div class="text-2xl font-bold text-slate-700">
                  {{ isRunning ? '已运行' : '待命' }}
                </div>
                <div class="flex gap-2 mt-4">
                  <div
                    v-for="i in 8"
                    :key="i"
                    :class="[
                      'h-4 flex-1 pixel-border-yellow transition-all duration-300 relative overflow-hidden',
                      i <= (isRunning ? 8 : 2)
                        ? 'bg-yellow-400 shadow-[inset_-2px_-2px_0_0_#eab308,inset_2px_2px_0_0_#fef9c3]'
                        : 'bg-yellow-50'
                    ]"
                  >
                    <!-- 进度条上的微光 -->
                    <div
                      v-if="i <= (isRunning ? 8 : 2)"
                      class="absolute inset-0 bg-white/20 animate-pixel-bg-float"
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 主要启动区域 -->
            <div
              class="shrink-0 min-h-[300px] flex flex-col items-center justify-center gap-8 bg-white/40 pixel-border-sky relative py-10"
            >
              <!-- 背景图案 (像素点) - 更加可爱的颜色 -->
              <div
                class="absolute inset-0 opacity-[0.03] pointer-events-none"
                style="
                  background-image:
                    linear-gradient(
                      45deg,
                      #f472b6 25%,
                      transparent 25%,
                      transparent 75%,
                      #f472b6 75%,
                      #f472b6
                    ),
                    linear-gradient(
                      45deg,
                      #fbbf24 25%,
                      transparent 25%,
                      transparent 75%,
                      #fbbf24 75%,
                      #fbbf24
                    );
                  background-size: 24px 24px;
                  background-position:
                    0 0,
                    12px 12px;
                "
              ></div>

              <!-- 内部小装饰 -->
              <div class="absolute top-4 left-4 text-pink-400/20 animate-pixel-float">
                <PixelIcon name="heart" class="w-6 h-6" />
              </div>
              <div class="absolute bottom-4 right-4 text-sky-400/20 animate-pixel-bounce">
                <PixelIcon name="star" class="w-6 h-6" />
              </div>

              <div class="relative">
                <div
                  v-if="isStarting"
                  class="absolute inset-[-24px] pixel-border-sky border-t-transparent animate-spin"
                ></div>
                <button
                  id="btn-launch-pero"
                  :disabled="isStarting || envStatus === 'error'"
                  :class="[
                    'relative w-32 h-32 md:w-40 md:h-40 flex flex-col items-center justify-center gap-2 transition-all duration-300 group overflow-hidden pixel-hover-lift',
                    isRunning
                      ? 'pixel-btn-red text-white hover:animate-pixel-shake'
                      : envStatus === 'error'
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed opacity-80'
                        : 'pixel-btn-sky text-white'
                  ]"
                  @click="toggleLaunch"
                >
                  <div v-if="envStatus === 'error'" class="flex flex-col items-center gap-1">
                    <PixelIcon name="close" size="xl" />
                    <span class="text-xs font-bold">环境缺失</span>
                  </div>
                  <template v-else>
                    <PixelIcon name="power" class="md:w-12 md:h-12" />
                    <span class="text-xs md:text-sm font-bold uppercase tracking-widest">{{
                      isRunning ? '停止服务' : '启动 Pero'
                    }}</span>
                  </template>
                </button>
              </div>

              <div class="flex flex-col items-center gap-2 px-6">
                <h3 class="text-lg md:text-xl font-bold text-center text-slate-700">
                  {{ isRunning ? AGENT_NAME + ' Core 正在运行' : '准备就绪' }}
                </h3>
                <p class="text-slate-400 text-xs md:text-sm max-w-md text-center">
                  {{
                    isRunning
                      ? isRemoteBackendMode
                        ? '远程后端已连接。角色窗口已激活。'
                        : '所有系统在线。角色窗口已激活。'
                      : isRemoteBackendMode
                        ? '配置服务器地址后，Windows 端将只连接远程后端并打开角色窗口。'
                        : '点击上方按钮初始化所有后端服务及角色窗口。'
                  }}
                </p>
              </div>

              <div class="w-full max-w-2xl px-6 relative z-10 space-y-4">
                <div class="grid grid-cols-2 gap-3">
                  <button
                    class="px-4 py-3 text-xs font-black tracking-widest transition-all pixel-hover-lift"
                    :class="
                      !isRemoteBackendMode
                        ? 'pixel-btn-sky text-white'
                        : 'bg-white text-slate-500 pixel-border-sky hover:text-sky-500'
                    "
                    @click="setBackendMode('local')"
                  >
                    本地后端
                  </button>
                  <button
                    class="px-4 py-3 text-xs font-black tracking-widest transition-all pixel-hover-lift"
                    :class="
                      isRemoteBackendMode
                        ? 'pixel-btn-indigo text-white'
                        : 'bg-white text-slate-500 pixel-border-indigo hover:text-indigo-500'
                    "
                    @click="setBackendMode('remote')"
                  >
                    远程服务器
                  </button>
                </div>

                <div
                  v-if="isRemoteBackendMode"
                  class="bg-white/85 pixel-border-indigo p-4 flex flex-col gap-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-xs font-black tracking-widest text-indigo-500">SERVER URL</div>
                      <div class="text-[11px] text-slate-400 mt-1">
                        例如：`https://your-app.com`
                      </div>
                      <div class="text-[11px] text-slate-400 mt-1">
                        如果服务器设置了 `PERO_DESKTOP_API_KEY`，请在下方填写相同密钥。
                      </div>
                    </div>
                    <span
                      class="px-3 py-1 text-[10px] font-black tracking-widest pixel-border-indigo bg-indigo-50 text-indigo-500"
                    >
                      REMOTE
                    </span>
                  </div>

                  <div class="flex flex-col md:flex-row gap-3">
                    <input
                      v-model="remoteBackendUrlInput"
                      type="text"
                      class="flex-1 px-4 py-3 bg-white pixel-border-indigo text-sm text-slate-700 outline-none"
                      placeholder="https://your-app.com"
                      @keydown.enter.prevent="saveRemoteBackendUrl"
                      @blur="saveRemoteBackendUrl"
                    />
                    <button
                      class="px-5 py-3 pixel-btn-indigo text-white text-xs font-black tracking-widest pixel-hover-lift"
                      @click="saveRemoteBackendUrl"
                    >
                      保存远程配置
                    </button>
                  </div>

                  <input
                    v-model="remoteBackendApiKeyInput"
                    type="password"
                    class="w-full px-4 py-3 bg-white pixel-border-indigo text-sm text-slate-700 outline-none"
                    placeholder="桌面访问密钥（可选，对应服务端 PERO_DESKTOP_API_KEY）"
                    autocomplete="off"
                    @keydown.enter.prevent="saveRemoteBackendUrl"
                    @blur="saveRemoteBackendUrl"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 角色标签页 -->
          <div v-if="activeTab === 'agents'" class="h-full flex flex-col gap-6">
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
                      <PixelIcon :name="isLoadingAgents ? 'sparkle' : 'search'" size="md" />
                    </div>
                  </button>
                </PTooltip>
                <div
                  class="px-4 py-1.5 pixel-border-sky bg-sky-500/10 text-[10px] font-bold text-sky-500 uppercase tracking-widest"
                >
                  {{ `Local: ${agentList.length}` }}
                </div>
              </div>
            </div>

            <div
              v-if="agentList.length === 0"
              class="flex-1 flex flex-col items-center justify-center text-slate-400 gap-6 bg-white/30 pixel-border-sky m-2"
            >
              <div class="p-8 bg-white pixel-border-sky">
                <PixelIcon name="users" class="w-16 h-16 text-sky-200" />
              </div>
              <div class="text-center">
                <h3 class="text-xl font-bold text-slate-600 mb-2">这里空空如也哦~</h3>
                <p class="text-sm text-slate-400 max-w-xs leading-relaxed">
                  请检查
                  <code class="bg-sky-50 px-1.5 py-0.5 pixel-border-sky text-sky-600 font-mono"
                    >backend/services/mdp/agents</code
                  >
                  目录，看看是不是还没搬家过来？
                </p>
              </div>
            </div>

            <div
              v-else
              class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pr-2 custom-scrollbar p-2"
            >
              <div
                v-for="(agent, idx) in agentList"
                :key="agent.id"
                class="p-8 transition-all duration-300 group relative overflow-hidden flex flex-col pixel-hover-lift press-effect"
                :class="[
                  agent.is_active
                    ? 'pixel-border-sky bg-sky-50/50 hover:bg-sky-100/50'
                    : !agent.is_enabled
                      ? 'bg-slate-50 pixel-border-sm opacity-60 grayscale hover:opacity-80'
                      : idx % 4 === 0
                        ? 'pixel-border-indigo bg-white hover:bg-indigo-50/50'
                        : idx % 4 === 1
                          ? 'pixel-border-pink bg-white hover:bg-pink-50/50'
                          : idx % 4 === 2
                            ? 'pixel-border-yellow bg-white hover:bg-yellow-50/50'
                            : 'pixel-border-mint bg-white hover:bg-emerald-50/50'
                ]"
              >
                <!-- 活跃指示器装饰 -->
                <div
                  v-if="agent.is_active"
                  class="absolute -right-6 -top-6 w-20 h-20 bg-sky-500 pixel-border-sky rotate-45 flex items-end justify-center pb-2 text-white shadow-lg z-20"
                >
                  <PixelIcon name="star" class="w-4 h-4 animate-pixel-float" />
                </div>

                <div class="flex items-start justify-between mb-8 relative z-10">
                  <div class="flex items-center gap-5">
                    <div
                      class="w-16 h-16 pixel-border-sky flex items-center justify-center text-white font-black text-2xl transition-all duration-300 relative group-hover:scale-110 overflow-hidden"
                      :class="
                        agent.is_active
                          ? 'bg-sky-500'
                          : agent.is_enabled
                            ? 'bg-sky-400'
                            : 'bg-slate-300'
                      "
                    >
                      <img
                        v-if="agent.avatarUrl"
                        :src="agent.avatarUrl"
                        class="w-full h-full object-cover"
                        alt="Avatar"
                      />
                      <template v-else>
                        {{ agent.name ? agent.name[0].toUpperCase() : '?' }}
                      </template>
                      <div
                        v-if="agent.is_active"
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
                        >{{ agent.id }}</span
                      >
                    </div>
                  </div>
                  <div class="relative pt-1 px-1">
                    <input
                      :id="'check-' + agent.id"
                      type="checkbox"
                      :checked="agent.is_enabled"
                      class="peer sr-only"
                      @change="toggleAgentEnabled(agent)"
                    />
                    <label
                      :for="'check-' + agent.id"
                      class="block w-14 h-7 bg-slate-200 pixel-border-sky cursor-pointer transition-all duration-300 peer-checked:bg-pink-500 relative"
                    >
                      <div
                        class="absolute left-1.5 top-1.5 w-4 h-4 bg-white pixel-border-sm transition-transform duration-300 transition-pixel peer-checked:translate-x-7"
                      ></div>
                    </label>
                  </div>
                </div>

                <p
                  class="text-slate-500 text-xs leading-relaxed line-clamp-2 h-9 mb-6 relative z-10 px-1 font-medium"
                >
                  {{ agent.description || '这只 AI 角色还在完善它的自我介绍哦~' }}
                </p>

                <div
                  class="flex items-center justify-between mt-auto pt-4 border-t border-sky-100/30 relative z-10"
                >
                  <span
                    class="text-[10px] uppercase font-bold tracking-wider flex items-center gap-2"
                    :class="
                      agent.is_active
                        ? 'text-pink-500'
                        : agent.is_enabled
                          ? 'text-slate-400'
                          : 'text-slate-300'
                    "
                  >
                    <div class="flex items-center gap-2">
                      <PixelIcon
                        name="heart"
                        :class="
                          agent.is_active
                            ? 'text-pink-500 animate-pixel-bounce w-2.5 h-2.5'
                            : 'text-slate-300 w-2.5 h-2.5'
                        "
                      />
                      {{
                        agent.is_active ? '正在活跃中' : agent.is_enabled ? '准备就绪' : '休息中'
                      }}
                    </div>
                  </span>

                  <!-- 仅在已启用但未活跃时显示“设为活跃” -->
                  <button
                    v-if="agent.is_enabled && !agent.is_active"
                    class="text-[10px] px-5 py-2 pixel-btn-pink font-black uppercase tracking-widest"
                    @click="setAsActive(agent)"
                  >
                    召唤它！
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 插件标签页 -->
          <div v-if="activeTab === 'plugins'" class="h-full flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 pixel-border-sky bg-indigo-500 flex items-center justify-center text-white"
                >
                  <PixelIcon name="plug" size="md" />
                </div>
                <div>
                  <h2 class="text-xl font-bold tracking-tight text-slate-800">插件管理</h2>
                  <p class="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-0.5">
                    Plugin Ecosystem
                  </p>
                </div>
              </div>
              <div
                class="px-4 py-1.5 pixel-border-sky bg-indigo-500/10 text-[10px] font-bold text-indigo-500 uppercase tracking-widest"
              >
                总计: {{ plugins.length }}
              </div>
            </div>

            <div
              v-if="plugins.length > 0"
              class="grid grid-cols-1 gap-6 overflow-y-auto pr-2 custom-scrollbar p-2"
            >
              <div
                v-for="(plugin, index) in plugins"
                :key="plugin.name"
                class="bg-white p-5 md:p-8 pb-7 md:pb-10 transition-all duration-300 group relative pixel-hover-lift press-effect min-w-0"
                :class="[
                  plugin.valid
                    ? index % 4 === 0
                      ? 'pixel-border-indigo hover:bg-indigo-50/50'
                      : index % 4 === 1
                        ? 'pixel-border-pink hover:bg-pink-50/50'
                        : index % 4 === 2
                          ? 'pixel-border-yellow hover:bg-yellow-50/50'
                          : 'pixel-border-mint hover:bg-emerald-50/50'
                    : 'pixel-border-sm grayscale opacity-60'
                ]"
              >
                <div
                  class="flex flex-col sm:flex-row justify-between items-start gap-4 mb-2 relative z-10"
                >
                  <div class="flex items-center gap-3 md:gap-5">
                    <div
                      class="p-3 md:p-5 pixel-border-sky bg-sky-50 text-sky-500 group-hover:scale-105 transition-all duration-300"
                    >
                      <PixelIcon name="plug" size="lg" class="md:w-7 md:h-7" />
                    </div>
                    <div>
                      <h3
                        class="font-bold text-lg md:text-xl text-slate-700 group-hover:text-sky-600 transition-colors"
                      >
                        {{ plugin.displayName || plugin.name }}
                      </h3>
                      <div
                        class="flex items-center gap-2 md:gap-3 text-[10px] md:text-xs text-slate-400 font-mono mt-1 md:mt-1.5"
                      >
                        <span
                          class="bg-sky-50 px-2 py-0.5 md:px-3 md:py-1 pixel-border-sky text-sky-500 font-bold"
                          >v{{ plugin.version }}</span
                        >
                        <span
                          class="px-2 py-0.5 md:px-3 md:py-1 pixel-border-sky bg-slate-50 opacity-70"
                          >{{ plugin.pluginType }}</span
                        >
                      </div>
                    </div>
                  </div>
                  <div
                    class="px-3 py-1.5 md:px-5 md:py-2 text-[9px] md:text-[10px] font-bold uppercase tracking-widest self-end sm:self-start"
                    :class="
                      plugin.valid
                        ? 'pixel-border-emerald bg-emerald-50 text-emerald-500'
                        : 'pixel-border-sm bg-rose-50 text-rose-500'
                    "
                  >
                    <span class="flex items-center gap-2">
                      <PixelIcon
                        v-if="plugin.valid"
                        name="mood-happy"
                        class="w-3 h-3 text-emerald-500 animate-pixel-float"
                      />
                      <PixelIcon v-else name="close" class="w-3 h-3 text-rose-500" />
                      {{ plugin.valid ? '正常运行' : '加载失败' }}
                    </span>
                  </div>
                </div>
                <p
                  class="text-sm text-slate-500 mt-5 leading-relaxed relative z-10 px-1 opacity-80 break-words"
                >
                  {{ plugin.description || '这个插件还没有写它的功能介绍哦~' }}
                </p>

                <!-- 指令 -->
                <div
                  v-if="plugin.capabilities?.invocationCommands?.length"
                  class="mt-8 pt-6 border-t-2 border-sky-100 relative z-10"
                >
                  <p
                    class="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4 px-1"
                  >
                    <PixelIcon name="terminal" class="w-3 h-3 text-sky-400" /> 可用指令集
                  </p>
                  <div class="flex flex-wrap gap-2 md:gap-3 w-full min-w-0 pb-1 px-0.5">
                    <PTooltip
                      v-for="cmd in plugin.capabilities.invocationCommands"
                      :key="cmd.commandIdentifier"
                      :content="cmd.description"
                      class="min-w-0"
                    >
                      <span
                        class="px-3 py-1.5 md:px-5 md:py-2.5 bg-white pixel-border-sky text-[10px] md:text-xs font-mono text-sky-600 hover:bg-sky-500 hover:text-white transition-all cursor-help flex items-center gap-2 group/cmd max-w-full"
                      >
                        <span
                          class="w-1.5 h-1.5 shrink-0 pixel-border-sky bg-sky-300 group-hover/cmd:bg-white transition-colors"
                        ></span>
                        <span class="truncate">{{ cmd.commandIdentifier }}</span>
                      </span>
                    </PTooltip>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-else
              class="flex-1 flex flex-col items-center justify-center text-slate-400 gap-6 bg-white/30 pixel-border-sky m-2"
            >
              <div class="p-8 bg-white pixel-border-sky">
                <PixelIcon name="plug" class="w-16 h-16 text-indigo-200" />
              </div>
              <div class="text-center">
                <h3 class="text-xl font-bold text-slate-600 mb-2">未检测到插件</h3>
                <p class="text-sm text-slate-400 max-w-xs leading-relaxed">
                  快去给你的 AI 角色装载一些有趣的技能包吧！
                </p>
              </div>
            </div>
          </div>

          <!-- 环境标签页 -->
          <div v-if="activeTab === 'environment'" class="h-full flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 pixel-border-sky bg-emerald-500 flex items-center justify-center text-white"
                >
                  <PixelIcon name="activity" size="md" />
                </div>
                <div>
                  <h2 class="text-xl font-bold tracking-tight text-slate-800">环境检测</h2>
                  <p class="text-[10px] text-slate-400 font-mono uppercase tracking-widest mt-0.5">
                    Environment Diagnostics
                  </p>
                </div>
              </div>
              <div
                class="flex items-center gap-2 px-4 py-1.5 pixel-border-sky text-[10px] font-bold uppercase tracking-widest transition-all"
                :class="{
                  'bg-emerald-50 text-emerald-600': envStatus === 'ok',
                  'bg-amber-50 text-amber-600': envStatus === 'warning',
                  'bg-rose-50 text-rose-600': envStatus === 'error',
                  'bg-sky-50 text-slate-500': envStatus === 'checking'
                }"
              >
                <div
                  class="w-2.5 h-2.5 pixel-border-sky"
                  :class="{
                    'bg-emerald-500': envStatus === 'ok',
                    'bg-amber-500': envStatus === 'warning',
                    'bg-rose-500': envStatus === 'error',
                    'bg-sky-400': envStatus === 'checking'
                  }"
                ></div>
                {{
                  envStatus === 'checking'
                    ? '正在检测...'
                    : envStatus === 'ok'
                      ? '环境就绪'
                      : envStatus === 'warning'
                        ? '部分就绪'
                        : '环境异常'
                }}
              </div>
            </div>

            <div v-if="envReport" class="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-8">
              <!-- 关键组件 -->
              <div class="space-y-6">
                <div class="flex items-center justify-between px-3 mb-4">
                  <h3
                    class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2"
                  >
                    <PixelIcon name="shield" class="w-3 h-3 text-sky-400" /> 核心运行时 (必需组件)
                  </h3>
                  <div class="flex gap-1">
                    <div
                      v-for="i in 3"
                      :key="i"
                      class="w-1.5 h-1.5 bg-sky-200 pixel-border-sm"
                    ></div>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-5 p-2">
                  <!-- Python 环境 -->
                  <div
                    class="bg-white p-6 pixel-border-yellow flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-yellow bg-amber-50 text-amber-600 group-hover:scale-105 transition-all duration-300"
                      >
                        <PixelIcon name="code" size="lg" />
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-amber-600 transition-colors"
                        >
                          Python 运行时
                        </div>
                        <div
                          class="text-xs text-slate-400 font-mono mt-1.5 flex items-center gap-2"
                        >
                          <span
                            class="w-1.5 h-1.5 bg-amber-400 pixel-border-yellow animate-pixel-float"
                          ></span>
                          {{
                            envReport.python_exists
                              ? `v${envReport.python_version}`
                              : '未检测到环境'
                          }}
                        </div>
                      </div>
                    </div>
                    <!-- 装饰气泡 -->
                    <div
                      class="absolute -top-1 right-24 bg-white pixel-border-sm px-2 py-0.5 text-[8px] font-bold text-amber-500 animate-pixel-float opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Meow~
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <PTooltip :content="envReport.python_path || '未找到路径'">
                        <span
                          class="text-[10px] font-mono text-slate-400 hidden md:inline-block max-w-[150px] truncate bg-amber-50/50 px-3 py-1.5 pixel-border-yellow"
                        >
                          {{ envReport.python_path || 'PATH' }}
                        </span>
                      </PTooltip>
                      <div
                        class="p-2 bg-white pixel-border-yellow group-hover:scale-110 transition-transform"
                      >
                        <PixelIcon
                          v-if="envReport.python_exists"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-float"
                        />
                        <PixelIcon v-else name="close" size="lg" class="text-rose-400" />
                      </div>
                    </div>
                  </div>

                  <!-- 后端脚本 -->
                  <div
                    class="bg-white p-6 pixel-border-indigo flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-indigo bg-indigo-50 text-indigo-600 group-hover:scale-105 transition-all duration-300"
                      >
                        <PixelIcon name="file" size="lg" />
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-indigo-600 transition-colors"
                        >
                          后端核心脚本
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-indigo-400 pixel-border-indigo animate-pixel-bounce"
                          ></span>
                          main.py 入口文件检查
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div
                        class="p-2 bg-white pixel-border-indigo group-hover:scale-110 transition-transform"
                      >
                        <PixelIcon
                          v-if="envReport.script_exists"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-bounce"
                        />
                        <PixelIcon v-else name="close" size="lg" class="text-rose-400" />
                      </div>
                    </div>
                  </div>

                  <!-- VC++ 运行库 -->
                  <div
                    class="bg-white p-6 pixel-border-pink flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-pink bg-pink-50 text-pink-600 group-hover:scale-105 transition-all duration-300 relative"
                      >
                        <PixelIcon name="database" size="lg" />
                        <div class="absolute -top-1 -right-1 text-pink-300 animate-pixel-float">
                          <PixelIcon name="heart" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-pink-600 transition-colors"
                        >
                          Visual C++ 运行库
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-pink-400 pixel-border-pink animate-pixel-float"
                          ></span>
                          VCRUNTIME140.dll
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div v-if="!envReport.vc_redist_installed" class="flex items-center gap-3">
                        <a
                          href="https://aka.ms/vs/17/release/vc_redist.x64.exe"
                          target="_blank"
                          class="text-xs text-pink-500 hover:text-pink-600 font-bold bg-pink-50 px-4 py-2 pixel-border-pink transition-all pixel-hover-lift"
                          >点击安装</a
                        >
                      </div>
                      <div
                        class="p-2 bg-white pixel-border-pink group-hover:scale-110 transition-transform"
                      >
                        <PixelIcon
                          v-if="envReport.vc_redist_installed"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-float"
                        />
                        <PixelIcon v-else name="close" size="lg" class="text-rose-400" />
                      </div>
                    </div>
                  </div>

                  <!-- 数据目录 -->
                  <div
                    class="bg-white p-6 pixel-border-mint flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-mint bg-emerald-50 text-emerald-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="folder" size="lg" />
                        <div
                          class="absolute -bottom-1 -left-1 text-emerald-300 animate-pixel-bounce"
                        >
                          <PixelIcon name="star" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-emerald-600 transition-colors"
                        >
                          数据目录权限
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-emerald-400 pixel-border-mint animate-pixel-bounce"
                          ></span>
                          读写访问权限检查
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div class="p-2 bg-white pixel-border-mint transition-transform">
                        <PixelIcon
                          v-if="envReport.data_dir_writable"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-bounce"
                        />
                        <PixelIcon v-else name="close" size="lg" class="text-rose-400" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 可选组件 -->
              <div class="space-y-6 pb-8">
                <div class="flex items-center justify-between px-3 mb-4">
                  <h3
                    class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2"
                  >
                    <PixelIcon name="sparkle" class="w-3 h-3 text-amber-400" /> 扩展功能组件 (可选)
                  </h3>
                  <div class="flex gap-1">
                    <div
                      v-for="i in 3"
                      :key="i"
                      class="w-1.5 h-1.5 bg-amber-200 pixel-border-sm"
                    ></div>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-5 p-2">
                  <!-- WebView2 组件 -->
                  <div
                    class="bg-white p-6 pixel-border-mint flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-mint bg-emerald-50 text-emerald-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="layout" size="lg" />
                        <div class="absolute -top-1 -left-1 text-emerald-400 animate-pixel-float">
                          <PixelIcon name="mood-happy" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-emerald-600 transition-colors"
                        >
                          Edge WebView2
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-emerald-400 pixel-border-mint animate-pixel-float"
                          ></span>
                          UI 渲染引擎支持
                        </div>
                      </div>
                    </div>
                    <!-- 装饰气泡 -->
                    <div
                      class="absolute -top-1 right-24 bg-white pixel-border-sm px-2 py-0.5 text-[8px] font-bold text-emerald-500 animate-pixel-float opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Nice~
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div class="p-2 bg-white pixel-border-mint transition-transform">
                        <PixelIcon
                          v-if="envReport.webview2_installed"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-bounce"
                        />
                        <PTooltip v-else content="缺失可能导致界面无法显示">
                          <PixelIcon
                            name="alert"
                            size="lg"
                            class="text-amber-400 animate-pixel-shake"
                          />
                        </PTooltip>
                      </div>
                    </div>
                  </div>

                  <!-- Node.js 环境 -->
                  <div
                    class="bg-white p-6 pixel-border-yellow flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-yellow bg-amber-50 text-amber-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="terminal" size="lg" />
                        <div
                          class="absolute -bottom-1 -right-1 text-amber-400 animate-pixel-bounce"
                        >
                          <PixelIcon name="flash" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-amber-600 transition-colors"
                        >
                          Node.js 运行时
                        </div>
                        <div
                          class="text-xs text-slate-400 font-mono mt-1.5 flex items-center gap-2"
                        >
                          <span
                            class="w-1.5 h-1.5 bg-amber-400 pixel-border-yellow animate-pixel-bounce"
                          ></span>
                          {{
                            envReport.node_exists ? `v${envReport.node_version}` : '未检测到环境'
                          }}
                        </div>
                      </div>
                    </div>
                    <!-- 装饰气泡 -->
                    <div
                      class="absolute -top-1 right-24 bg-white pixel-border-sm px-2 py-0.5 text-[8px] font-bold text-amber-500 animate-pixel-bounce opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Power!
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <PTooltip :content="envReport.node_path || 'PATH NOT FOUND'">
                        <span
                          class="text-[10px] font-mono text-slate-400 hidden md:inline-block max-w-[150px] truncate bg-amber-50/50 px-3 py-1.5 pixel-border-yellow"
                        >
                          {{ envReport.node_path || 'PATH' }}
                        </span>
                      </PTooltip>
                      <div class="p-2 bg-white pixel-border-yellow transition-transform">
                        <PixelIcon
                          v-if="envReport.node_exists"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-float"
                        />
                        <PTooltip v-else content="NapCat 依赖此组件">
                          <PixelIcon
                            name="alert"
                            size="lg"
                            class="text-amber-400 animate-pixel-shake"
                          />
                        </PTooltip>
                      </div>
                    </div>
                  </div>

                  <!-- NapCat 组件 -->
                  <div
                    class="bg-white p-6 pixel-border-pink flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-pink bg-pink-50 text-pink-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="chat" size="lg" />
                        <div class="absolute -top-1 -right-1 text-pink-300 animate-pixel-float">
                          <PixelIcon name="cat" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-pink-600 transition-colors"
                        >
                          NapCat 适配器
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-pink-400 pixel-border-pink animate-pixel-float"
                          ></span>
                          QQ 协议支持组件
                        </div>
                      </div>
                    </div>
                    <!-- 装饰气泡 -->
                    <div
                      class="absolute -top-1 right-24 bg-white pixel-border-sm px-2 py-0.5 text-[8px] font-bold text-pink-500 animate-pixel-float opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Social!
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <span
                        v-if="!isSocialEnabled"
                        class="text-[10px] uppercase font-bold text-slate-400 bg-pink-50/50 px-4 py-2 pixel-border-pink"
                        >已禁用</span
                      >
                      <div v-else class="p-2 bg-white pixel-border-pink transition-transform">
                        <PixelIcon
                          v-if="envReport.napcat_installed"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-bounce"
                        />
                        <div v-else class="flex items-center gap-3">
                          <span
                            class="text-[10px] text-amber-500 font-bold uppercase tracking-wider"
                            >未安装</span
                          >
                          <PixelIcon
                            name="alert"
                            size="lg"
                            class="text-amber-400 animate-pixel-shake"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 9120 端口 -->
                  <div
                    class="bg-white p-6 pixel-border-yellow flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-yellow bg-amber-50 text-amber-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="activity" size="lg" />
                        <div class="absolute -top-1 -right-1 text-amber-300 animate-pixel-float">
                          <PixelIcon name="flash" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-amber-600 transition-colors"
                        >
                          API 服务端口 (9120)
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-amber-400 pixel-border-yellow animate-pixel-bounce"
                          ></span>
                          核心服务监听端口
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div class="p-2 bg-white pixel-border-yellow transition-transform">
                        <PixelIcon
                          v-if="envReport.port_9120_free"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-float"
                        />
                        <div v-else class="flex items-center gap-3">
                          <span class="text-[10px] text-rose-400 font-bold uppercase tracking-wider"
                            >已占用</span
                          >
                          <PixelIcon
                            name="close"
                            size="lg"
                            class="text-rose-400 animate-pixel-shake"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 记忆核心 -->
                  <div
                    class="bg-white p-6 pixel-border-indigo flex items-center justify-between group transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
                  >
                    <div class="flex items-center gap-6 relative z-10">
                      <div
                        class="p-5 pixel-border-indigo bg-indigo-50 text-indigo-600 transition-all duration-300 relative"
                      >
                        <PixelIcon name="cpu" size="lg" />
                        <div
                          class="absolute -bottom-1 -left-1 text-indigo-300 animate-pixel-bounce"
                        >
                          <PixelIcon name="star" class="w-3 h-3" />
                        </div>
                      </div>
                      <div>
                        <div
                          class="font-bold text-xl text-slate-700 group-hover:text-indigo-600 transition-colors"
                        >
                          TriviumDB Core
                        </div>
                        <div class="text-xs text-slate-400 mt-1.5 flex items-center gap-2">
                          <span
                            class="w-1.5 h-1.5 bg-indigo-400 pixel-border-indigo animate-pixel-float"
                          ></span>
                          极速向量与图谱引擎
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-5 relative z-10">
                      <div
                        class="p-2 bg-white pixel-border-indigo group-hover:scale-110 transition-transform"
                      >
                        <PixelIcon
                          v-if="envReport.core_available"
                          name="check"
                          size="lg"
                          class="text-emerald-400 animate-pixel-bounce"
                        />
                        <PTooltip v-else content="核心组件缺失，性能将受限">
                          <PixelIcon
                            name="alert"
                            size="lg"
                            class="text-amber-400 animate-pixel-shake"
                          />
                        </PTooltip>
                      </div>
                    </div>
                  </div>

                  <!-- AI 模型组件 -->
                  <div
                    class="bg-white p-8 pixel-border-indigo flex flex-col gap-6 group transition-all duration-300 relative overflow-hidden pixel-hover-lift"
                  >
                    <!-- 背景装饰 -->
                    <div
                      class="absolute -bottom-4 -right-4 text-indigo-50/50 pointer-events-none rotate-12"
                    >
                      <PixelIcon name="brain" class="w-[120px] h-[120px]" />
                    </div>

                    <div class="flex items-center justify-between relative z-10">
                      <div class="flex items-center gap-6">
                        <div
                          class="p-5 pixel-border-indigo bg-indigo-500 text-white group-hover:scale-105 transition-all duration-300 relative"
                        >
                          <PixelIcon name="brain" size="xl" />
                          <div class="absolute -top-2 -right-2 text-amber-300 animate-pixel-float">
                            <PixelIcon name="sparkle" class="w-4 h-4" />
                          </div>
                        </div>
                        <div>
                          <div
                            class="font-bold text-2xl text-slate-700 group-hover:text-indigo-600 transition-colors"
                          >
                            AI 推理模型组件
                          </div>
                          <div class="text-xs text-slate-400 mt-2 flex items-center gap-2">
                            <span
                              class="w-1.5 h-1.5 bg-indigo-400 pixel-border-indigo animate-pixel-float"
                            ></span>
                            Embedding / Whisper
                          </div>
                        </div>
                      </div>
                      <div class="flex items-center gap-4">
                        <button
                          v-if="!allModelsExist"
                          :disabled="isDownloadingModels"
                          class="px-8 py-3 pixel-btn-pink text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-3 pixel-hover-lift press-effect"
                          @click="downloadModels"
                        >
                          <PixelIcon
                            v-if="!isDownloadingModels"
                            name="download"
                            class="w-[18px] h-[18px]"
                          />
                          <span
                            v-else
                            class="w-4 h-4 border-2 border-white/30 border-t-white animate-spin"
                          ></span>
                          {{ isDownloadingModels ? '正在极速部署...' : '一键极速部署' }}
                        </button>
                        <div
                          v-else
                          class="p-2 bg-white pixel-border-mint group-hover:scale-110 transition-transform"
                        >
                          <PixelIcon
                            name="check"
                            size="lg"
                            class="text-emerald-400 animate-pixel-bounce"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- 模型详细状态 -->
                    <div class="grid grid-cols-2 gap-6 mt-2 relative z-10">
                      <div
                        class="flex flex-col items-center gap-3 text-[10px] bg-white p-4 pixel-border-mint hover:bg-emerald-50 transition-all group/model pixel-hover-lift"
                      >
                        <div
                          class="w-2.5 h-2.5 pixel-border-mint mb-1 transition-transform"
                          :class="
                            envReport.embedding_model_exists
                              ? 'bg-emerald-400 animate-pixel-float'
                              : 'bg-rose-300'
                          "
                        ></div>
                        <span
                          class="font-bold tracking-[0.1em] transition-colors"
                          :class="
                            envReport.embedding_model_exists ? 'text-slate-600' : 'text-slate-400'
                          "
                          >EMBEDDING</span
                        >
                      </div>
                      <div
                        class="flex flex-col items-center gap-3 text-[10px] bg-white p-4 pixel-border-pink hover:bg-pink-50 transition-all group/model pixel-hover-lift"
                      >
                        <div
                          class="w-2.5 h-2.5 pixel-border-pink mb-1 transition-transform"
                          :class="
                            envReport.whisper_model_exists
                              ? 'bg-emerald-400 animate-pixel-float'
                              : 'bg-rose-300'
                          "
                        ></div>
                        <span
                          class="font-bold tracking-[0.1em] transition-colors"
                          :class="
                            envReport.whisper_model_exists ? 'text-slate-600' : 'text-slate-400'
                          "
                          >WHISPER</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 错误日志 -->
              <div
                v-if="envReport.errors && envReport.errors.length > 0"
                class="p-8 bg-rose-50 pixel-border-pink relative overflow-hidden group"
              >
                <h3
                  class="text-sm font-bold text-rose-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-3 relative z-10"
                >
                  <div class="p-2 pixel-border-pink bg-rose-100 text-rose-500 animate-pixel-bounce">
                    <PixelIcon name="alert" class="w-[18px] h-[18px]" />
                  </div>
                  运行环境异常详情
                </h3>
                <ul class="space-y-3 relative z-10">
                  <li
                    v-for="(err, idx) in envReport.errors"
                    :key="idx"
                    class="text-xs text-rose-600/80 font-medium bg-white p-3 pixel-border-pink flex items-start gap-3 hover:bg-rose-100/50 transition-all group/item"
                  >
                    <span
                      class="mt-1.5 w-1.5 h-1.5 pixel-border-pink bg-rose-400 group-hover/item:scale-110 transition-transform animate-pixel-float"
                    ></span>
                    <span class="leading-relaxed">{{ err }}</span>
                  </li>
                </ul>
              </div>
            </div>

            <div v-else class="flex-1 flex items-center justify-center">
              <div class="flex flex-col items-center gap-4 text-slate-400">
                <div class="w-12 h-12 pixel-border-sky border-t-sky-500 animate-spin"></div>
                <span class="text-sm font-medium animate-pulse">正在全面检测运行环境...</span>
              </div>
            </div>
          </div>

          <!-- 工具标签页 -->
          <div v-if="activeTab === 'tools'" class="h-full flex flex-col gap-8 relative">
            <div class="flex items-center justify-between relative z-10">
              <div class="flex items-center gap-5">
                <div
                  class="w-14 h-14 pixel-border-sky bg-amber-500 flex items-center justify-center text-white"
                >
                  <PixelIcon name="layout" size="lg" />
                </div>
                <div>
                  <h2
                    class="text-3xl font-black tracking-tight text-slate-800 flex items-center gap-3"
                  >
                    内置工具箱
                    <span
                      class="text-xs font-bold bg-amber-100 text-amber-600 px-3 py-1 pixel-border-sky"
                      >BETA</span
                    >
                  </h2>
                  <p
                    class="text-[11px] text-slate-400 font-mono uppercase tracking-[0.3em] mt-1 opacity-80"
                  >
                    Internal Utility Toolset
                  </p>
                </div>
              </div>
              <div
                class="px-6 py-2.5 pixel-border-sky bg-white text-[10px] font-black text-sky-500 uppercase tracking-[0.2em]"
              >
                <span class="flex items-center gap-2">
                  <span class="w-2 h-2 pixel-border-sky bg-sky-400"></span>
                  本地环境已就绪
                </span>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-8 p-1 relative z-10">
              <!-- Everything 搜索 -->
              <div
                class="bg-white p-10 pixel-border-sky hover:bg-sky-50/50 transition-all duration-300 group relative overflow-hidden pixel-hover-lift press-effect"
              >
                <!-- 背景装饰 -->
                <div class="absolute -top-6 -left-6 text-sky-50/50 pointer-events-none -rotate-12">
                  <PixelIcon name="search" class="w-[120px] h-[120px]" />
                </div>
                <div class="absolute top-2 right-2 text-sky-100/30 pointer-events-none">
                  <PixelIcon name="cat" class="w-10 h-10" />
                </div>
                <div
                  class="absolute bottom-0 right-0 p-10 opacity-[0.03] group-hover:opacity-10 transition-opacity pointer-events-none text-sky-500 scale-150"
                >
                  <PixelIcon name="search" class="w-[120px] h-[120px]" />
                </div>

                <div class="relative z-10">
                  <div
                    class="w-20 h-20 pixel-border-sky bg-sky-50 text-sky-500 flex items-center justify-center mb-8 transition-all duration-300 relative"
                  >
                    <PixelIcon name="search" size="2xl" />
                    <PixelIcon
                      name="star"
                      class="absolute -top-2 -right-2 text-amber-400 animate-pixel-float w-4 h-4"
                    />
                  </div>
                  <h3
                    class="text-2xl font-black mb-3 text-slate-700 group-hover:text-sky-600 transition-colors tracking-tight"
                  >
                    Everything 搜索
                  </h3>
                  <p class="text-sm text-slate-500 mb-10 leading-relaxed opacity-80 font-medium">
                    极致轻快的本地文件索引工具，秒级定位相关资源。
                  </p>
                  <div class="flex items-center justify-between mt-auto">
                    <span
                      class="text-[10px] font-black uppercase tracking-[0.2em] px-5 py-2 pixel-border-sky transition-all duration-300 flex items-center gap-2"
                      :class="
                        esStatus === 'INSTALLED'
                          ? 'text-emerald-500 bg-white'
                          : 'text-slate-400 bg-slate-50'
                      "
                    >
                      <PixelIcon
                        v-if="esStatus === 'INSTALLED'"
                        name="heart"
                        class="text-emerald-400 w-2.5 h-2.5"
                      />
                      {{ esStatus === 'INSTALLED' ? '已深度集成' : '· 集成组件' }}
                    </span>
                    <button
                      :disabled="isInstallingES || esStatus === 'INSTALLED'"
                      class="px-8 py-3 pixel-btn-sky text-xs font-black transition-all disabled:opacity-50 pixel-hover-lift press-effect"
                      :class="esStatus === 'INSTALLED' ? 'bg-slate-100 text-slate-400' : ''"
                      @click="installES"
                    >
                      {{
                        isInstallingES
                          ? '安装中...'
                          : esStatus === 'INSTALLED'
                            ? '已安装'
                            : '检查/安装'
                      }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- NapCat 社交适配器 -->
              <div
                :class="[
                  'bg-white p-10 pixel-border-pink transition-all duration-300 group relative overflow-hidden pixel-hover-lift press-effect',
                  isRemoteBackendMode ? 'opacity-70' : 'hover:bg-pink-50/50'
                ]"
              >
                <!-- 背景装饰 -->
                <div class="absolute -top-6 -left-6 text-pink-50/50 pointer-events-none -rotate-12">
                  <PixelIcon name="chat" class="w-[120px] h-[120px]" />
                </div>
                <div
                  class="absolute bottom-0 right-0 p-10 opacity-[0.03] group-hover:opacity-10 transition-opacity pointer-events-none text-pink-500 scale-150"
                >
                  <PixelIcon name="chat" class="w-[120px] h-[120px]" />
                </div>

                <div class="relative z-10">
                  <div
                    class="w-20 h-20 pixel-border-pink bg-pink-50 text-pink-500 flex items-center justify-center mb-8 transition-all duration-300 relative"
                  >
                    <PixelIcon name="chat" size="2xl" />
                    <PixelIcon
                      v-if="isSocialEnabled"
                      name="mood-happy"
                      class="absolute -top-2 -right-2 text-pink-400 animate-pixel-bounce w-4 h-4"
                    />
                  </div>
                  <h3
                    class="text-2xl font-black mb-3 text-slate-700 group-hover:text-pink-600 transition-colors tracking-tight"
                  >
                    NapCat 社交集成
                  </h3>
                  <p class="text-sm text-slate-500 mb-10 leading-relaxed opacity-80 font-medium">
                    通过 NapCat 框架深度连接社交协议。开启后应用将具备跨平台的智能互动能力。
                  </p>
                  <p
                    v-if="isRemoteBackendMode"
                    class="text-[11px] text-slate-400 mb-6 leading-relaxed font-medium"
                  >
                    远程模式下，NapCat 与社交协议由服务器端负责，本地启动器不会再启动它。
                  </p>
                  <div class="flex items-center justify-between mt-auto">
                    <div class="flex items-center gap-5">
                      <div
                        class="w-14 h-7 bg-slate-200 pixel-border-sky cursor-pointer transition-all relative after:absolute after:top-1 after:left-1 after:w-5 after:h-5 after:bg-white after:pixel-border-sky after:transition-all pixel-hover-lift"
                        :class="{
                          'bg-pink-400 after:translate-x-6': isSocialEnabled,
                          'cursor-not-allowed opacity-50': isRemoteBackendMode
                        }"
                        @click="toggleSocialMode"
                      >
                        <PixelIcon
                          v-if="isSocialEnabled"
                          name="heart"
                          class="absolute top-2 left-2 text-white animate-pixel-float z-20 pointer-events-none w-2 h-2"
                        />
                      </div>
                      <span
                        class="text-xs font-black transition-colors tracking-widest"
                        :class="isSocialEnabled ? 'text-pink-500' : 'text-slate-400'"
                      >
                        {{ isSocialEnabled ? 'ENABLED' : 'DISABLED' }}
                      </span>
                    </div>
                    <div v-if="isSocialEnabled" class="flex gap-3">
                      <span
                        v-if="napcatStatus === 'RUNNING'"
                        class="px-5 py-2 pixel-border-sky bg-white text-emerald-500 text-[10px] font-black flex items-center gap-2"
                      >
                        <PixelIcon name="check" class="w-3 h-3" />
                        正在运行
                      </span>
                      <span
                        v-else
                        class="px-5 py-2 pixel-border-sky bg-white text-slate-400 text-[10px] font-black flex items-center gap-2"
                      >
                        <div class="w-2 h-2 bg-slate-200 pixel-border-sm"></div>
                        未启动
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 未来工具占位符 -->
              <div
                class="bg-white/40 p-10 pixel-border-yellow border-dashed flex flex-col items-center justify-center text-slate-400 group hover:border-yellow-300 hover:bg-white/60 transition-all duration-300 relative overflow-hidden pixel-hover-lift press-effect"
              >
                <div
                  class="w-24 h-24 pixel-border-sky bg-white flex items-center justify-center mb-8 transition-all duration-300"
                >
                  <PixelIcon
                    name="plus"
                    class="text-sky-300 group-hover:text-sky-500 transition-colors w-12 h-12"
                  />
                </div>
                <div class="text-center relative z-10">
                  <div
                    class="text-lg font-black text-slate-400 group-hover:text-sky-500 transition-colors"
                  >
                    探索更多可能
                  </div>
                  <div class="text-[10px] font-mono uppercase tracking-[0.3em] mt-2 opacity-60">
                    Coming Soon
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        <!-- 底部 / 迷你状态 -->
        <footer
          class="h-10 px-10 flex items-center justify-between border-t-2 border-sky-100 text-[10px] font-mono text-slate-400 select-none bg-white"
        >
          <div class="flex items-center gap-6"></div>
          <div class="flex items-center gap-4">
            <span class="flex items-center gap-1.5">
              <PixelIcon name="shield" class="w-3 h-3" /> 安全模式
            </span>
            <span>© 2026 PEROFAMILY</span>
          </div>
        </footer>

        <!-- 全局下载进度遮罩 -->
        <div
          v-if="downloadProgress.active"
          class="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 w-96 bg-white p-5 pixel-border-pink flex flex-col gap-3 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300"
        >
          <div
            class="flex justify-between items-center text-xs font-black uppercase tracking-widest text-pink-500"
          >
            <span class="flex items-center gap-3">
              <div class="p-1 pixel-border-pink bg-pink-100 text-pink-500 animate-pixel-float">
                <PixelIcon name="cat" class="w-3.5 h-3.5" />
              </div>
              {{ downloadProgress.percent >= 0 ? '正在同步资源喵...' : '喵呜~ 资源同步中...' }}
            </span>
            <span v-if="downloadProgress.percent >= 0" class="font-mono"
              >{{ downloadProgress.percent }}%</span
            >
          </div>

          <!-- 进度条容器 -->
          <div class="w-full bg-pink-50 h-3 pixel-border-pink overflow-hidden relative">
            <!-- 确定性进度条 -->
            <div
              v-if="downloadProgress.percent >= 0"
              class="bg-pink-400 h-full transition-all duration-300 relative overflow-hidden"
              :style="{ width: `${downloadProgress.percent}%` }"
            >
              <div class="absolute inset-0 bg-white/30 w-full h-full animate-pixel-pulse"></div>
            </div>

            <!-- 不确定性进度条 (Indeterminate) -->
            <div v-else class="absolute inset-0 bg-pink-500/10 h-full w-full overflow-hidden">
              <div class="indeterminate-bar bg-pink-400 h-full w-1/3 absolute top-0"></div>
            </div>
          </div>

          <!-- 状态日志显示区域 -->
          <PTooltip :content="downloadProgress.status">
            <div
              class="mt-1 text-[10px] text-slate-400 font-mono truncate max-w-full opacity-60 flex items-center gap-2"
            >
              <div class="w-1.5 h-1.5 pixel-border-pink bg-pink-200"></div>
              {{ downloadProgress.status }}
            </div>
          </PTooltip>
        </div>

        <!-- EULA 最终用户许可协议弹窗（Teleport 到 body，绕过 zoom stacking context） -->
        <Teleport to="body">
          <div
            v-if="showEulaModal"
            class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all duration-500 animate-in fade-in duration-300"
          >
            <div
              class="w-[540px] bg-white p-10 pixel-border-pink flex flex-col gap-8 relative overflow-hidden shadow-2xl scale-in-center animate-in zoom-in-95 duration-300"
            >
              <!-- 背景装饰 -->
              <div class="absolute -top-10 -right-10 text-pink-50/50 pointer-events-none rotate-12">
                <PixelIcon name="heart" class="w-40 h-40" />
              </div>

              <div class="flex items-center gap-6 relative z-10">
                <div
                  class="w-16 h-16 pixel-border-pink bg-pink-500 flex items-center justify-center text-white animate-pixel-float shadow-lg"
                >
                  <PixelIcon name="shield" size="xl" />
                </div>
                <div>
                  <h2
                    class="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3"
                  >
                    用户许可协议
                    <span class="text-[10px] bg-pink-100 text-pink-500 px-2 py-1 pixel-border-pink"
                      >REQUIRED</span
                    >
                  </h2>
                  <p
                    class="text-[11px] text-slate-400 mt-1.5 uppercase tracking-[0.3em] font-mono opacity-80"
                  >
                    End User License Agreement
                  </p>
                </div>
              </div>

              <div
                class="max-h-[320px] overflow-y-auto pr-4 text-slate-600 text-sm leading-relaxed custom-scrollbar bg-pink-50/30 p-6 pixel-border-pink relative z-10"
              >
                <div class="space-y-5">
                  <p class="font-bold text-pink-600 flex items-center gap-2">
                    <PixelIcon name="heart" class="w-3.5 h-3.5" />
                    欢迎使用 萌动链接：PeroperoChat！ (以下简称“本软件”)。
                  </p>
                  <p>
                    在使用本软件之前，请您务必仔细阅读并理解《最终用户许可协议》（以下简称"本协议"）。本软件是一个开源项目，我们鼓励社区共建与共享。
                  </p>

                  <div class="space-y-4">
                    <h4 class="font-black text-slate-800 mt-6 flex items-center gap-2">
                      <div class="w-2 h-2 pixel-border-pink bg-pink-400"></div>
                      1. 开源许可与分发
                    </h4>
                    <p class="pl-4 border-l-2 border-pink-100 text-slate-500">
                      本软件基于开源协议发布，您可以自由地查看、修改和分发源代码，但须遵守对应的开源许可条款。再分发时请保留原始版权声明与许可信息。
                    </p>

                    <h4 class="font-black text-slate-800 mt-6 flex items-center gap-2">
                      <div class="w-2 h-2 pixel-border-pink bg-pink-400"></div>
                      2. AI 生成内容免责声明
                    </h4>
                    <p class="pl-4 border-l-2 border-pink-100 text-slate-500">
                      本软件作为工具平台，集成并调用第三方大语言模型（LLM）服务。所有由 AI
                      生成的文字、图像及其他内容均由模型自动产出，不代表开发者的观点或立场。开发者不对
                      AI 生成内容的准确性、合法性或适用性承担任何责任。您应自行甄别并审慎使用 AI
                      生成的内容，因使用 AI 输出内容所产生的一切后果由用户自行承担。
                    </p>

                    <h4 class="font-black text-slate-800 mt-6 flex items-center gap-2">
                      <div class="w-2 h-2 pixel-border-pink bg-pink-400"></div>
                      3. 隐私与数据安全
                    </h4>
                    <p class="pl-4 border-l-2 border-pink-100 text-slate-500">
                      本软件高度重视您的隐私。您的对话记录、角色配置和个人数据默认仅存储在本地设备上，不会被上传至开发者的服务器。若您配置了第三方
                      API（如 LLM 接口），相关数据将依据该第三方服务的隐私政策进行处理，请知悉。
                    </p>

                    <h4 class="font-black text-slate-800 mt-6 flex items-center gap-2">
                      <div class="w-2 h-2 pixel-border-pink bg-pink-400"></div>
                      4. 使用规范
                    </h4>
                    <p class="pl-4 border-l-2 border-pink-100 text-slate-500">
                      您不得利用本软件从事任何违反所在地区法律法规的活动，包括但不限于生成和传播违法有害信息。请遵守社区公约，共同维护友善、健康的使用环境。
                    </p>

                    <h4 class="font-black text-slate-800 mt-6 flex items-center gap-2">
                      <div class="w-2 h-2 pixel-border-pink bg-pink-400"></div>
                      5. 免责与风险提示
                    </h4>
                    <p class="pl-4 border-l-2 border-pink-100 text-slate-500">
                      本软件按"原样"提供，不附带任何形式的明示或暗示担保。开发者不对因使用或无法使用本软件而导致的任何直接或间接损失承担责任。本软件可能集成第三方组件，其稳定性与安全性由各自维护者负责。
                    </p>
                  </div>

                  <p
                    class="text-[11px] text-slate-400 pt-6 border-t-2 border-pink-100 flex items-center gap-2"
                  >
                    <PixelIcon name="mood-happy" class="w-3.5 h-3.5" />
                    点击“同意并继续”即表示您已阅读并同意上述所有条款喵~
                  </p>
                </div>
              </div>

              <div class="flex gap-5 relative z-10">
                <button
                  class="flex-1 px-8 py-4 pixel-border-pink bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-all font-black text-xs tracking-widest pixel-hover-lift press-effect"
                  @click="handleDeclineEula"
                >
                  拒绝并退出
                </button>
                <button
                  class="flex-[2] px-8 py-4 pixel-btn-pink text-white font-black text-sm tracking-[0.2em] shadow-lg flex items-center justify-center gap-3 pixel-hover-lift press-effect group"
                  @click="handleAcceptEula"
                >
                  <PixelIcon name="check" size="md" />
                  同意并继续
                  <PixelIcon
                    name="flash"
                    class="group-hover:translate-x-1 transition-transform w-4 h-4"
                  />
                </button>
              </div>
            </div>
          </div>
        </Teleport>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { AGENT_NAME, BASE_URL } from '../config'
import { refreshDesktopAuth } from '@/api/runtimeAuth'
import { gatewayClient } from '@/api/gateway'

import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import PTooltip from '../components/ui/PTooltip.vue'
import { invoke, listen, isElectron } from '@/utils/ipcAdapter'
import PixelIcon from '../components/ui/PixelIcon.vue'
import OnboardingOverlay from '../components/onboarding/OnboardingOverlay.vue'

const scale = ref(1)
const appVersion = ref('...')
const updateScale = () => {
  const width = window.innerWidth
  if (width < 1200) {
    scale.value = width / 1200
  } else {
    scale.value = 1
  }
}

const activeTab = ref('home')
// console.debug("Stats update failed", e) -> removed
// const napcatLogs = ref([]) -> removed

const envReport = ref(null)
const envStatus = ref('checking') // checking/ok/warning/error

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
const showEulaModal = ref(false) // 是否显示 EULA 弹窗
const showOnboarding = ref(false) // 是否显示引导图层喵~ 🎭
const isDownloadingModels = ref(false)
const allModelsExist = ref(false)
const downloadProgress = ref({
  active: false,
  percent: 0,
  status: '',
  error: false,
  completed: false
})
const remoteBackendUrlInput = ref('')
const remoteBackendApiKeyInput = ref('')
const isRemoteBackendMode = computed(() => appConfig.value.backend_mode === 'remote')

const persistAppConfig = async (nextConfig) => {
  const cleanConfig = JSON.parse(JSON.stringify(nextConfig))
  await invoke('save_config', { config: cleanConfig })
  appConfig.value = nextConfig
}

const normalizeRemoteBackendUrl = (value) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  return (/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).replace(/\/+$/, '')
}

const reinitializeRemoteAuthAndGateway = async () => {
  await refreshDesktopAuth()
  gatewayClient.disconnect()
  await gatewayClient.connect()
}

const setBackendMode = async (mode) => {
  if (appConfig.value.backend_mode === mode) return

  try {
    const nextConfig = { ...appConfig.value, backend_mode: mode }
    await persistAppConfig(nextConfig)
    if (mode === 'remote') {
      remoteBackendUrlInput.value = nextConfig.remote_backend_url || ''
      remoteBackendApiKeyInput.value = nextConfig.remote_backend_api_key || ''
      napcatStatus.value = 'STOPPED'
      if (nextConfig.remote_backend_url) {
        await reinitializeRemoteAuthAndGateway()
      }
    }
    await checkEnvironment()
  } catch (e) {
    console.error('切换后端模式失败:', e)
    if (window.$notify) {
      window.$notify(`切换后端模式失败: ${e}`, 'error', '设置错误')
    }
  }
}

const saveRemoteBackendUrl = async () => {
  if (!isRemoteBackendMode.value) return

  try {
    const normalized = normalizeRemoteBackendUrl(remoteBackendUrlInput.value)
    remoteBackendUrlInput.value = normalized
    const nextConfig = {
      ...appConfig.value,
      backend_mode: 'remote',
      remote_backend_url: normalized,
      remote_backend_api_key: (remoteBackendApiKeyInput.value || '').trim()
    }
    await persistAppConfig(nextConfig)
    if (normalized) {
      await reinitializeRemoteAuthAndGateway()
    }
    await checkEnvironment()
  } catch (e) {
    console.error('保存远程后端地址失败:', e)
    if (window.$notify) {
      window.$notify(`保存服务器地址失败: ${e}`, 'error', '设置错误')
    }
  }
}

const handleOnboardingFinish = async () => {
  try {
    // 第一阶段引导结束，标记为 'launcher_done' 喵~ 🌸
    const newConfig = { ...appConfig.value, onboarding_completed: 'launcher_done' }
    const cleanConfig = JSON.parse(JSON.stringify(newConfig))
    await invoke('save_config', { config: cleanConfig })
    appConfig.value = newConfig
    addLog('[SYSTEM] 第一阶段引导已完成，请点击启动以进入指挥中心进行高级配置。')
  } catch (e) {
    console.error('保存引导状态失败:', e)
  }
}

const cpuUsage = ref(0)
const memoryUsed = ref(0)
const memoryTotal = ref(0)
const steamUser = ref(null)
let statsInterval = null

const updateStats = async () => {
  try {
    const stats = await invoke('get_system_stats')
    cpuUsage.value = stats.cpu_usage
    memoryUsed.value = stats.memory_used
    memoryTotal.value = stats.memory_total
  } catch {
    // 忽略
  }
}

const loadConfig = async () => {
  try {
    const config = await invoke('get_config')
    const normalizedConfig = {
      ...config,
      backend_mode: config.backend_mode === 'remote' ? 'remote' : 'local',
      remote_backend_url: config.remote_backend_url || '',
      remote_backend_api_key: config.remote_backend_api_key || ''
    }
    appConfig.value = normalizedConfig
    remoteBackendUrlInput.value = normalizedConfig.remote_backend_url
    remoteBackendApiKeyInput.value = normalizedConfig.remote_backend_api_key
    // 默认为 false
    isSocialEnabled.value = normalizedConfig.enable_social_mode === true

    // 检查 EULA 状态
    if (normalizedConfig.eula_accepted !== true) {
      showEulaModal.value = true
    } else if (normalizedConfig.onboarding_completed === false) {
      // 只有新用户且接受了 EULA 后，才自动开启第一阶段引导喵~ 🌸
      showOnboarding.value = true
    }
  } catch (e) {
    console.error('加载配置失败:', e)
  }
}

const handleAcceptEula = async () => {
  try {
    const newConfig = { ...appConfig.value, eula_accepted: true }
    const cleanConfig = JSON.parse(JSON.stringify(newConfig))
    await invoke('save_config', { config: cleanConfig })
    appConfig.value = newConfig
    showEulaModal.value = false
    addLog('[SYSTEM] 用户已同意 EULA 协议。')

    // 如果还没完成引导，则在接受 EULA 后立即开启引导喵~ 🌸
    if (!newConfig.onboarding_completed) {
      showOnboarding.value = true
    }
  } catch (e) {
    console.error('保存 EULA 状态失败:', e)
  }
}

const handleDeclineEula = () => {
  // 直接关闭程序
  invoke('quit_app')
}

const toggleSocialMode = async () => {
  if (isRemoteBackendMode.value) {
    if (window.$notify) {
      window.$notify('远程模式下，NapCat 由服务器端负责，本地启动器不再控制。', 'info', '远程模式')
    }
    return
  }

  // 乐观更新
  isSocialEnabled.value = !isSocialEnabled.value

  try {
    const newConfig = { ...appConfig.value, enable_social_mode: isSocialEnabled.value }
    // 深拷贝去除 Vue Proxy 以避免 IPC 序列化错误
    const cleanConfig = JSON.parse(JSON.stringify(newConfig))

    await invoke('save_config', { config: cleanConfig })
    appConfig.value = newConfig

    // 如果禁用，停止 NapCat
    if (!isSocialEnabled.value && napcatStatus.value === 'RUNNING') {
      await invoke('stop_napcat_wrapper')
      napcatStatus.value = 'STOPPED'
    }
  } catch (e) {
    console.error('保存配置失败:', e)
    // 失败回滚
    isSocialEnabled.value = !isSocialEnabled.value

    if (window.$notify) {
      window.$notify(`配置保存失败: ${e}`, 'error', '设置错误')
    } else {
      alert(`配置保存失败: ${e}`)
    }
  }
}

onMounted(async () => {
  try {
    const v = await invoke('get_app_version')
    if (v) appVersion.value = v
  } catch {
    /* ignore */
  }

  // 初始化缩放
  updateScale()
  window.addEventListener('resize', updateScale)

  // 就绪时显示窗口以避免白屏
  setTimeout(async () => {
    try {
      await invoke('show_window')
    } catch (e) {
      console.warn('窗口控制错误', e)
    }
  }, 200)

  // 注册事件监听器（不阻塞）
  listen('es-log', (event) => addLog(`[ES] ${event.payload}`))
  listen('napcat-download-progress', (payload) => {
    downloadProgress.value = {
      active: true,
      percent: payload.percent,
      status: payload.status,
      error: payload.error || false,
      completed: payload.completed || false
    }

    if (payload.error) {
      if (window.$notify) {
        window.$notify(`NapCat 安装失败: ${payload.status}`, 'error', '组件安装错误')
      }
    }

    if (payload.completed || payload.error) {
      setTimeout(() => {
        downloadProgress.value.active = false
      }, 5000)
    }
  })
  listen('download-progress', (payload) => {
    const percent = payload.percent

    downloadProgress.value = {
      active: true,
      percent: percent,
      status: payload.status,
      error: false,
      completed: false
    }
  })

  // 并行执行所有 IPC 调用以加速启动
  const [, pluginsResult, esResult, envResult] = await Promise.allSettled([
    loadConfig(),
    invoke('get_plugins'),
    invoke('check_es'),
    checkEnvironment()
  ])

  console.log('[DEBUG] Launcher 挂载，加载到的配置:', appConfig.value)

  // 引导图层开启逻辑已安全迁移至 loadConfig()，确保只在接受 EULA 后才展现喵~ 🌸

  // 处理插件结果
  if (pluginsResult.status === 'fulfilled') {
    plugins.value = pluginsResult.value
  } else {
    console.error('加载插件失败:', pluginsResult.reason)
    addLog(`[ERROR] Failed to load plugins: ${pluginsResult.reason}`)
  }

  // 处理 ES 状态结果
  if (esResult.status === 'fulfilled') {
    esStatus.value = esResult.value ? 'INSTALLED' : 'NOT_INSTALLED'
  } else {
    esStatus.value = 'ERROR'
  }

  // 处理环境检查结果
  if (envResult.status === 'fulfilled') {
    const status = envResult.value
    if (status === 'error') {
      if (window.$notify) {
        window.$notify(
          '关键运行环境缺失，启动已禁用。请前往环境检测页修复。',
          'error',
          '环境缺失',
          8000
        )
      }
    } else if (status === 'warning') {
      if (window.$notify) {
        window.$notify('环境存在警告，建议检查。', 'warning', '环境警告', 5000)
      }
    }
  }

  // 开始统计轮询
  updateStats()
  statsInterval = setInterval(updateStats, 2000)

  // 初始加载 Agent 列表（用于侧边栏头像显示）
  fetchAgents()
})

onUnmounted(() => {
  if (statsInterval) clearInterval(statsInterval)
  window.removeEventListener('resize', updateScale)
})

const navItems = [
  { id: 'home', name: '控制面板', icon: 'home' },
  { id: 'agents', name: '角色配置', icon: 'users' },
  { id: 'plugins', name: '插件管理', icon: 'plug' },
  { id: 'tools', name: '工具箱', icon: 'layout' },
  { id: 'environment', name: '环境检测', icon: 'shield' }
]

const getStatusColor = (status) => {
  switch (status) {
    case 'RUNNING':
      return 'bg-emerald-500 shadow-emerald-500/50'
    case 'STARTING':
      return 'bg-amber-500 shadow-amber-500/50'
    case 'ERROR':
      return 'bg-rose-500 shadow-rose-500/50'
    default:
      return 'bg-sky-400 shadow-sky-400/20'
  }
}

const addLog = (msg) => {
  // 直接使用 console.log/error 输出到终端面板
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
    addLog('[系统] 正在停止服务...')
    await invoke('stop_backend')
    await invoke('stop_napcat_wrapper')
    isRunning.value = false
    backendStatus.value = 'STOPPED'
    napcatStatus.value = 'STOPPED'

    // 使用 Rust 命令可靠地隐藏宠物窗口
    await invoke('hide_pet_window')

    await invoke('close_dashboard')
  } catch (e) {
    addLog(`[错误] 停止失败: ${e}`)
  }
}

const checkEnvironment = async () => {
  try {
    envStatus.value = 'checking'
    const report = await invoke('get_diagnostics')
    envReport.value = report

    // 判断整体状态
    let criticalMissing = false
    let warning = false

    // 关键检查
    if (!report.python_exists) criticalMissing = true
    if (!report.script_exists) criticalMissing = true
    if (!report.data_dir_writable) criticalMissing = true
    if (!report.vc_redist_installed) criticalMissing = true

    // 警告检查
    if (!isRemoteBackendMode.value && !report.port_9120_free) warning = true
    if (!report.core_available) warning = true
    if (!report.webview2_installed) warning = true // Should be critical but let's be lenient
    if (!isRemoteBackendMode.value && isSocialEnabled.value && !report.napcat_installed) warning = true // Optional based on setting
    if (!isRemoteBackendMode.value && isSocialEnabled.value && !report.node_exists) warning = true // Node.js required for NapCat

    // 模型检查：模型必须存在，否则阻止启动以防后端死循环/崩溃
    if (isRemoteBackendMode.value || (report.embedding_model_exists && report.whisper_model_exists)) {
      allModelsExist.value = true
    } else {
      allModelsExist.value = false
      criticalMissing = true // 模型缺失现在是致命错误，必须拦截
      warning = true 
    }

    if (criticalMissing) {
      envStatus.value = 'error'
    } else if (warning) {
      envStatus.value = 'warning'
    } else {
      envStatus.value = 'ok'
    }

    return envStatus.value
  } catch (e) {
    console.error('环境检查失败:', e)
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
        window.$notify('环境检测未通过，缺少关键组件，无法启动。', 'error', '启动阻止')
      }
      // 自动跳转到环境页
      activeTab.value = 'environment'
      return
    }

    if (status === 'warning') {
      if (window.$notify) {
        window.$notify('环境存在警告，可能影响部分功能。', 'warning', '系统警告')
      }
    }

    isStarting.value = true
    try {
      addLog('[SYSTEM] Starting services...')

      // 0. NapCat 预检（如果社交模式已启用）
      // 0. NapCat 预检 (如果开启了社交模式)
      if (!isRemoteBackendMode.value && isSocialEnabled.value) {
        addLog('[SYSTEM] 正在检查 NapCat 环境...')
        napcatStatus.value = 'INSTALLING' // 使用临时状态或 STARTING

        try {
          // 检查是否已安装
          const isInstalled = await invoke('check_napcat')

          if (!isInstalled) {
            addLog('[SYSTEM] 未检测到 NapCat，开始自动下载...')
            // 注意：install_napcat 在后端是阻塞的，直到下载安装完成才会返回
            const success = await invoke('install_napcat')

            if (!success) {
              throw new Error('NapCat 自动安装失败，无法启动。请检查网络或手动安装。')
            }
            addLog('[SYSTEM] NapCat 安装完成。')
          } else {
            addLog('[SYSTEM] NapCat 环境检查通过。')
          }
        } catch (e) {
          napcatStatus.value = 'ERROR'
          throw e // 抛出异常以中断后续启动流程
        }
      }

      // 1. 启动后端
      // 1. 启动后端
      backendStatus.value = 'STARTING'
      await invoke('start_backend', {
        enableSocialMode: !isRemoteBackendMode.value && isSocialEnabled.value
      })
      backendStatus.value = 'RUNNING'
      addLog(
        isRemoteBackendMode.value
          ? `[SYSTEM] 远程后端已连接: ${appConfig.value.remote_backend_url || remoteBackendUrlInput.value}`
          : '[SYSTEM] 核心服务已启动。'
      )

      // 2. 启动 NapCat
      // 2. 启动 NapCat
      if (isRemoteBackendMode.value) {
        addLog('[SYSTEM] 远程模式下跳过本地 NapCat 启动。')
      } else if (isSocialEnabled.value) {
        napcatStatus.value = 'STARTING'
        await invoke('start_napcat')
        napcatStatus.value = 'RUNNING'
        addLog('[SYSTEM] NapCat 容器已初始化。')
      } else {
        addLog('[SYSTEM] 社交模式已禁用，跳过 NapCat 启动。')
      }

      // 3. 打开宠物窗口
      // 3. 打开角色窗口
      // [引导逻辑] 如果是初次引导（状态不是 true），则打开 Dashboard 而不是 Pet Window 喵~ 🚀
      console.log('[DEBUG] 准备启动，检查引导状态:', appConfig.value.onboarding_completed)
      if (appConfig.value.onboarding_completed !== true) {
        addLog('[SYSTEM] 检测到初次运行，正在重定向至 Dashboard 进行高级配置...')
        await invoke('open_dashboard')
        // 关闭当前 Launcher 窗口
        await invoke('close_launcher')
      } else {
        addLog('[SYSTEM] 正在打开角色窗口...')
        await invoke('open_pet_window')
        addLog('[SYSTEM] 角色窗口已激活。')
        // 启动后自动隐藏启动器窗口
        console.log('[DEBUG] 正在调用 hide_launcher...')
        await invoke('hide_launcher')
        console.log('[DEBUG] hide_launcher 调用已完成')
      }

      isStarting.value = false
      isRunning.value = true
      addLog('[SYSTEM] 萌动链接：PeroperoChat！ 系统在线。')
    } catch (e) {
      addLog(`[ERROR] Start failed: ${e}`)
      console.error('[ERROR] Start failed details:', e)

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

const installES = async () => {
  if (isInstallingES.value || esStatus.value === 'INSTALLED') return
  isInstallingES.value = true
  try {
    addLog('[系统] 正在安装 Everything Search...')
    await invoke('install_es')
    addLog('[系统] Everything Search 安装完成。')
    esStatus.value = 'INSTALLED'
  } catch (e) {
    addLog(`[ERROR] ES Install failed: ${e}`)
  } finally {
    isInstallingES.value = false
  }
}

const downloadModels = async () => {
  if (isDownloadingModels.value || allModelsExist.value) return
  isDownloadingModels.value = true
  downloadProgress.value.active = true
  downloadProgress.value.status = '准备下载模型...'

  try {
    addLog('[SYSTEM] 开始下载 AI 模型...')
    await invoke('download_models')
    addLog('[SYSTEM] AI 模型下载完成。')
    // 重新检查环境
    await checkEnvironment()

    downloadProgress.value.status = '下载完成'
    downloadProgress.value.percent = 100
    downloadProgress.value.completed = true

    if (window.$notify) {
      window.$notify('AI 模型下载完成', 'success', '系统就绪')
    }
  } catch (e) {
    console.error('Model download failed', e)
    addLog(`[ERROR] 模型下载失败: ${e}`)

    downloadProgress.value.error = true
    downloadProgress.value.status = '下载失败'

    if (window.$notify) {
      window.$notify(`模型下载失败: ${e}`, 'error', '下载错误')
    }
  } finally {
    isDownloadingModels.value = false
    setTimeout(() => {
      if (downloadProgress.value.completed || downloadProgress.value.error) {
        downloadProgress.value.active = false
      }
    }, 3000)
  }
}

// --- 助手逻辑 ---
const agentList = ref([])
const activeAgent = computed(() => agentList.value.find((a) => a.is_active))
const isLoadingAgents = ref(false)

const fetchAgents = async () => {
  isLoadingAgents.value = true
  try {
    // 使用 Tauri 本地命令替代 fetch API
    const agents = await invoke('scan_local_agents')
    agentList.value = agents.map((agent) => ({
      ...agent,
      // avatar 已经是 data URL 或 API 路径
      avatarUrl: agent.avatar
        ? agent.avatar.startsWith('data:')
          ? agent.avatar
          : `${BASE_URL}${agent.avatar}`

        : null
    }))
  } catch (e) {
    console.error('Failed to fetch agents via Rust', e)
    addLog(`[ERROR] Failed to fetch agents: ${e}`)
  } finally {
    isLoadingAgents.value = false
  }
}

const toggleAgentEnabled = async (agent) => {
  // 乐观更新
  // const originalState = agent.is_enabled
  agent.is_enabled = !agent.is_enabled

  await saveAgentConfig()
}

const setAsActive = async (agent) => {
  // 更新本地状态
  agentList.value.forEach((a) => (a.is_active = a.id === agent.id))
  await saveAgentConfig()
  addLog(`[CONFIG] Active agent set to: ${agent.name}`)
}

const saveAgentConfig = async () => {
  const enabledIds = agentList.value.filter((a) => a.is_enabled).map((a) => a.id)
  const activeAgent = agentList.value.find((a) => a.is_active)
  const activeId = activeAgent ? activeAgent.id : enabledIds.length > 0 ? enabledIds[0] : 'pero'

  try {
    await invoke('save_global_launch_config', {
      enabledAgents: enabledIds,
      activeAgent: activeId
    })
  } catch (e) {
    console.error('保存助手配置失败', e)
    addLog(`[错误] 保存助手配置失败: ${e}`)
  }
}

// 监听器
watch(activeTab, (val) => {
  if (val === 'agents') {
    fetchAgents()
  }
})

// 已移除 watch(isRunning)，因为现在独立加载
</script>

<style>
/* 像素风进度条动画 */
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.shimmer-effect {
  animation: shimmer 1.5s infinite linear;
}

@keyframes indeterminate {
  0% {
    left: -35%;
  }
  100% {
    left: 100%;
  }
}

.indeterminate-bar {
  animation: indeterminate 1.5s infinite linear;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #0ea5e9;
  border: 1px solid #0369a1;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #38bdf8;
}
</style>
