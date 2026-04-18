<template>
  <!-- 1. 仪表盘概览 -->
  <div class="p-6 space-y-6 overflow-y-auto h-full custom-scrollbar">
    <!-- 统计卡片 (Overview Cards) -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <PCard pixel hoverable variant="purple" glow class="group">
        <div class="flex items-center gap-4 relative">
          <div
            class="p-4 bg-purple-100 pixel-border-pink text-purple-500 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500"
          >
            <PixelIcon name="brain" size="xl" animation="bounce" />
          </div>
          <div class="relative z-10">
            <h3 class="text-sm font-bold text-slate-600 flex items-center gap-1.5">
              核心记忆
              <span class="text-[10px] text-purple-400 font-mono">Core</span>
            </h3>
            <div class="text-2xl font-black text-slate-800">
              {{ stats.total_memories || memories.length }}
            </div>
            <button
              class="mt-1 text-xs text-purple-500 hover:text-purple-600 font-medium flex items-center gap-1 transition-colors group/btn"
              @click="showImportStoryDialog = true"
            >
              <PixelIcon
                name="download"
                size="xs"
                class="rotate-180 group-hover/btn:-translate-y-0.5 transition-transform"
              />
              导入故事 <PixelIcon name="thought" size="xs" class="ml-0.5" />
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

      <PCard pixel hoverable variant="sky" glow class="group">
        <div class="flex items-center gap-4 relative">
          <div
            class="p-4 bg-sky-100 pixel-border-sky text-sky-500 group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-500"
          >
            <PixelIcon name="chat" size="xl" animation="bounce" />
          </div>
          <div class="relative z-10">
            <h3 class="text-sm font-bold text-slate-600 flex items-center gap-1.5">
              近期对话
              <span class="text-[10px] text-sky-400 font-mono">Logs</span>
            </h3>
            <div class="text-2xl font-black text-slate-800">
              {{ stats.total_logs || logs.length }}
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

      <PCard pixel hoverable variant="orange" glow class="group">
        <div class="flex items-center gap-4 relative">
          <div
            class="p-4 bg-orange-100 pixel-border-orange text-orange-500 group-hover:scale-110 group-hover:rotate-6 transition-transform duration-500"
          >
            <PixelIcon name="flash" size="xl" animation="bounce" />
          </div>
          <div class="relative z-10">
            <h3 class="text-sm font-bold text-slate-600 flex items-center gap-1.5">
              待办任务
              <span class="text-[10px] text-orange-400 font-mono">Tasks</span>
            </h3>
            <div class="text-2xl font-black text-slate-800">
              {{ stats.total_tasks || tasks.length }}
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

    <!-- 当前状态 -->
    <PCard pixel overflow-visible class="z-30">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold text-lg text-slate-800 flex items-center gap-2">
            当前状态
            <span class="text-xs font-normal text-slate-400 font-mono">Status</span>
          </span>
          <div class="flex items-center gap-4">
            <!-- 移动端连接按钮 -->
            <PButton
              variant="secondary"
              size="sm"
              class="!bg-sky-50 !text-sky-600 !border-sky-100 hover:!bg-sky-100"
              :loading="isLoadingConnection"
              @click="fetchConnectionInfo"
            >
              <template #icon>
                <PixelIcon name="globe" size="xs" />
              </template>
              手机连接
            </PButton>

            <!-- NapCat 状态 -->
            <PTooltip
              v-if="!napCatStatus.disabled"
              :content="
                napCatStatus.ws_connected
                  ? napCatStatus.api_responsive
                    ? `延迟: ${napCatStatus.latency_ms}ms`
                    : 'API 无响应'
                  : '未连接'
              "
              placement="bottom"
            >
              <div class="flex items-center gap-2 px-3 py-1.5 bg-sky-50 pixel-border-sky">
                <span class="text-xs text-sky-400 font-bold font-mono">NAPCAT</span>
                <div class="flex items-center gap-1.5">
                  <span class="relative flex h-2 w-2">
                    <span
                      v-if="napCatStatus.ws_connected && napCatStatus.api_responsive"
                      class="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"
                    ></span>
                    <span
                      class="relative inline-flex rounded-full h-2 w-2"
                      :class="
                        napCatStatus.ws_connected && napCatStatus.api_responsive
                          ? 'bg-sky-500'
                          : napCatStatus.ws_connected
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                      "
                    ></span>
                  </span>
                  <span
                    v-if="napCatStatus.ws_connected && napCatStatus.api_responsive"
                    class="text-xs font-mono font-bold text-sky-600"
                    >{{ napCatStatus.latency_ms }}ms</span
                  >
                </div>
              </div>
            </PTooltip>

            <!-- 角色选择 (Agent Selector) -->
            <div class="flex flex-col gap-1.5 min-w-[160px]">
              <label
                class="text-[10px] font-bold text-slate-400 flex items-center gap-1.5 ml-1 uppercase tracking-wider"
              >
                <span class="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></span>
                当前角色 <span class="opacity-50 font-normal">Agent</span>
              </label>
              <div class="relative group/agent">
                <button
                  class="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-sky-50 pixel-border-sky text-sm transition-all press-effect group/btn"
                  :class="isSwitchingAgent ? 'opacity-50 cursor-not-allowed' : ''"
                >
                  <span class="text-sky-600 font-bold flex items-center gap-2">
                    <span
                      class="opacity-0 group-hover/btn:opacity-100 transition-all duration-300 -translate-x-2 group-hover:translate-x-0"
                    >
                      <PixelIcon name="paw" size="xs" />
                    </span>
                    {{ activeAgent?.name || '未知' }}
                    <span class="opacity-40 group-hover:opacity-100 transition-opacity">
                      <PixelIcon name="sparkle" size="xs" />
                    </span>
                  </span>
                  <PixelIcon
                    name="chevron-down"
                    size="xs"
                    class="text-slate-400 group-hover/agent:rotate-180 transition-transform duration-500"
                  />
                </button>

                <!-- 下拉菜单 (Dropdown Menu) -->
                <div
                  class="absolute right-0 top-full mt-2 w-full py-2 bg-white/70 backdrop-blur-xl border border-sky-100 rounded-2xl shadow-2xl opacity-0 invisible group-hover/agent:opacity-100 group-hover/agent:visible transition-all duration-300 z-50 transform origin-top scale-95 group-hover/agent:scale-100"
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
                    v-for="agent in availableAgents"
                    :key="agent.id"
                    class="w-full text-left px-4 py-2.5 text-sm hover:bg-sky-50 transition-all flex items-center justify-between group/item"
                    :class="{
                      'text-sky-600 font-bold bg-sky-50/50': agent.id === activeAgent?.id,
                      'text-slate-500': agent.id !== activeAgent?.id,
                      'opacity-50 cursor-not-allowed': !agent.is_enabled
                    }"
                    :disabled="agent.id === activeAgent?.id || !agent.is_enabled"
                    @click="switchAgent(agent.id)"
                  >
                    <div class="flex items-center gap-2">
                      <span class="opacity-0 group-hover/item:opacity-100 transition-opacity">
                        <PixelIcon name="paw" size="xs" />
                      </span>
                      <span>{{ agent.name }}</span>
                    </div>
                    <span
                      v-if="!agent.is_enabled"
                      class="text-[10px] text-slate-400 font-bold px-1.5 py-0.5 bg-sky-50 rounded-md"
                      >DISABLED</span
                    >
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div
          class="bg-sky-50/40 pixel-border-sky p-5 transition-all hover:bg-white hover:pixel-border-pink group relative"
        >
          <div
            class="text-xs text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
          >
            心情 <span class="text-[10px] text-sky-400/60 font-mono">Mood</span>
            <span
              class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:rotate-12 text-sky-500"
              ><PixelIcon name="paw" size="xs"
            /></span>
          </div>
          <div
            class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
          >
            {{ petState.mood || '未知' }}
          </div>
          <div class="h-1.5 bg-sky-100/50 rounded-full overflow-hidden relative z-10 shadow-inner">
            <div
              class="h-full bg-gradient-to-r from-sky-400 to-sky-300 rounded-full transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
              :style="{ width: '80%' }"
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
            class="text-xs text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
          >
            氛围 <span class="text-[10px] text-sky-400/60 font-mono">Vibe</span>
            <span
              class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:-rotate-12 text-sky-500"
              ><PixelIcon name="sparkle" size="xs"
            /></span>
          </div>
          <div
            class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
          >
            {{ petState.vibe || '未知' }}
          </div>
          <div class="h-1.5 bg-sky-100/50 rounded-full overflow-hidden relative z-10 shadow-inner">
            <div
              class="h-full bg-gradient-to-r from-sky-400 to-sky-300 rounded-full transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
              :style="{ width: '60%' }"
            ></div>
          </div>
          <!-- 装饰 -->
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
            class="text-xs text-slate-500 font-bold uppercase tracking-wider mb-3 flex items-center justify-between relative z-10"
          >
            想法 <span class="text-[10px] text-sky-400/60 font-mono">Mind</span>
            <span
              class="opacity-0 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-125 group-hover:rotate-12 text-sky-500"
              ><PixelIcon name="thought" size="xs"
            /></span>
          </div>
          <div
            class="text-2xl font-black text-sky-500 mb-4 relative z-10 group-hover:scale-105 transition-transform origin-left"
          >
            {{ petState.mind || '未知' }}
          </div>
          <div class="h-1.5 bg-sky-100/50 rounded-full overflow-hidden relative z-10 shadow-inner">
            <div
              class="h-full bg-gradient-to-r from-sky-400 to-sky-300 rounded-full transition-all duration-1000 group-hover:shadow-[0_0_12px_rgba(14,165,233,0.3)]"
              :style="{ width: '90%' }"
            ></div>
          </div>
          <!-- 装饰 -->
          <div
            class="absolute -right-2 -bottom-2 opacity-[0.05] group-hover:opacity-[0.1] transition-all duration-700 pointer-events-none"
          >
            <PixelIcon name="sparkle" size="3xl" />
          </div>
        </div>
      </div>
    </PCard>

    <!-- NIT 状态 -->
    <PCard
      v-if="nitStatus"
      id="nit-status-card"
      pixel
      class="hover:pixel-border-pink transition-all group/nit"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="p-3 bg-sky-100 pixel-border-sm text-sky-500 group">
            <PixelIcon name="chart" size="md" class="group-hover:scale-110 transition-transform" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800">NapCat 协议状态</span>
              <span
                class="px-2 py-0.5 bg-sky-100 text-sky-600 text-[10px] font-bold pixel-border-sm border-sky-200 uppercase"
                >Active</span
              >
            </div>
            <div class="text-sm text-slate-500 mt-0.5 flex items-center gap-3">
              <span
                ><strong class="text-sky-600 font-mono">{{ nitStatus.plugins_count }}</strong>
                <span class="text-slate-400 ml-1">插件已加载</span></span
              >
              <span class="w-px h-3 bg-sky-100"></span>
              <span
                ><strong class="text-sky-600 font-mono">{{ nitStatus.active_mcp_count }}</strong>
                <span class="text-slate-400 ml-1">MCP 服务已连接</span></span
              >
            </div>
          </div>
        </div>
      </div>
      <div v-if="nitStatus.plugins?.length" class="mt-4 flex flex-wrap gap-2">
        <span
          v-for="p in nitStatus.plugins.slice(0, 8)"
          :key="p.name"
          class="px-2.5 py-1 bg-sky-50 pixel-border-sm text-[10px] font-bold text-sky-500 hover:bg-sky-100 transition-all cursor-default hover:scale-105"
        >
          {{ p.name }}
        </span>
        <span
          v-if="nitStatus.plugins.length > 8"
          class="px-2 py-1 text-xs text-slate-400 font-medium italic"
          >...及其他 {{ nitStatus.plugins.length - 8 }} 个</span
        >
      </div>
    </PCard>

    <!-- 社交管理卡片 -->
    <div class="mt-6">
      <PCard pixel class="group/social">
        <template #header>
          <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex items-start gap-4">
              <div class="text-2xl text-sky-500 mt-1">
                <PixelIcon name="chat" size="lg" />
              </div>
              <div>
                <div class="font-bold text-slate-800 flex items-center gap-2 text-lg">
                  社交模式
                  <span class="text-xs font-normal text-slate-400 font-mono">NapCat Social</span>
                </div>
                <div class="text-sm text-slate-500 mt-1 leading-relaxed">
                  服务器将与独立部署的 NapCat 保持常驻连接，并通过反向 WebSocket 接收 OneBot 事件。
                </div>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <PButton variant="secondary" size="sm" @click="fetchSocialStatus">
                <template #icon>
                  <PixelIcon name="refresh" size="xs" />
                </template>
                刷新状态
              </PButton>
              <PSwitch
                v-model="isSocialEnabled"
                :loading="isTogglingSocial"
                @update:model-value="toggleSocial"
              />
            </div>
          </div>
        </template>

        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div class="bg-sky-50/60 pixel-border-sky p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WebSocket</div>
            <div class="mt-2 text-sm font-bold" :class="napCatStatus.ws_connected ? 'text-sky-600' : 'text-rose-500'">
              {{ napCatStatus.ws_connected ? '已连接' : '未连接' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">连接数 {{ napCatStatus.connection_count }}</div>
          </div>

          <div class="bg-sky-50/60 pixel-border-sky p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">OneBot API</div>
            <div
              class="mt-2 text-sm font-bold"
              :class="napCatStatus.api_responsive ? 'text-sky-600' : 'text-amber-500'"
            >
              {{ napCatStatus.api_responsive ? '响应正常' : '未响应' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">
              {{ napCatStatus.api_responsive ? `${napCatStatus.latency_ms}ms` : '等待心跳响应' }}
            </div>
          </div>

          <div class="bg-sky-50/60 pixel-border-sky p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bot</div>
            <div class="mt-2 text-sm font-bold text-sky-600">
              {{ napCatStatus.bot_info?.nickname || '未识别' }}
            </div>
            <div class="mt-1 text-xs text-slate-500 font-mono">
              {{ napCatStatus.bot_info?.user_id || '等待登录信息' }}
            </div>
          </div>

          <div class="bg-sky-50/60 pixel-border-sky p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">鉴权</div>
            <div class="mt-2 text-sm font-bold" :class="napCatStatus.ws_auth_required ? 'text-amber-500' : 'text-slate-500'">
              {{ napCatStatus.ws_auth_required ? '需要 Secret' : '未启用 Secret' }}
            </div>
            <div class="mt-1 text-xs text-slate-500 font-mono">
              {{ napCatStatus.ws_auth_required ? napCatStatus.ws_auth_query || napCatStatus.ws_auth_header : '开放环境慎用' }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
          <div class="bg-white/70 border border-sky-100 rounded-[1.5rem] p-4 space-y-2">
            <div class="text-xs font-bold text-slate-500 uppercase tracking-widest">连接诊断</div>
            <div class="text-sm text-slate-600">
              最后连接时间：<span class="font-mono text-sky-600">{{ formatStatusTime(napCatStatus.last_connected_at) }}</span>
            </div>
            <div class="text-sm text-slate-600">
              最后事件时间：<span class="font-mono text-sky-600">{{ formatStatusTime(napCatStatus.last_event_at) }}</span>
            </div>
            <div class="text-sm text-slate-600">
              当前连接 ID：
              <span class="font-mono text-sky-600">{{ napCatStatus.connected_ids.length ? napCatStatus.connected_ids.join(', ') : '默认连接' }}</span>
            </div>
          </div>

          <div class="rounded-[1.5rem] p-4 border" :class="napCatStatus.last_error ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'">
            <div class="text-xs font-bold uppercase tracking-widest" :class="napCatStatus.last_error ? 'text-rose-500' : 'text-emerald-500'">
              最近状态
            </div>
            <div class="mt-2 text-sm leading-relaxed" :class="napCatStatus.last_error ? 'text-rose-600' : 'text-emerald-600'">
              {{ napCatStatus.last_error || '最近状态正常，后端已准备好与 NapCat 保持常驻连接。' }}
            </div>
          </div>
        </div>
      </PCard>
    </div>

    <!-- 功能开关卡片组 -->
    <div class="space-y-4">
      <!-- 轻量模式 -->
      <PCard pixel class="group/switch">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="text-2xl group-hover/switch:scale-110 transition-transform duration-300">
              <PixelIcon name="leaf" size="lg" />
            </div>
            <div>
              <div class="font-bold text-slate-800 flex items-center gap-2">
                轻量聊天模式
                <span class="text-[10px] text-sky-400/60 font-mono font-normal">Lightweight</span>
              </div>
              <div class="text-sm text-slate-500 mt-0.5 leading-relaxed">
                开启后，将禁用大部分高级工具以节省资源。仅保留视觉感知、记忆管理和基础管理功能。
              </div>
            </div>
          </div>
          <PSwitch
            v-model="isLightweightEnabled"
            :loading="isTogglingLightweight"
            @update:model-value="toggleLightweight"
          />
        </div>
      </PCard>

      <!-- 视觉感应 -->
      <PCard pixel class="group/switch">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="text-2xl group-hover/switch:scale-110 transition-transform duration-300">
              <PixelIcon name="crystal" size="lg" />
            </div>
            <div>
              <div class="font-bold text-slate-800 flex items-center gap-2">
                主动视觉感应
                <span class="text-[10px] text-sky-400/60 font-mono font-normal">AuraVision</span>
              </div>
              <div class="text-sm text-slate-500 mt-0.5 leading-relaxed">
                开启后，{{ activeAgent?.name || 'Pero' }}
                将通过屏幕主动感知你的存在并触发互动。
              </div>
            </div>
          </div>
          <PSwitch
            v-model="isAuraVisionEnabled"
            :loading="isTogglingAuraVision"
            :disabled="embeddingProvider === 'api'"
            @update:model-value="toggleAuraVision"
          />
        </div>
        <div
          v-if="embeddingProvider === 'api'"
          class="mt-3 p-2 bg-amber-50 rounded-xl border border-amber-100 flex items-center gap-2"
        >
          <PixelIcon name="alert" size="xs" class="text-amber-500" />
          <span class="text-[10px] text-amber-700"
            >由于在线 API 向量维度不匹配，AuraVision 暂不可用喵~ 🌸</span
          >
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
              <div class="font-bold text-slate-800 flex items-center gap-2">
                智能陪伴模式
                <span class="text-[10px] text-sky-400/60 font-mono font-normal">Companion</span>
              </div>
              <div class="text-sm text-slate-500 mt-0.5 leading-relaxed">
                {{ activeAgent?.name || 'Pero' }} 将自动观察你的屏幕动态并进行互动。
                <span v-if="!isLightweightEnabled" class="text-rose-500 font-bold ml-2 text-xs"
                  >(需要先开启“轻量模式”)</span
                >
              </div>
            </div>
          </div>
          <PSwitch
            v-model="isCompanionEnabled"
            :loading="isTogglingCompanion"
            :disabled="!isLightweightEnabled || !isCurrentModelVisionEnabled"
            @update:model-value="toggleCompanion"
          />
        </div>
      </PCard>
    </div>

    <!-- 记忆系统配置 -->
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
                配置不同模式下的记忆召回与上下文长度 <PixelIcon name="paw" size="xs" />
              </div>
            </div>
          </div>
          <PButton
            variant="primary"
            size="sm"
            :loading="isSavingMemoryConfig"
            class="shadow-lg shadow-sky-300/30"
            @click="saveMemoryConfig"
            >保存配置</PButton
          >
        </div>
      </template>

      <!-- 模式切换 (Mode Tabs) -->
      <div
        class="border-b border-sky-100 flex gap-8 mb-8 overflow-x-auto pb-1 custom-scrollbar group/tabs"
      >
        <button
          v-for="tab in [
            { id: 'desktop', label: '桌面模式', icon: 'desktop' },
            { id: 'work', label: '工作模式', icon: 'desktop' },
            { id: 'social', label: '社交模式', icon: 'chat' }
          ]"
          :key="tab.id"
          class="pb-4 text-sm font-bold transition-all relative active:scale-95 flex items-center gap-2 group/tab hover-pixel-bounce"
          :class="activeMemoryTab === tab.id ? 'text-sky-600' : 'text-slate-500 hover:text-sky-500'"
          @click="activeMemoryTab = tab.id"
        >
          <span class="relative z-10 flex items-center gap-2">
            <span class="group-hover/tab:scale-125 transition-transform duration-300"
              ><PixelIcon :name="tab.icon" size="sm"
            /></span>
            {{ tab.label }}
            <span v-if="activeMemoryTab === tab.id" class="animate-bounce"
              ><PixelIcon name="sparkle" size="xs"
            /></span>
          </span>

          <!-- 🐾 悬停指示器 -->
          <span
            class="absolute -top-1 left-1/2 -translate-x-1/2 opacity-0 group-hover/tab:opacity-100 transition-all duration-300 -translate-y-2 group-hover/tab:translate-y-0 pointer-events-none"
          >
            <PixelIcon name="paw" size="xs" />
          </span>

          <div
            v-if="activeMemoryTab === tab.id"
            class="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 to-sky-300 rounded-full shadow-[0_0_12px_rgba(56,189,248,0.3)]"
          ></div>
        </button>
      </div>

      <!-- 选项卡内容 -->
      <div class="space-y-6">
        <!-- 桌面模式 (Desktop Mode) -->
        <div v-if="activeMemoryTab === 'desktop'" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div
              class="bg-sky-50/50 p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  短期记忆上下文
                  <span class="text-[10px] text-sky-400 font-bold font-mono">Context</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-mono font-bold border border-sky-200"
                  >{{ memoryConfig.modes.desktop.context_limit }}</span
                >
              </div>
              <PSlider v-model="memoryConfig.modes.desktop.context_limit" :min="5" :max="50" />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:rotate-12 transition-transform"
                  ><PixelIcon name="thought" size="sm"
                /></span>
                <p class="leading-relaxed">
                  最近对话的条数，用于维持对话连贯性。建议设置在 10-20 条左右。<PixelIcon
                    name="sparkle"
                    size="xs"
                  />
                </p>
              </div>
            </div>
            <div
              class="bg-sky-50/50 p-6 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  RAG 召回数量
                  <span class="text-[10px] text-slate-400 font-bold">Retrieval</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-500/10 text-sky-400 rounded-lg text-xs font-mono font-bold"
                  >{{ memoryConfig.modes.desktop.rag_limit }}</span
                >
              </div>
              <PSlider v-model="memoryConfig.modes.desktop.rag_limit" :min="0" :max="30" />
              <div
                class="mt-4 text-xs text-slate-500 flex items-start gap-2 bg-sky-50/50 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:scale-110 transition-transform"
                  ><PixelIcon name="book" size="sm"
                /></span>
                <p class="leading-relaxed">
                  从长期记忆库中检索的相关记忆条数。召回越多，回复内容越精准。<PixelIcon
                    name="paw"
                    size="xs"
                  />
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 工作模式 (Work Mode) -->
        <div v-if="activeMemoryTab === 'work'" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div
              class="bg-sky-50/50 p-5 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  短期记忆上下文
                  <span class="text-[10px] text-slate-400 font-bold">Context</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-mono font-bold border border-sky-200"
                  >{{ memoryConfig.modes.work.context_limit }}</span
                >
              </div>
              <PSlider v-model="memoryConfig.modes.work.context_limit" :min="10" :max="100" />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:rotate-12 transition-transform"
                  ><PixelIcon name="desktop" size="sm"
                /></span>
                <p class="leading-relaxed">
                  工作模式通常需要更长的上下文以理解代码或任务背景。建议设置在 30-50
                  条左右。<PixelIcon name="sparkle" size="xs" />
                </p>
              </div>
            </div>
            <div
              class="bg-sky-50/50 p-5 pixel-border-sky transition-all duration-300 group/mconfig hover:pixel-border-pink"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  RAG 召回数量
                  <span class="text-[10px] text-slate-400 font-bold">Retrieval</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-mono font-bold border border-sky-200"
                  >{{ memoryConfig.modes.work.rag_limit }}</span
                >
              </div>
              <PSlider v-model="memoryConfig.modes.work.rag_limit" :min="0" :max="50" />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:scale-110 transition-transform"
                  ><PixelIcon name="search" size="sm"
                /></span>
                <p class="leading-relaxed">
                  从长期记忆库中检索的相关记忆条数。工作模式建议召回更多事实。<PixelIcon
                    name="paw"
                    size="xs"
                  />
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- 社交模式 (Social Mode) -->
        <div v-if="activeMemoryTab === 'social'" class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div
              class="bg-sky-50/50 p-5 rounded-[2rem] border border-sky-100/50 hover:border-sky-300 transition-all duration-300 group/mconfig shadow-sm"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  决策上下文长度
                  <span class="text-[10px] text-slate-400 font-bold">Context</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-mono font-bold border border-sky-200"
                  >{{ memoryConfig.modes.social.context_limit }}</span
                >
              </div>
              <PSlider
                v-model="memoryConfig.modes.social.context_limit"
                :min="20"
                :max="200"
                :step="10"
              />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:rotate-12 transition-transform"
                  ><PixelIcon name="thought" size="sm"
                /></span>
                <p class="leading-relaxed">
                  “秘书”决策和主动发言时参考的消息数量。社交模式需要更全面的视野。<PixelIcon
                    name="sparkle"
                    size="xs"
                  />
                </p>
              </div>
            </div>
            <div
              class="bg-sky-50/50 p-5 rounded-[2rem] border border-sky-100/50 hover:border-sky-300 transition-all duration-300 group/mconfig shadow-sm"
            >
              <div class="flex justify-between items-center mb-4">
                <label class="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <span
                    class="w-2 h-2 rounded-full bg-sky-500 group-hover/mconfig:animate-pulse"
                  ></span>
                  RAG 召回数量
                  <span class="text-[10px] text-slate-400 font-bold">Retrieval</span>
                </label>
                <span
                  class="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-mono font-bold border border-sky-200"
                  >{{ memoryConfig.modes.social.rag_limit }}</span
                >
              </div>
              <PSlider v-model="memoryConfig.modes.social.rag_limit" :min="0" :max="30" />
              <div
                class="mt-4 text-xs text-slate-500 font-medium flex items-start gap-2 bg-sky-100/30 p-3 rounded-xl border border-sky-100/50"
              >
                <span class="text-base group-hover/mconfig:scale-110 transition-transform"
                  ><PixelIcon name="heart" size="sm"
                /></span>
                <p class="leading-relaxed">
                  从长期记忆库中检索的相关记忆条数。用于在群聊中识别熟人和往事。<PixelIcon
                    name="paw"
                    size="xs"
                  />
                </p>
              </div>
            </div>
          </div>

          <div class="border-t border-sky-100 pt-8">
            <h4
              class="text-xs font-bold text-slate-500 mb-6 uppercase tracking-widest flex items-center gap-2"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping"></span>
              高级配置 <span class="opacity-50 font-normal">Advanced Settings</span>
            </h4>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div
                class="bg-white/60 p-5 rounded-3xl border border-sky-100 hover:border-sky-300 transition-all group/adv shadow-sm"
              >
                <label class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  图片感知上限
                  <span
                    class="text-[10px] text-slate-400 font-normal opacity-0 group-hover/adv:opacity-100 transition-opacity"
                    ># Image Limit</span
                  >
                </label>
                <PInputNumber
                  v-model="memoryConfig.modes.social.advanced.image_limit"
                  :min="0"
                  :max="4"
                  class="!bg-sky-50/50 !border-sky-100 focus:!border-sky-300"
                />
                <div class="mt-3 text-[11px] text-slate-500 font-medium leading-relaxed">
                  每次处理消息时最多查看的最近图片数量。<PixelIcon name="eye" size="xs" />
                </div>
              </div>
              <div
                class="bg-white/60 p-5 rounded-3xl border border-sky-100 hover:border-sky-300 transition-all group/adv shadow-sm"
              >
                <label class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  跨会话感知人数
                  <span
                    class="text-[10px] text-slate-400 font-normal opacity-0 group-hover/adv:opacity-100 transition-opacity"
                    ># User Count</span
                  >
                </label>
                <PInputNumber
                  v-model="memoryConfig.modes.social.advanced.cross_context_users"
                  :min="0"
                  :max="10"
                  class="!bg-sky-50/50 !border-sky-100 focus:!border-sky-300"
                />
                <div class="mt-3 text-[11px] text-slate-500 font-medium leading-relaxed">
                  在群聊中同时关注的相关活跃用户数量。<PixelIcon name="users" size="xs" />
                </div>
              </div>
              <div
                class="bg-white/60 p-5 rounded-3xl border border-sky-100 hover:border-sky-300 transition-all group/adv shadow-sm"
              >
                <label class="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  跨会话历史深度
                  <span
                    class="text-[10px] text-slate-400 font-normal opacity-0 group-hover/adv:opacity-100 transition-opacity"
                    ># History Depth</span
                  >
                </label>
                <PInputNumber
                  v-model="memoryConfig.modes.social.advanced.cross_context_history"
                  :min="0"
                  :max="50"
                  class="!bg-sky-50/50 !border-sky-100 focus:!border-sky-300"
                />
                <div class="mt-3 text-[11px] text-slate-500 font-medium leading-relaxed">
                  为每个相关用户/群组拉取的背景消息条数。<PixelIcon name="book" size="xs" />
                </div>
              </div>
            </div>
            <div
              class="mt-6 p-4 bg-sky-50/80 border border-sky-100 rounded-[1.5rem] flex items-start gap-4 backdrop-blur-md group/notice shadow-sm"
            >
              <div
                class="p-2 bg-sky-100 rounded-xl text-sky-500 group-hover/notice:scale-110 transition-transform"
              >
                <PixelIcon name="alert" size="md" />
              </div>
              <p class="text-[11px] text-slate-500 font-medium leading-relaxed py-1">
                注意：调高高级配置参数可能会显著增加
                <span class="text-sky-600 font-bold">Token 消耗</span>
                及响应延迟，建议根据实际性能情况进行微调哦~
                <PixelIcon name="sparkle" size="xs" /> <PixelIcon name="paw" size="xs" />
              </p>
            </div>
          </div>
        </div>
      </div>
    </PCard>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import PCard from '@/components/ui/PCard.vue'
import PButton from '@/components/ui/PButton.vue'
import PSwitch from '@/components/ui/PSwitch.vue'
import PSlider from '@/components/ui/PSlider.vue'
import PInputNumber from '@/components/ui/PInputNumber.vue'
import PTooltip from '@/components/ui/PTooltip.vue'
import PixelIcon from '@/components/ui/PixelIcon.vue'
import {
  DASHBOARD_KEY,
  AGENT_CONFIG_KEY,
  DASHBOARD_DATA_KEY,
  LOGS_KEY,
  MEMORIES_KEY,
  TASKS_KEY,
  MODEL_CONFIG_KEY
} from '@/composables/dashboard/injectionKeys'

const { isLoadingConnection, fetchConnectionInfo } = inject(DASHBOARD_KEY)!
const {
  activeAgent,
  availableAgents,
  isSwitchingAgent,
  switchAgent,
  napCatStatus,
  isCompanionEnabled,
  isTogglingCompanion,
  toggleCompanion,
  isSocialEnabled,
  isTogglingSocial,
  toggleSocial,
  fetchSocialStatus,
  isLightweightEnabled,
  isTogglingLightweight,
  toggleLightweight,
  isAuraVisionEnabled,
  isTogglingAuraVision,
  toggleAuraVision,
  activeMemoryTab,
  memoryConfig,
  isSavingMemoryConfig,
  saveMemoryConfig
} = inject(AGENT_CONFIG_KEY)!
const { stats, petState, nitStatus } = inject(DASHBOARD_DATA_KEY)!
const { logs } = inject(LOGS_KEY)!
const { memories, showImportStoryDialog } = inject(MEMORIES_KEY)!
const { tasks } = inject(TASKS_KEY)!
const { embeddingProvider, isCurrentModelVisionEnabled } = inject(MODEL_CONFIG_KEY)!

const formatStatusTime = (value: string | null): string => {
  if (!value) return '暂无'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}
</script>
