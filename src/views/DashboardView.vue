<template>
  <div
    class="min-h-screen bg-sky-50 text-slate-800 selection:bg-sky-500/20 font-sans overflow-hidden"
  >
    <div v-once class="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
      <div
        class="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-sky-300/20 blur-[150px] rounded-full animate-pulse"
        style="will-change: transform, opacity"
      ></div>
      <div
        class="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] bg-sky-300/20 blur-[150px] rounded-full animate-pulse"
        style="animation-delay: 2s; will-change: transform, opacity"
      ></div>
    </div>

    <CustomTitleBar v-if="isElectron()" :transparent="true" title="Pero Dashboard" />

    <div class="flex h-screen overflow-hidden relative z-10" :class="{ 'pt-8': isElectron() }">
      <!-- 侧边栏 -->
      <aside
        id="dashboard-sidebar"
        class="w-64 flex flex-col border-r-2 border-sky-100/50 glass-effect transition-all duration-300 z-20 relative"
      >
        <!-- 右侧像素阴影线 -->
        <div
          class="absolute right-[-2px] top-0 bottom-0 w-[2px] bg-sky-200/30 pointer-events-none"
        ></div>

        <!-- 品牌标识 -->
        <div class="p-6 pb-2 relative z-10">
          <div class="flex items-center gap-4 mb-6">
            <div
              class="relative w-12 h-12 pixel-border-sky overflow-hidden group cursor-pointer transition-transform duration-300 hover:scale-110 press-effect bg-sky-50 p-1.5"
            >
              <img
                :src="logoImg"
                class="w-full h-full object-cover transition-transform duration-500 group-hover:rotate-12"
                alt="Logo"
              />
              <div
                class="absolute inset-0 bg-gradient-to-tr from-sky-300/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              ></div>
            </div>
            <div class="flex flex-col">
              <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5"
                >PeroperoChat</span
              >
              <h1
                class="text-lg font-black bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-sky-600 font-pixel"
              >
                萌动链接
              </h1>
              <PTooltip content="点击检查更新" placement="bottom">
                <div class="flex items-center gap-1.5 mt-1" @click="checkForUpdates">
                  <span
                    class="text-[9px] font-mono text-white bg-sky-400 px-1.5 py-[1px] pixel-border-sm cursor-pointer hover:bg-sky-500 transition-all press-effect"
                    >v{{ appVersion }}</span
                  >
                  <PixelIcon
                    v-if="isCheckingUpdate"
                    name="refresh"
                    size="xs"
                    animation="spin"
                    class="text-sky-500"
                  />
                </div>
              </PTooltip>
            </div>
          </div>
        </div>

        <!-- Menu -->
        <nav class="flex-1 overflow-y-auto px-4 space-y-6 scrollbar-hide py-2">
          <div v-for="(group, gIndex) in menuGroups" :key="gIndex">
            <div v-if="group.title" class="px-2 mb-3 mt-2 flex items-center gap-2">
              <div class="h-1 w-1 bg-slate-300 rounded-full"></div>
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]">{{
                group.title
              }}</span>
              <div class="flex-1 h-[1px] bg-slate-100"></div>
            </div>

            <div class="space-y-1.5">
              <button
                v-for="item in group.items"
                :id="'menu-item-' + item.id"
                :key="item.id"
                :class="[
                  'w-full flex items-center gap-3 px-3 py-2.5 text-sm font-bold transition-all duration-300 group press-effect relative overflow-hidden rounded-xl hover-pixel-bounce',
                  currentTab === item.id
                    ? item.variant === 'danger'
                      ? 'bg-rose-50 text-rose-600 border-2 border-rose-200 translate-x-1 shadow-sm'
                      : 'bg-white text-sky-600 border-2 border-sky-100 translate-x-1 shadow-md shadow-sky-100/50'
                    : 'text-slate-500 hover:bg-sky-50/50 hover:text-sky-600 hover:translate-x-1 border border-transparent'
                ]"
                @click="handleTabSelect(item.id)"
              >
                <!-- 活跃指示器 -->
                <div
                  v-if="currentTab === item.id"
                  class="absolute left-0 top-2 bottom-2 w-1 rounded-full transition-all duration-500"
                  :class="item.variant === 'danger' ? 'bg-rose-400' : 'bg-sky-400'"
                ></div>

                <PixelIcon
                  :name="item.icon"
                  size="sm"
                  class="transition-colors relative z-10"
                  :class="[
                    currentTab === item.id
                      ? item.variant === 'danger'
                        ? 'text-rose-500'
                        : 'text-sky-500'
                      : item.variant === 'danger'
                        ? 'text-slate-400 group-hover:text-rose-500'
                        : 'text-slate-400 group-hover:text-sky-500'
                  ]"
                />
                <span class="relative z-10">{{ item.label }}</span>

                <!-- 活跃项像素箭头 -->
                <div
                  v-if="currentTab === item.id"
                  class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <div class="w-1.5 h-1.5 bg-current transform rotate-45"></div>
                </div>
              </button>
            </div>
          </div>
        </nav>

        <!-- 底部 -->
        <div class="p-4 border-t-2 border-sky-100/50 bg-sky-50/30 relative">
          <!-- 像素装饰 -->
          <div class="absolute top-[-2px] left-4 right-4 h-[2px] bg-white"></div>

          <button
            class="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-500 hover:text-rose-600 pixel-border-pink transition-all duration-200 group mb-4 press-effect shadow-sm"
            @click="handleQuitApp"
          >
            <PixelIcon
              name="logout"
              size="sm"
              class="group-hover:-translate-x-1 transition-transform"
            />
            <span class="text-xs font-black tracking-widest">退出系统</span>
          </button>

          <div
            class="flex items-center justify-between px-2 py-1 bg-white/50 rounded border border-sky-100"
          >
            <div class="flex items-center gap-2.5">
              <span class="relative flex h-2.5 w-2.5">
                <span
                  v-if="isBackendOnline"
                  class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"
                ></span>
                <span
                  class="relative inline-flex rounded-full h-2.5 w-2.5 border-2 border-white shadow-sm"
                  :class="isBackendOnline ? 'bg-emerald-500' : 'bg-rose-500'"
                ></span>
              </span>
              <div class="flex flex-col">
                <span class="text-[10px] text-slate-400 font-bold uppercase leading-none"
                  >Status</span
                >
                <span
                  class="text-[10px] font-bold"
                  :class="isBackendOnline ? 'text-emerald-600' : 'text-rose-600'"
                  >{{ isBackendOnline ? 'SYSTEM ONLINE' : 'OFFLINE' }}</span
                >
              </div>
            </div>
            <PTooltip content="刷新数据" placement="top">
              <button
                class="p-1.5 bg-white pixel-border-sm hover:bg-sky-50 text-slate-400 hover:text-sky-500 transition-all press-effect"
                @click="fetchAllData(false)"
              >
                <PixelIcon name="refresh" size="xs" :animation="isGlobalRefreshing ? 'spin' : ''" />
              </button>
            </PTooltip>
          </div>
        </div>
      </aside>

      <!-- 主内容区 -->
      <main class="flex-1 overflow-hidden relative flex flex-col min-w-0 bg-transparent">
        <!-- ✨ 背景环境光与粒子 ✨ -->
        <div
          class="absolute inset-0 pointer-events-none transition-all duration-1000 z-0"
          :style="ambientLightStyle"
        ></div>

        <!-- 🐾 浮动背景粒子 -->
        <div class="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div
            v-for="p in particles"
            :key="p.id"
            class="absolute animate-float-slow opacity-20"
            :style="p.style"
          >
            <PixelIcon :name="p.icon" :size="p.size" class="text-sky-300" />
          </div>
        </div>

        <div
          class="view-container-wrapper relative z-10 flex-1"
          :style="
            ['logs', 'terminal', 'napcat'].includes(currentTab)
              ? 'height: 100%; overflow: hidden;'
              : 'min-height: 100%;'
          "
        >
          <div
            :class="
              ['logs', 'terminal', 'napcat'].includes(currentTab)
                ? 'h-full overflow-hidden'
                : ''
            "
          >
            <!-- 选项卡组件 (通过 provide/inject 传递状态) -->
            <OverviewTab v-if="currentTab === 'overview'" key="overview" />
            <LogsTab v-else-if="currentTab === 'logs'" key="logs" />
            <MemoriesTab v-else-if="currentTab === 'memories'" key="memories" />
            <TasksTab v-else-if="currentTab === 'tasks'" key="tasks" />
            <ModelConfigTab v-else-if="currentTab === 'model_config'" key="model_config" />
            <VoiceTab v-else-if="currentTab === 'voice_config'" key="voice_config" />
            <McpTab v-else-if="currentTab === 'mcp_config'" key="mcp_config" />
            <UserSettingsTab v-else-if="currentTab === 'user_settings'" key="user_settings" />
            <ResetTab v-else-if="currentTab === 'system_reset'" key="system_reset" />
            <NapCatTab v-else-if="currentTab === 'napcat'" key="napcat" />
            <TerminalTab v-else-if="currentTab === 'terminal'" key="terminal" />
          </div>
        </div>
      </main>
    </div>

    <!-- 对话框 -->
    <!-- 故事导入对话框 -->
    <PModal
      v-model="showImportStoryDialog"
      title="导入故事生成记忆"
      width="600px"
      class="backdrop-blur-2xl bg-white/80 border-sky-100 shadow-2xl shadow-sky-100/40"
    >
      <div class="space-y-4">
        <div class="text-sm text-slate-600 leading-relaxed">
          <p>你可以将小说设定、人物背景、日记或长篇回忆录粘贴在这里。</p>
          <p>
            Pero 将会阅读这些内容，并将其拆解为一系列关键记忆节点存入数据库，作为它的“长期记忆”。
          </p>
          <p
            class="mt-2 text-amber-600 text-xs font-bold flex items-center gap-1.5 bg-amber-50 px-3 py-2 rounded-lg border border-amber-200"
          >
            <PixelIcon name="alert" size="xs" />
            注意：这是一个耗时操作，且会消耗较多 Token。
          </p>
        </div>
        <PTextarea
          v-model="importStoryText"
          :rows="10"
          placeholder="在此粘贴长文本..."
          class="bg-sky-50/50 border-sky-100 focus:border-sky-300 transition-all duration-300"
        />
        <div class="flex justify-end gap-3 pt-2">
          <PButton variant="ghost" @click="showImportStoryDialog = false">取消</PButton>
          <PButton
            variant="primary"
            :loading="isImportingStory"
            class="shadow-lg shadow-sky-400/20"
            @click="handleImportStory"
          >
            开始生成
          </PButton>
        </div>
      </div>
    </PModal>

    <!-- 全局设置对话框 -->
    <PModal
      v-model="showGlobalSettings"
      title="全局服务商配置"
      width="500px"
      overflow-visible
      class="backdrop-blur-2xl bg-white/80 border-sky-100 shadow-2xl shadow-sky-100/40"
    >
      <div class="space-y-5">
        <div class="space-y-2 relative z-20">
          <label class="text-sm font-medium text-slate-600">服务商 (Provider)</label>
          <PSelect
            v-model="globalConfig.provider"
            :options="providerOptions"
            placeholder="选择服务商"
            class="bg-white/80 border-sky-100 !rounded-2xl shadow-lg shadow-black/30 backdrop-blur-md"
            @change="handleGlobalProviderChange"
          />
        </div>
        <div class="space-y-2 relative z-10">
          <label class="text-sm font-medium text-slate-600">API Key</label>
          <PInput
            v-model="globalConfig.global_llm_api_key"
            type="password"
            placeholder="sk-..."
            class="bg-white/80 border-sky-100"
          />
        </div>
        <div class="space-y-2">
          <label class="text-sm font-medium text-slate-600">API Base URL</label>
          <PInput
            v-model="globalConfig.global_llm_api_base"
            placeholder="https://api.openai.com"
            :disabled="globalConfig.provider === 'deepseek'"
            class="bg-white/80 border-sky-100"
          />
        </div>
        <div class="flex justify-end gap-3 pt-4 border-t border-sky-100 mt-6">
          <PButton variant="ghost" @click="showGlobalSettings = false">取消</PButton>
          <PButton
            variant="primary"
            :loading="isSaving"
            class="shadow-lg shadow-sky-400/20"
            @click="saveGlobalSettings"
            >保存</PButton
          >
        </div>
      </div>
    </PModal>

    <!-- 模型编辑对话框 -->
    <PModal
      v-model="showModelEditor"
      :title="currentEditingModel.id ? '编辑模型' : '添加模型'"
      width="600px"
      overflow-visible
      class="backdrop-blur-2xl bg-white/80 border-sky-100 shadow-2xl shadow-sky-100/40"
    >
      <div class="space-y-5">
        <!-- 显示名称 -->
        <div class="space-y-2 relative z-30">
          <label class="text-sm font-medium text-slate-600">显示名称</label>
          <PInput
            v-model="currentEditingModel.name"
            placeholder="例如：GPT-4o"
            class="bg-white/80 border-sky-100"
          />
        </div>

        <!-- 提供商 -->
        <div class="space-y-2 relative z-20">
          <label class="text-sm font-medium text-slate-600">服务商 (Provider)</label>
          <PSelect
            v-model="currentEditingModel.provider"
            :options="providerOptions"
            placeholder="选择服务商"
            class="bg-white/80 border-sky-100 !rounded-2xl shadow-lg shadow-black/30 backdrop-blur-md"
            @change="handleProviderChange"
          />
        </div>

        <!-- 模型 ID -->
        <div class="space-y-2 relative z-10">
          <label class="text-sm font-medium text-slate-600">Model ID</label>
          <div class="flex gap-2">
            <PInput
              v-model="currentEditingModel.model_id"
              placeholder="gpt-4"
              class="flex-1 bg-white/80 border-sky-100"
            />
            <PButton
              :loading="isFetchingRemote"
              class="bg-sky-50 text-sky-600 border-sky-100 hover:bg-sky-100"
              @click="fetchRemoteModels"
              >获取列表</PButton
            >
          </div>
          <PSelect
            v-if="remoteModels.length"
            v-model="currentEditingModel.model_id"
            :options="remoteModels.map((m) => ({ label: m, value: m }))"
            placeholder="选择获取到的模型"
            class="mt-1 bg-white/80 border-sky-100 !rounded-2xl shadow-lg shadow-black/30 backdrop-blur-md"
          />
        </div>

        <!-- 配置来源 -->
        <div class="space-y-2 relative z-5">
          <label class="text-sm font-medium text-slate-600">配置来源</label>
          <div class="flex items-center gap-6">
            <label class="flex items-center gap-2 cursor-pointer group">
              <input
                v-model="currentEditingModel.provider_type"
                type="radio"
                value="global"
                class="hidden"
              />
              <div
                class="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200"
                :class="
                  currentEditingModel.provider_type === 'global'
                    ? 'border-sky-500 shadow-lg shadow-sky-500/20'
                    : 'border-slate-300 group-hover:border-sky-300'
                "
              >
                <div
                  class="w-2 h-2 rounded-full bg-sky-500 transform transition-transform duration-200"
                  :class="currentEditingModel.provider_type === 'global' ? 'scale-100' : 'scale-0'"
                ></div>
              </div>
              <span
                class="text-sm text-slate-600 group-hover:text-sky-600 flex items-center gap-1.5"
                >全局继承 <PixelIcon name="sparkle" size="xs"
              /></span>
            </label>

            <label class="flex items-center gap-2 cursor-pointer group">
              <input
                v-model="currentEditingModel.provider_type"
                type="radio"
                value="custom"
                class="hidden"
              />
              <div
                class="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all duration-200"
                :class="
                  currentEditingModel.provider_type === 'custom'
                    ? 'border-sky-500 shadow-lg shadow-sky-500/20'
                    : 'border-slate-300 group-hover:border-sky-300'
                "
              >
                <div
                  class="w-2 h-2 rounded-full bg-sky-500 transform transition-transform duration-200"
                  :class="currentEditingModel.provider_type === 'custom' ? 'scale-100' : 'scale-0'"
                ></div>
              </div>
              <span
                class="text-sm text-slate-600 group-hover:text-sky-600 flex items-center gap-1.5"
                >独立配置 <PixelIcon name="thought" size="xs"
              /></span>
            </label>
          </div>
        </div>

        <!-- 自定义配置字段 -->
        <div
          v-if="currentEditingModel.provider_type === 'custom'"
          class="space-y-4 p-4 rounded-2xl bg-sky-50/30 border border-sky-100 shadow-inner"
        >
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600 flex items-center gap-2">
              <span class="w-1 h-1 rounded-full bg-sky-400"></span>
              API Key
            </label>
            <PInput
              v-model="currentEditingModel.api_key"
              type="password"
              class="!rounded-xl bg-white border-sky-100"
            />
          </div>
          <div
            v-if="!['gemini', 'anthropic'].includes(currentEditingModel.provider)"
            class="space-y-2"
          >
            <label class="text-sm font-medium text-slate-600 flex items-center gap-2">
              <span class="w-1 h-1 rounded-full bg-sky-400"></span>
              Base URL
            </label>
            <PInput
              v-model="currentEditingModel.api_base"
              class="!rounded-xl bg-white border-sky-100"
              :disabled="!!providerDefaults[currentEditingModel.provider]"
            />
          </div>
        </div>

        <div class="w-full h-px bg-sky-100 my-4"></div>
        <h4
          class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2"
        >
          参数设置 <span class="text-[10px] font-normal opacity-50"># Parameters</span>
        </h4>

        <div class="grid grid-cols-2 gap-4">
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">Temperature</label>
            <PInputNumber
              v-model="currentEditingModel.temperature"
              :step="0.1"
              :min="0"
              :max="2"
              class="!rounded-xl bg-white/80 border-sky-100"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">Max Tokens</label>
            <PInputNumber
              v-model="currentEditingModel.max_tokens"
              :step="100"
              class="!rounded-xl bg-white/80 border-sky-100"
            />
          </div>
        </div>

        <div class="space-y-3 pt-2">
          <PCheckbox v-model="currentEditingModel.stream" label="开启流式传输 (Stream)" />
          <div class="flex flex-wrap gap-4">
            <PCheckbox v-model="currentEditingModel.enable_vision" label="视觉模态" />
            <PCheckbox v-model="currentEditingModel.enable_voice" label="语音模态 (Input)" />
            <PCheckbox v-model="currentEditingModel.enable_video" label="视频模态" />
          </div>
        </div>

        <div class="flex justify-end gap-3 pt-6 border-t border-sky-100 mt-6">
          <PButton variant="ghost" class="!rounded-xl" @click="showModelEditor = false"
            >取消</PButton
          >
          <PButton
            variant="primary"
            class="!rounded-xl px-8 shadow-lg shadow-sky-400/20"
            :loading="isSaving"
            @click="saveModel"
            >保存设定 <PixelIcon name="thought" size="xs" class="ml-1"
          /></PButton>
        </div>
      </div>
    </PModal>

    <!-- MCP 编辑对话框 -->
    <PModal
      v-model="showMcpEditor"
      :title="currentEditingMcp.id ? '编辑 MCP' : '添加 MCP'"
      width="600px"
      overflow-visible
      class="backdrop-blur-2xl bg-white/70 border-sky-100 shadow-2xl shadow-sky-200/40"
    >
      <div class="space-y-5">
        <div class="space-y-2 relative z-20">
          <label class="text-sm font-medium text-slate-600">名称</label>
          <PInput v-model="currentEditingMcp.name" class="bg-sky-50/50 border-sky-100" />
        </div>
        <div class="space-y-2 relative z-10">
          <label class="text-sm font-medium text-slate-600">类型</label>
          <PSelect
            v-model="currentEditingMcp.type"
            :options="mcpTypeOptions"
            class="bg-sky-50/50 border-sky-100 !rounded-2xl shadow-lg shadow-black/30 backdrop-blur-md"
          />
        </div>

        <template v-if="currentEditingMcp.type === 'stdio'">
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">命令</label>
            <PInput
              v-model="currentEditingMcp.command"
              placeholder="node, python..."
              class="bg-sky-50/50 border-sky-100"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">参数 (JSON)</label>
            <PTextarea
              v-model="currentEditingMcp.args"
              :rows="2"
              placeholder='["arg1", "arg2"]'
              class="bg-sky-50/50 border-sky-100"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">环境变量 (JSON)</label>
            <PTextarea
              v-model="currentEditingMcp.env"
              :rows="2"
              placeholder='{"KEY": "VALUE"}'
              class="bg-sky-50/50 border-sky-100"
            />
          </div>
        </template>

        <template v-if="currentEditingMcp.type === 'sse'">
          <div class="space-y-2">
            <label class="text-sm font-medium text-slate-600">URL</label>
            <PInput v-model="currentEditingMcp.url" class="bg-sky-50/50 border-sky-100" />
          </div>
        </template>

        <div class="pt-2 flex items-center gap-3">
          <PSwitch v-model="currentEditingMcp.enabled" />
          <span class="text-sm text-slate-600">启用此 MCP 服务器</span>
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-sky-100 mt-6">
          <PButton variant="ghost" @click="showMcpEditor = false">取消</PButton>
          <PButton
            variant="primary"
            :loading="isSaving"
            class="shadow-lg shadow-sky-400/20"
            @click="saveMcp"
            >保存</PButton
          >
        </div>
      </div>
    </PModal>

    <!-- 调试日志弹窗 -->
    <PModal
      v-model="showDebugDialog"
      title="对话调试详情 (Debug View)"
      width="900px"
      class="backdrop-blur-2xl bg-white/70 border-sky-100 shadow-2xl shadow-sky-200/40"
    >
      <div v-if="currentDebugLog" class="h-[70vh] flex flex-col">
        <!-- 顶部控制栏 -->
        <div
          class="flex justify-center mb-4 bg-sky-50/50 p-1 rounded-lg self-center border border-sky-100 shrink-0"
        >
          <button
            v-for="mode in [
              { label: '回复记录解析 (Response)', value: 'response' },
              { label: '完整提示词 & ReAct (Prompt)', value: 'prompt' }
            ]"
            :key="mode.value"
            class="px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200 focus:outline-none"
            :class="[
              debugViewMode === mode.value
                ? 'bg-sky-500 text-white shadow-lg shadow-sky-400/20'
                : 'text-slate-500 hover:text-sky-600 hover:bg-sky-100'
            ]"
            @click="
              () => {
                handleDebugModeChange(mode.value)
                debugViewMode = mode.value
              }
            "
          >
            {{ mode.label }}
          </button>
        </div>

        <div class="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          <!-- 模式 1: 回复记录解析 -->
          <template v-if="debugViewMode === 'response'">
            <div
              class="bg-white/80 border border-sky-200 rounded-lg p-4 mb-4 text-xs text-slate-500 space-y-1 shadow-sm shadow-sky-100/20"
            >
              <p><strong class="text-slate-700">Log ID:</strong> {{ currentDebugLog.id }}</p>
              <p><strong class="text-slate-700">Role:</strong> {{ currentDebugLog.role }}</p>
              <p>
                <strong class="text-slate-700">Raw Content Length:</strong>
                {{ (currentDebugLog.raw_content || currentDebugLog.content || '').length }} chars
              </p>
            </div>

            <div class="space-y-3">
              <div
                v-for="(segment, index) in debugSegments"
                :key="index"
                class="rounded-lg border overflow-hidden transition-colors duration-200"
                :class="{
                  'bg-amber-50 border-amber-200': segment.type === 'thinking',
                  'bg-sky-50 border-sky-200': segment.type === 'monologue',
                  'bg-cyan-50 border-cyan-200': segment.type === 'nit',
                  'bg-white border-sky-100 shadow-sm': !['thinking', 'monologue', 'nit'].includes(
                    segment.type
                  )
                }"
              >
                <div
                  v-if="segment.type === 'thinking'"
                  class="px-3 py-1.5 bg-amber-100/50 text-amber-700 text-xs font-bold border-b border-amber-200 flex items-center gap-2"
                >
                  <PixelIcon name="brain" size="xs" />
                  Thinking Chain (思维链)
                </div>
                <div
                  v-else-if="segment.type === 'monologue'"
                  class="px-3 py-1.5 bg-sky-100/50 text-sky-700 text-xs font-bold border-b border-sky-200 flex items-center gap-2"
                >
                  <PixelIcon name="chat" size="xs" />
                  Inner Monologue (内心独白)
                </div>
                <div
                  v-else-if="segment.type === 'nit'"
                  class="px-3 py-1.5 bg-cyan-100/50 text-cyan-700 text-xs font-bold border-b border-cyan-200 flex items-center gap-2"
                >
                  <PixelIcon name="terminal" size="xs" />
                  NIT Script (工具调用)
                </div>

                <div class="p-3 text-sm leading-relaxed overflow-x-auto">
                  <div
                    v-if="segment.type === 'thinking'"
                    class="text-slate-600 font-mono text-xs whitespace-pre-wrap"
                  >
                    {{ segment.content }}
                  </div>
                  <div v-else-if="segment.type === 'monologue'" class="text-slate-600 italic">
                    {{ segment.content }}
                  </div>
                  <div
                    v-else-if="segment.type === 'nit'"
                    class="font-mono text-xs text-cyan-700 bg-sky-50/50 p-2 rounded border border-cyan-100"
                  >
                    <pre>{{ segment.content }}</pre>
                  </div>
                  <div v-else class="text-slate-700 prose prose-slate max-w-none prose-sm">
                    <AsyncMarkdown :content="segment.content" />
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- 模式 2: 完整提示词 & ReAct -->
          <template v-else-if="debugViewMode === 'prompt'">
            <div
              v-if="isLoadingPrompt"
              class="flex flex-col items-center justify-center h-full text-slate-400 min-h-[300px]"
            >
              <PixelIcon name="refresh" size="xl" animation="spin" class="text-sky-500 mb-3" />
              <p>正在从后端获取完整 Context... <PixelIcon name="sparkle" size="xs" /></p>
            </div>

            <div v-else class="space-y-4">
              <!-- 统计信息 -->
              <div
                class="bg-sky-50 border border-sky-100 rounded-lg p-3 flex gap-6 text-xs text-sky-600 mb-4"
              >
                <div>
                  <strong class="text-sky-700">Total Messages:</strong>
                  {{ currentPromptMessages.length }}
                </div>
                <div>
                  <strong class="text-sky-700">Total Length (Chars):</strong>
                  {{ totalPromptLength }}
                </div>
                <div>
                  <strong class="text-sky-700">Est. Tokens:</strong> ~{{
                    Math.ceil(totalPromptLength / 3.5)
                  }}
                </div>
              </div>

              <!-- 消息列表 -->
              <div class="space-y-3">
                <div
                  v-for="(msg, idx) in currentPromptMessages"
                  :key="idx"
                  class="rounded-lg overflow-hidden border border-sky-100 bg-white shadow-sm"
                >
                  <div
                    class="px-3 py-1.5 text-xs font-bold uppercase flex justify-between items-center border-b border-sky-100"
                    :class="{
                      'bg-sky-50 text-sky-600': msg.role === 'user',
                      'bg-sky-100 text-sky-700 font-bold': msg.role === 'assistant',
                      'bg-rose-50 text-rose-600': msg.role === 'system',
                      'bg-sky-50 text-slate-500': !['user', 'assistant', 'system'].includes(
                        msg.role
                      )
                    }"
                  >
                    <span>{{ msg.role }}</span>
                    <span class="font-normal opacity-50 font-mono"
                      >{{ (msg.content || '').length }} chars</span
                    >
                  </div>
                  <pre
                    class="p-3 font-mono text-xs text-slate-600 whitespace-pre-wrap overflow-x-auto max-h-[400px] custom-scrollbar"
                    >{{ msg.content }}</pre
                  >
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </PModal>

    <!-- 确认对话框 -->
    <PModal
      v-model="showConfirmModal"
      :title="confirmModalTitle"
      width="400px"
      class="backdrop-blur-2xl bg-white/70 border-sky-100 shadow-2xl shadow-sky-200/40"
      @close="handleCancel"
    >
      <div class="p-4">
        <div class="flex items-start gap-4">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            :class="{
              'bg-amber-100 text-amber-600': confirmType === 'warning',
              'bg-sky-100 text-sky-600': confirmType === 'info',
              'bg-rose-100 text-rose-600': confirmType === 'error'
            }"
          >
            <PixelIcon v-if="confirmType === 'warning'" name="alert" size="md" />
            <PixelIcon v-else-if="confirmType === 'info'" name="info" size="md" />
            <PixelIcon v-else name="alert" size="md" />
          </div>
          <div class="flex-1">
            <p class="text-slate-600 text-sm leading-relaxed" v-html="confirmModalContent"></p>
            <PInput
              v-if="isPrompt"
              v-model="promptValue"
              :placeholder="promptPlaceholder"
              class="mt-4 w-full bg-sky-50/50 border-sky-100"
            />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-3">
          <PButton variant="ghost" @click="handleCancel">取消</PButton>
          <PButton
            :variant="confirmType === 'error' ? 'danger' : 'primary'"
            class="shadow-lg"
            :class="confirmType === 'error' ? 'shadow-rose-400/20' : 'shadow-sky-400/20'"
            @click="handleConfirm"
          >
            确定
          </PButton>
        </div>
      </template>
    </PModal>
    <!-- 7. 手机连接二维码 -->
    <PModal
      v-model="showQrModal"
      title="连接手机端"
      size="sm"
      :show-confirm="false"
      cancel-text="关闭"
    >
      <div class="flex flex-col items-center gap-6 py-4">
        <div class="p-4 bg-white pixel-border-sky shadow-xl">
          <QrcodeVue :value="qrValue" :size="200" level="H" render-as="svg" />
        </div>
        <div class="text-center space-y-2">
          <p class="text-sm font-bold text-slate-700">请使用 PeroperoChat PE版 扫码连接</p>
          <p class="text-xs text-slate-400 leading-relaxed px-4">
            确保您的手机与电脑处于同一局域网（WiFi）下。<br />
            连接后即可实现远程遥控与同步。
          </p>
        </div>
        <div class="w-full bg-sky-50 p-3 pixel-border-sm space-y-2">
          <div class="flex justify-between text-[10px] font-bold">
            <span class="text-slate-400">SERVER IP</span>
            <span class="text-sky-600">{{ connectionInfo?.ip }}</span>
          </div>
          <div class="flex justify-between text-[10px] font-bold">
            <span class="text-slate-400">PORT</span>
            <span class="text-sky-600">{{ connectionInfo?.port }}</span>
          </div>
        </div>
      </div>
    </PModal>

    <!-- 引导图层喵~ 🎭 -->
    <OnboardingOverlay
      v-model:is-visible="showOnboarding"
      type="dashboard"
      @finish="handleOnboardingFinish"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, provide } from 'vue'
import QrcodeVue from 'qrcode.vue'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { listen, invoke, isElectron } from '@/utils/ipcAdapter'
import AsyncMarkdown from '../components/markdown/AsyncMarkdown.vue'
import PButton from '../components/ui/PButton.vue'
import PModal from '../components/ui/PModal.vue'
import PInput from '../components/ui/PInput.vue'
import PSelect from '../components/ui/PSelect.vue'
import PTextarea from '../components/ui/PTextarea.vue'
import PTooltip from '../components/ui/PTooltip.vue'
import PCheckbox from '../components/ui/PCheckbox.vue'
import PSwitch from '../components/ui/PSwitch.vue'
import PInputNumber from '../components/ui/PInputNumber.vue'
import PixelIcon from '../components/ui/PixelIcon.vue'
import logoImg from '../assets/logo.png'
import { gatewayClient } from '../api/gateway'
import OnboardingOverlay from '../components/onboarding/OnboardingOverlay.vue'

// 选项卡组件
import OverviewTab from '../components/dashboard/tabs/OverviewTab.vue'
import LogsTab from '../components/dashboard/tabs/LogsTab.vue'
import MemoriesTab from '../components/dashboard/tabs/MemoriesTab.vue'
import TasksTab from '../components/dashboard/tabs/TasksTab.vue'
import ModelConfigTab from '../components/dashboard/tabs/ModelConfigTab.vue'
import VoiceTab from '../components/dashboard/tabs/VoiceTab.vue'
import McpTab from '../components/dashboard/tabs/McpTab.vue'
import UserSettingsTab from '../components/dashboard/tabs/UserSettingsTab.vue'
import ResetTab from '../components/dashboard/tabs/ResetTab.vue'
import NapCatTab from '../components/dashboard/tabs/NapCatTab.vue'
import TerminalTab from '../components/dashboard/tabs/TerminalTab.vue'

// 组合式函数
import { useDashboard, API_BASE, fetchWithTimeout } from '@/composables/dashboard/useDashboard'
import { useAgentConfig } from '@/composables/dashboard/useAgentConfig'
import { useDashboardData } from '@/composables/dashboard/useDashboardData'
import { useLogs } from '@/composables/dashboard/useLogs'
import { useMemories } from '@/composables/dashboard/useMemories'
import { useTasks } from '@/composables/dashboard/useTasks'
import {
  useModelConfig,
  providerOptions,
  mcpTypeOptions,
  providerDefaults
} from '@/composables/dashboard/useModelConfig'

const {
  currentTab,
  isBackendOnline,
  isSaving,
  isGlobalRefreshing,
  particles,
  initParticles,
  showConfirmModal,
  confirmModalTitle,
  confirmModalContent,
  confirmType,
  isPrompt,
  promptValue,
  promptPlaceholder,
  openConfirm,
  handleConfirm,
  handleCancel,
  showImageViewer,
  imageViewerList,
  imageViewerIndex,
  openImageViewer,
  appVersion,
  updateStatus,
  isCheckingUpdate,
  checkForUpdates,
  handleUpdateMessage,
  showQrModal,
  connectionInfo,
  isLoadingConnection,
  fetchConnectionInfo,
  handleQuitApp,
  handleTabSelect,
  menuGroups
} = useDashboard()

const {
  availableAgents,
  activeAgent,
  isSwitchingAgent,
  fetchAgents,
  switchAgent,
  napCatStatus,
  isCompanionEnabled,
  isTogglingCompanion,
  toggleCompanion,
  fetchCompanionStatus,
  isSocialEnabled,
  isTogglingSocial,
  toggleSocial,
  fetchSocialStatus,
  isLightweightEnabled,
  isTogglingLightweight,
  toggleLightweight,
  fetchLightweightStatus,
  isAuraVisionEnabled,
  isTogglingAuraVision,
  toggleAuraVision,
  fetchAuraVisionStatus,
  activeMemoryTab,
  isSavingMemoryConfig,
  memoryConfig,
  fetchMemoryConfig,
  saveMemoryConfig
} = useAgentConfig()

const { stats, petState, nitStatus, ambientLightStyle, fetchStats, fetchPetState, fetchNitStatus } =
  useDashboardData({ activeAgent, isBackendOnline, isGlobalRefreshing, currentTab })

const {
  logs,
  isLogsFetching,
  selectedSource,
  selectedSessionId,
  lastSyncedSessionId,
  selectedDate,
  selectedSort,
  editingLogId,
  editingContent,
  showDebugDialog,
  currentDebugLog,
  debugSegments,
  debugViewMode,
  currentPromptMessages,
  isLoadingPrompt,
  totalPromptLength,
  initSessionAndFetchLogs,
  fetchLogs,
  startLogEdit,
  cancelLogEdit,
  saveLogEdit,
  deleteLog,
  retryLogAnalysis,
  openDebugDialog,
  handleDebugModeChange,
  handleLogUpdate,
  getLogMetadata,
  getSentimentEmoji,
  getSentimentLabel,
  formatLogContent
} = useLogs({ activeAgent, currentTab, openConfirm })

const {
  memories,
  tagCloud,
  memoryFilterTags,
  memoryFilterDate,
  memoryFilterType,
  memoryViewMode,
  memoryGraphData,
  isLoadingGraph,
  graphRef,
  topTags,
  isClearingEdges,
  isScanningLonely,
  isRunningMaintenance,
  isDreaming,
  showImportStoryDialog,
  importStoryText,
  isImportingStory,
  fetchMemories,
  fetchTagCloud,
  fetchMemoryGraph,
  initGraph,
  disposeGraph,
  deleteMemory,
  clearOrphanedEdges,
  triggerScanLonely,
  triggerMaintenance,
  triggerDream,
  handleImportStory,
  getMemoryTypeLabel,
  getSentimentColor
} = useMemories({ activeAgent, currentTab, openConfirm })

const { tasks, fetchTasks, deleteTask } = useTasks({ activeAgent, openConfirm })

const {
  globalConfig,
  showGlobalSettings,
  currentModelTab,
  fetchConfig,
  openGlobalSettings,
  saveGlobalSettings,
  handleGlobalProviderChange,
  models,
  showModelEditor,
  remoteModels,
  isFetchingRemote,
  currentEditingModel,
  currentActiveModelId,
  secretaryModelId,
  reflectionModelId,
  auxModelId,
  fetchModels,
  openModelEditor,
  handleProviderChange,
  fetchRemoteModels,
  saveModel,
  deleteModel,
  setActiveModel,
  setSecretaryModel,
  setReflectionModel,
  setAuxModel,
  embeddingProvider,
  embeddingModelId,
  embeddingApiBase,
  embeddingApiKey,
  rerankerEnabled,
  rerankerProvider,
  rerankerModelId,
  rerankerApiBase,
  rerankerApiKey,
  embeddingDimension,
  isReindexing,
  availableEmbeddingModels,
  isFetchingEmbeddingModels,
  handleEmbeddingProviderChange,
  fetchRemoteVectorModels,
  saveVectorConfig,
  triggerReindex,
  mcps,
  showMcpEditor,
  currentEditingMcp,
  fetchMcps,
  openMcpEditor,
  saveMcp,
  deleteMcp,
  toggleMcpEnabled,
  userSettings,
  saveUserSettings,
  handleSystemReset: _handleSystemReset
} = useModelConfig({ memories, isSaving, openConfirm })

const isCurrentModelVisionEnabled = computed(() => {
  if (!currentActiveModelId.value || !models.value.length) return false
  const activeModel = models.value.find((m) => m.id === currentActiveModelId.value)
  return activeModel ? !!activeModel.enable_vision : false
})

const handleSystemReset = () => _handleSystemReset(activeAgent, fetchAllData, currentTab)

// --- 向选项卡组件提供所有组合式状态 ---
import {
  DASHBOARD_KEY,
  AGENT_CONFIG_KEY,
  DASHBOARD_DATA_KEY,
  LOGS_KEY,
  MEMORIES_KEY,
  TASKS_KEY,
  MODEL_CONFIG_KEY
} from '@/composables/dashboard/injectionKeys'

provide(DASHBOARD_KEY, {
  currentTab,
  isBackendOnline,
  isSaving,
  isGlobalRefreshing,
  particles,
  initParticles,
  showConfirmModal,
  confirmModalTitle,
  confirmModalContent,
  confirmType,
  isPrompt,
  promptValue,
  promptPlaceholder,
  openConfirm,
  handleConfirm,
  handleCancel,
  showImageViewer,
  imageViewerList,
  imageViewerIndex,
  openImageViewer,
  appVersion,
  updateStatus,
  isCheckingUpdate,
  checkForUpdates,
  handleUpdateMessage,
  showQrModal,
  connectionInfo,
  isLoadingConnection,
  fetchConnectionInfo,
  handleQuitApp,
  handleTabSelect,
  menuGroups
})

provide(AGENT_CONFIG_KEY, {
  availableAgents,
  activeAgent,
  isSwitchingAgent,
  fetchAgents,
  switchAgent,
  napCatStatus,
  isCompanionEnabled,
  isTogglingCompanion,
  toggleCompanion,
  fetchCompanionStatus,
  isSocialEnabled,
  isTogglingSocial,
  toggleSocial,
  fetchSocialStatus,
  isLightweightEnabled,
  isTogglingLightweight,
  toggleLightweight,
  fetchLightweightStatus,
  isAuraVisionEnabled,
  isTogglingAuraVision,
  toggleAuraVision,
  fetchAuraVisionStatus,
  activeMemoryTab,
  isSavingMemoryConfig,
  memoryConfig,
  fetchMemoryConfig,
  saveMemoryConfig
})

provide(DASHBOARD_DATA_KEY, {
  stats,
  petState,
  nitStatus,
  ambientLightStyle,
  fetchStats,
  fetchPetState,
  fetchNitStatus
})

provide(LOGS_KEY, {
  logs,
  isLogsFetching,
  selectedSource,
  selectedSessionId,
  lastSyncedSessionId,
  selectedDate,
  selectedSort,
  editingLogId,
  editingContent,
  showDebugDialog,
  currentDebugLog,
  debugSegments,
  debugViewMode,
  currentPromptMessages,
  isLoadingPrompt,
  totalPromptLength,
  initSessionAndFetchLogs,
  fetchLogs,
  startLogEdit,
  cancelLogEdit,
  saveLogEdit,
  deleteLog,
  retryLogAnalysis,
  openDebugDialog,
  handleDebugModeChange,
  handleLogUpdate,
  getLogMetadata,
  getSentimentEmoji,
  getSentimentLabel,
  formatLogContent
})

provide(MEMORIES_KEY, {
  memories,
  tagCloud,
  memoryFilterTags,
  memoryFilterDate,
  memoryFilterType,
  memoryViewMode,
  memoryGraphData,
  isLoadingGraph,
  graphRef,
  topTags,
  isClearingEdges,
  isScanningLonely,
  isRunningMaintenance,
  isDreaming,
  showImportStoryDialog,
  importStoryText,
  isImportingStory,
  fetchMemories,
  fetchTagCloud,
  fetchMemoryGraph,
  initGraph,
  disposeGraph,
  deleteMemory,
  clearOrphanedEdges,
  triggerScanLonely,
  triggerMaintenance,
  triggerDream,
  handleImportStory,
  getMemoryTypeLabel,
  getSentimentColor
})

provide(TASKS_KEY, { tasks, fetchTasks, deleteTask })

provide(MODEL_CONFIG_KEY, {
  globalConfig,
  showGlobalSettings,
  currentModelTab,
  fetchConfig,
  openGlobalSettings,
  saveGlobalSettings,
  handleGlobalProviderChange,
  models,
  showModelEditor,
  remoteModels,
  isFetchingRemote,
  currentEditingModel,
  currentActiveModelId,
  secretaryModelId,
  reflectionModelId,
  auxModelId,
  fetchModels,
  openModelEditor,
  handleProviderChange,
  fetchRemoteModels,
  saveModel,
  deleteModel,
  setActiveModel,
  setSecretaryModel,
  setReflectionModel,
  setAuxModel,
  embeddingProvider,
  embeddingModelId,
  embeddingApiBase,
  embeddingApiKey,
  embeddingDimension,
  isReindexing,
  availableEmbeddingModels,
  isFetchingEmbeddingModels,
  handleEmbeddingProviderChange,
  fetchRemoteVectorModels,
  saveVectorConfig,
  triggerReindex,
  mcps,
  showMcpEditor,
  currentEditingMcp,
  fetchMcps,
  openMcpEditor,
  saveMcp,
  deleteMcp,
  toggleMcpEnabled,
  userSettings,
  saveUserSettings,
  handleSystemReset,
  isCurrentModelVisionEnabled,
  providerOptions,
  mcpTypeOptions,
  providerDefaults
})

// isCurrentModelVisionEnabled 已在 useModelConfig() 之后定义（第968行附近）

const showOnboarding = ref(false)
const appConfig = ref({})
const handleOnboardingFinish = async (choice) => {
  if (!isElectron()) {
    showOnboarding.value = false
    appConfig.value = { ...appConfig.value, onboarding_completed: true }
    return
  }

  if (choice === 'launch') {
    try {
      const config = await invoke('get_config')
      config.onboarding_completed = true
      await invoke('save_config', { config })
      await invoke('open_pet_window')
      await invoke('close_dashboard')
    } catch (e) {
      console.error('启动失败:', e)
    }
  } else if (choice === 'stay') {
    showOnboarding.value = false
    setTimeout(() => {
      showOnboarding.value = true
    }, 500)
  } else {
    const config = await invoke('get_config')
    config.onboarding_completed = true
    await invoke('save_config', { config })
  }
}

const qrValue = computed(() => {
  if (!connectionInfo.value) return ''
  return `perolink://${connectionInfo.value.ip}:${connectionInfo.value.port}#${connectionInfo.value.token}`
})

const pollingInterval = ref(null)

const fetchAllData = async (silent = false) => {
  if (!isBackendOnline.value || isGlobalRefreshing.value) return
  isGlobalRefreshing.value = true
  try {
    await Promise.all([
      fetchPetState(),
      fetchConfig({ selectedSessionId, lastSyncedSessionId }),
      fetchStats(),
      fetchAgents()
    ])
  } catch {
    console.error('核心数据获取错误')
  }
  setTimeout(async () => {
    try {
      await Promise.all([
        fetchModels(),
        fetchMcps(),
        fetchCompanionStatus(),
        fetchSocialStatus(),
        fetchLightweightStatus(),
        fetchAuraVisionStatus(),
        fetchNitStatus()
      ])
    } catch {
      console.error('次要数据获取错误')
    }
  }, 100)
  setTimeout(async () => {
    try {
      if (currentTab.value === 'logs') await initSessionAndFetchLogs()
      if (currentTab.value === 'memories') await fetchMemories()
      if (currentTab.value === 'tasks') await fetchTasks()
      if (currentTab.value !== 'logs') initSessionAndFetchLogs()
      if (currentTab.value !== 'memories') fetchMemories()
      if (currentTab.value !== 'tasks') fetchTasks()
      fetchTagCloud()
      if (!silent) window.$notify('所有数据已同步', 'success')
    } catch {
      console.error('标签页数据获取错误')
      if (!silent) window.$notify('部分数据刷新失败', 'error')
    } finally {
      isGlobalRefreshing.value = false
    }
  }, 200)
}

const waitForBackend = async () => {
  const maxRetries = 60
  let retries = 0
  const check = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/pet/state`, { silent: true }, 2000)
      if (res.ok) {
        isBackendOnline.value = true
        await fetchAllData(true)
        fetchMemoryConfig()
        return
      }
    } catch {
      /* silent */
    }
    if (retries < maxRetries) {
      retries++
      isBackendOnline.value = false
      setTimeout(check, 1000)
    } else window.$notify('无法连接到 Pero 后端，请检查后台进程是否运行。', 'error')
  }
  check()
}

watch(memoryViewMode, (val) => {
  if (val === 'graph') {
    nextTick(() => {
      if (memoryGraphData.value.nodes.length > 0) initGraph()
      else fetchMemoryGraph()
    })
  } else {
    disposeGraph()
  }
})

watch(currentTab, (newTab) => {
  if (newTab === 'logs') initSessionAndFetchLogs()
  else if (newTab === 'memories' && memories.value.length === 0) fetchMemories()
  else if (newTab === 'tasks' && tasks.value.length === 0) fetchTasks()
  if (newTab !== 'memories') disposeGraph()
})

watch([selectedSessionId, selectedSource, selectedSort, selectedDate], () => {
  if (currentTab.value === 'logs') fetchLogs()
})

watch(activeAgent, () => {
  memories.value = []
  logs.value = []
  tasks.value = []
  fetchStats()
  if (currentTab.value === 'logs') fetchLogs()
  else if (currentTab.value === 'memories') fetchMemories()
  else if (currentTab.value === 'tasks') fetchTasks()
})

watch(embeddingProvider, (newVal) => {
  if (newVal === 'api' && isAuraVisionEnabled.value) toggleAuraVision(false)
})

const listenSafe = (event, callback) => {
  if (!isElectron()) return Promise.resolve(() => {})
  return listen(event, callback)
}
const handleStateUpdate = () => {
  if (currentTab.value === 'overview') fetchPetState()
}
const handleScheduleUpdate = () => {
  if (currentTab.value === 'tasks') fetchTasks()
}
const handleAgentChanged = () => {
  fetchAgents()
}
const _handleLogUpdate = (data) => {
  if (currentTab.value === 'logs') handleLogUpdate(data, fetchLogs)
}

onMounted(async () => {
  initParticles()
  waitForBackend()
  watch(
    isBackendOnline,
    (online) => {
      if (online) {
        console.log('[Dashboard] Backend online, Gateway 连接由 App 鉴权层接管')
      }
    },
    { immediate: false }
  )
  gatewayClient.on('action:agent_changed', (payload) => {
    const agentId = payload.agent_id || (payload.params && payload.params.agent_id)
    if (agentId) fetchAgents().then(() => fetchAllData(true))
  })
  gatewayClient.on('action:new_message', (payload) => {
    if (currentTab.value === 'logs') {
      const exists = logs.value.some((l) => l.id == payload.id)
      if (!exists) {
        logs.value = [
          Object.freeze({
            ...payload,
            displayTime: new Date(payload.timestamp).toLocaleString(),
            metadata: JSON.parse(payload.metadata || '{}'),
            sentiment: 'neutral',
            importance: 1,
            analysis_status: 'pending'
          }),
          ...logs.value
        ]
        stats.value.total_logs = (stats.value.total_logs || 0) + 1
      }
    }
  })
  if (isElectron()) {
    try {
      const config = await invoke('get_config')
      appConfig.value = config
      if (config.onboarding_completed !== true) showOnboarding.value = true
    } catch (e) {
      console.error('加载配置失败:', e)
    }
  } else {
    appConfig.value = { onboarding_completed: true }
    showOnboarding.value = false
  }
  await listenSafe('update-message', (data) => handleUpdateMessage(data, openConfirm))
  if (isElectron()) {
    try {
      const v = await invoke('get_app_version')
      if (v) appVersion.value = v
    } catch {
      /* noop */
    }
  } else {
    appVersion.value = 'web'
  }
  gatewayClient.on('action:state_update', handleStateUpdate)
  gatewayClient.on('action:schedule_update', handleScheduleUpdate)
  gatewayClient.on('action:agent_changed', handleAgentChanged)
  gatewayClient.on('action:log_updated', _handleLogUpdate)
  pollingInterval.value = setInterval(() => {
    if (!isBackendOnline.value) return
    fetchSocialStatus().catch(() => {})
  }, 5000)
  if (window.electron && window.electron.on) {
    let logFetchTimeout = null
    window.electron.on('history-update', () => {
      if (logFetchTimeout) clearTimeout(logFetchTimeout)
      logFetchTimeout = setTimeout(() => {
        fetchLogs()
        logFetchTimeout = null
      }, 500)
    })
  }
})

onUnmounted(() => {
  gatewayClient.off('action:new_message')
  gatewayClient.off('action:state_update', handleStateUpdate)
  gatewayClient.off('action:schedule_update', handleScheduleUpdate)
  gatewayClient.off('action:agent_changed', handleAgentChanged)
  gatewayClient.off('action:log_updated', _handleLogUpdate)
  if (pollingInterval.value) clearInterval(pollingInterval.value)
  disposeGraph()
})
</script>

<style scoped>
/* 平面化动作按钮 */
.flat-action-btn {
  box-shadow: none !important;
  border: 1.5px solid rgba(255, 255, 255, 0.3) !important;
  background-image: none !important;
  transition: all 0.2s ease !important;
}

.flat-action-btn:hover {
  transform: translateY(-1px) !important;
  filter: brightness(1.05);
}

.flat-action-btn:active {
  transform: translateY(0) !important;
}

/* 动画效果 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

/* 自定义滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

.state-box .label {
  font-size: 13px;
  color: var(--healing-text-light);
  display: block;
  margin-bottom: 6px;
}
.state-box .value {
  font-size: 20px;
  font-weight: 800;
  color: var(--healing-text);
  margin-bottom: 12px;
  display: block;
}

/* 日志视图 */
.logs-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.filter-card {
  margin-bottom: 16px;
}

.chat-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.2); /* 更浅的玻璃效果 */
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-right: -10px;
  padding-right: 20px;
}

.chat-bubble-wrapper {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.chat-bubble-wrapper.assistant {
  flex-direction: row;
}
.chat-bubble-wrapper.user {
  flex-direction: row-reverse;
}

.avatar {
  width: 44px;
  height: 44px;
  background: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
  border: 2px solid white;
}

.bubble-content-box {
  max-width: 70%;
  padding: 16px 20px;
  border-radius: 20px; /* 更圆润 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  position: relative;
  transition: all 0.3s;
}

.chat-bubble-wrapper.user .bubble-content-box {
  background: var(--healing-primary); /* 天蓝色 */
  color: white;
  border-bottom-right-radius: 4px; /* 圆角矩形效果 */
  box-shadow: 0 4px 12px rgba(108, 180, 238, 0.3);
}

/* 消息气泡样式 */
.chat-bubble-wrapper {
  display: flex;
  margin-bottom: 20px;
  max-width: 85%;
  position: relative;
}

.chat-bubble-wrapper.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

.bubble-content-box {
  padding: 12px 18px;
  border-radius: 20px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  position: relative;
  transition: all 0.3s;
}

.chat-bubble-wrapper.user .bubble-content-box {
  background: var(--healing-primary);
  color: white;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 12px rgba(108, 180, 238, 0.3);
}

.chat-bubble-wrapper.assistant .bubble-content-box {
  background: white;
  color: var(--healing-text);
  border-bottom-left-radius: 4px;
}

.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--healing-text-light);
  margin-bottom: 8px;
}

.log-meta-tag {
  background: rgba(0, 0, 0, 0.05);
  padding: 2px 8px; /* 更大的胶囊形 */
  border-radius: 12px;
  cursor: help;
  font-weight: 600;
}

.log-meta-tag.importance {
  color: #f59e0b; /* amber-500 */
  background: #fffbeb; /* amber-50 */
}

.log-meta-tag.memory {
  background: #f0f9ff; /* sky-50 */
  color: #0ea5e9; /* sky-500 */
}

.message-markdown {
  font-size: 15px;
  line-height: 1.6;
}

/* 用户文本颜色修复 (Markdown) */
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body p),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body span),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body li),
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body strong) {
  color: white !important;
}

/* 用户气泡元信息颜色修复 */
.chat-bubble-wrapper.user .bubble-meta {
  color: rgba(255, 255, 255, 0.9) !important;
}
.chat-bubble-wrapper.user .bubble-meta .role-name,
.chat-bubble-wrapper.user .bubble-meta .time {
  color: inherit !important;
}

/* 排除有自身样式的代码块的白色覆盖 */
.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body code) {
  color: #c7254e; /* 默认代码颜色 */
  background-color: #f9f2f4;
  border-radius: 4px;
  padding: 2px 4px;
}

.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body pre) {
  background-color: #f8fafc; /* slate-50 */
  color: #1e293b; /* slate-800 */
}

.chat-bubble-wrapper.user .message-content-wrapper :deep(.markdown-body pre code) {
  color: inherit;
  background-color: transparent;
}

/* Markdown 内的触发器块 */
:deep(.trigger-block) {
  margin: 12px 0;
  border-radius: 16px; /* 圆角块 */
  overflow: hidden;
  font-size: 13px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  background: white;
}

:deep(.trigger-header) {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.03);
  font-weight: bold;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  list-style: none;
  outline: none;
}

:deep(.trigger-header::-webkit-details-marker) {
  display: none;
}

:deep(.expand-arrow) {
  margin-left: auto;
  font-size: 10px;
  color: #94a3b8; /* slate-400 */
  transition: transform 0.2s;
}

:deep(details[open] .expand-arrow) {
  transform: rotate(90deg);
}

:deep(.trigger-title) {
  flex: 1;
}

:deep(.trigger-body) {
  padding: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

/* 特定块主题 */
:deep(.trigger-block.perocue) {
  border-color: #fca5a5; /* red-300 */
}
:deep(.trigger-block.perocue .trigger-header) {
  background: linear-gradient(90deg, #fff1f2, #ffe4e6); /* red-50/100 */
  color: #f43f5e; /* rose-500 */
}

:deep(.trigger-block.memory) {
  border-color: #bae6fd; /* sky-200 */
}
:deep(.trigger-block.memory .trigger-header) {
  background: linear-gradient(90deg, #f0f9ff, #e0f2fe); /* sky-50/100 */
  color: #0ea5e9; /* sky-500 */
}

:deep(.trigger-block.click_messages) {
  border-color: #fde047; /* yellow-300 */
}
:deep(.trigger-block.click_messages .trigger-header) {
  background: linear-gradient(90deg, #fefce8, #fef9c3); /* yellow-50/100 */
  color: #a16207; /* yellow-700 */
}

:deep(.trigger-block.idle_messages),
:deep(.trigger-block.back_messages) {
  border-color: #7dd3fc; /* sky-300 */
}
:deep(.trigger-block.idle_messages .trigger-header),
:deep(.trigger-block.back_messages .trigger-header) {
  background: linear-gradient(90deg, #f0f9ff, #e0f2fe); /* sky-50/100 */
  color: #0ea5e9; /* sky-500 */
}

:deep(.trigger-block.unknown-xml) {
  border-color: #cbd5e1; /* slate-300 */
}
:deep(.trigger-block.unknown-xml .trigger-header) {
  background: linear-gradient(90deg, #f8fafc, #f1f5f9); /* slate-50/100 */
  color: #64748b; /* slate-500 */
}

/* 子元素样式 */
:deep(.pero-meta-row) {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  align-items: center;
}

:deep(.pero-label) {
  font-size: 11px;
  color: #64748b; /* slate-500 */
  background: #f1f5f9; /* slate-100 */
  padding: 2px 6px;
  border-radius: 4px;
}

:deep(.pero-val) {
  font-weight: 600;
  color: #1e293b; /* slate-800 */
}

:deep(.pero-mind-box) {
  background: #fff5f7; /* rose-50 */
  border-left: 3px solid #fda4af; /* rose-300 */
  padding: 8px 10px;
  border-radius: 4px;
  font-style: italic;
  color: #475569; /* slate-600 */
  line-height: 1.5;
}

:deep(.pero-memory-content) {
  line-height: 1.6;
  margin-bottom: 10px;
  color: #334155; /* slate-700 */
}

:deep(.pero-tag-cloud) {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

:deep(.pero-tag) {
  background: #f3e5f5;
  color: #7b1fa2;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

:deep(.pero-click-grid) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px;
}

:deep(.pero-part-card) {
  background: #fdfdfb; /* stone-50 */
  border: 1px solid #fde68a; /* amber-200 */
  border-radius: 8px;
  padding: 8px;
}

:deep(.part-name) {
  font-size: 11px;
  font-weight: bold;
  color: #92400e; /* amber-800 */
  margin-bottom: 4px;
  border-bottom: 1px dashed #fef3c7; /* amber-100 */
  padding-bottom: 2px;
}

:deep(.part-list),
:deep(.pero-topic-box),
:deep(.pero-task-box) {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: #475569; /* slate-600 */
}

:deep(.part-list li) {
  margin-bottom: 2px;
}

:deep(.pero-task-box),
:deep(.pero-topic-box) {
  padding: 8px;
  background: #f0f9ff; /* sky-50 */
  border-radius: 6px;
  color: #0284c7; /* sky-600 */
  list-style: none;
}

:deep(.trigger-block.error) {
  border-color: #fca5a5; /* red-300 */
  color: #ef4444; /* red-500 */
  padding: 8px;
  background: #fef2f2; /* red-50 */
}

.bubble-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.chat-bubble-wrapper:hover .bubble-actions {
  opacity: 1;
}

.chat-bubble-wrapper.editing .bubble-content-box {
  max-width: 100%;
  width: 100%;
}

/* 记忆视图 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.section-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--healing-text);
  margin: 0;
  letter-spacing: 0.5px;
}

.memory-header-enhanced {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-icon-wrapper {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #7dd3fc 0%, #0ea5e9 100%); /* sky-300 to sky-500 */
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 10px rgba(14, 165, 233, 0.3);
  color: white;
  font-size: 20px;
}

.header-text-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.section-title-enhanced {
  font-size: 20px;
  font-weight: 800;
  margin: 0;
  background: linear-gradient(90deg, #0369a1 0%, #0ea5e9 100%); /* sky-700 to sky-500 */
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: #0369a1;
  line-height: 1.2;
}

.section-subtitle {
  font-size: 10px;
  color: #64748b; /* slate-500 */
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-top: 2px;
}

.memory-waterfall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  align-items: start;
}

.memory-item {
  margin-bottom: 0;
}

.memory-card {
  border-radius: 16px !important;
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
  cursor: default;
  border: 1px solid rgba(255, 255, 255, 0.6) !important;
  background: rgba(255, 255, 255, 0.75) !important;
  backdrop-filter: blur(16px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03) !important;
  position: relative;
  overflow: hidden;
  padding-top: 5px; /* 为顶栏留出空间 */
}

.memory-card:hover {
  transform: translateY(-5px) scale(1.01);
  background: rgba(255, 255, 255, 0.95) !important;
  box-shadow:
    0 15px 30px rgba(0, 0, 0, 0.08),
    0 5px 15px rgba(0, 0, 0, 0.04) !important;
  z-index: 10;
  border-color: rgba(255, 255, 255, 0.9) !important;
}

/* 渐变色编码 */
.memory-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: #cbd5e1; /* slate-300 */
  z-index: 1;
}

.memory-card.preference::after {
  background: linear-gradient(90deg, #fb7185 0%, #fda4af 100%); /* rose-400 to rose-300 */
}
.memory-card.event::after {
  background: linear-gradient(90deg, #7dd3fc 0%, #bae6fd 100%); /* sky-300 to sky-200 */
}
.memory-card.fact::after {
  background: linear-gradient(90deg, #38bdf8 0%, #7dd3fc 100%); /* sky-400 to sky-300 */
}
.memory-card.summary::after {
  background: linear-gradient(90deg, #fbbf24 0%, #fcd34d 100%); /* amber-400 to amber-300 */
}
.memory-card.promise::after {
  background: linear-gradient(90deg, #38bdf8 0%, #7dd3fc 100%); /* sky-400 to sky-300 */
}
.memory-card.work_log::after {
  background: linear-gradient(90deg, #94a3b8 0%, #cbd5e1 100%); /* slate-400 to slate-300 */
}

/* 移除旧的特定边框 */
.memory-card.preference,
.memory-card.event,
.memory-card.fact,
.memory-card.summary {
  border-top: none !important;
}

.memory-text {
  font-size: 14.5px;
  line-height: 1.65;
  color: #334155; /* slate-700 */
  margin: 12px 0 16px 0;
  padding: 0 4px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.memory-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-top: 8px; /* 因有顶栏而增加的额外内边距 */
}

.memory-bottom {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}

.mini-tag {
  border: none !important;
  font-weight: 600;
  letter-spacing: 0.3px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
}

/* 增强记忆工具栏 */
.memory-toolbar {
  flex-direction: column !important;
  align-items: stretch !important;
  gap: 15px;
  height: auto !important;
}

.filters-glass-panel {
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 16px;
  padding: 12px 16px;
  margin-bottom: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.filter-row-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.filter-group-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.filter-group-right {
  display: flex;
  align-items: center;
}

.agent-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.5);
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.agent-selector-wrapper .label {
  font-size: 12px;
  color: #64748b; /* slate-500 */
  font-weight: 500;
}

.agent-name {
  font-weight: 600;
  color: var(--healing-primary);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}

.divider-vertical {
  width: 1px;
  height: 20px;
  background: rgba(0, 0, 0, 0.06);
  margin: 0 4px;
}

.filter-row-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px dashed rgba(0, 0, 0, 0.05);
  padding-top: 10px;
}

.tag-cloud-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow: hidden;
  margin-right: 15px;
}

.tag-label {
  font-size: 11px;
  color: #94a3b8; /* slate-400 */
  white-space: nowrap;
}

.tag-scroll-area {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 2px;
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.tag-scroll-area::-webkit-scrollbar {
  display: none;
}

.glass-check-tag {
  background: rgba(255, 255, 255, 0.4) !important;
  border: 1px solid rgba(0, 0, 0, 0.05) !important;
  font-size: 11px !important;
  padding: 2px 8px !important;
  border-radius: 6px !important;
  color: #475569; /* slate-600 */
  transition: all 0.2s !important;
  cursor: pointer;
}

.glass-check-tag:hover {
  background: #fff !important;
  color: var(--healing-primary) !important;
}

.glass-check-tag.is-checked {
  background: var(--healing-primary) !important;
  color: white !important;
  border-color: var(--healing-primary) !important;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.glass-button {
  border: 1px solid rgba(0, 0, 0, 0.05) !important;
  background: rgba(255, 255, 255, 0.6) !important;
  transition: all 0.2s !important;
}

.glass-button:hover {
  transform: translateY(-2px);
  background: #fff !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* 任务瀑布流 */
.task-waterfall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  align-items: start;
}

.task-item {
  margin-bottom: 0;
}

.task-card-modern {
  border-radius: var(--radius-md) !important;
  transition: all 0.3s;
  border: none !important;
  background: rgba(255, 255, 255, 0.7) !important;
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

.task-card-modern:hover {
  transform: translateY(-3px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08) !important;
}

.task-card-modern.reminder {
  border-left: 4px solid #f43f5e !important; /* rose-500 */
}
.task-card-modern.topic {
  border-left: 4px solid #0ea5e9 !important; /* sky-500 */
}
.task-card-modern.todo {
  border-left: 4px solid #0ea5e9 !important; /* sky-500 */
}

.task-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.task-content {
  font-size: 14px;
  color: var(--healing-text);
  line-height: 1.6;
  margin-bottom: 14px;
  font-weight: 500;
}

.task-bottom {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding-top: 10px;
}

.task-time {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--healing-text-light);
}

/* 修复对话框透明度问题 */
.custom-modal-content {
  background: rgba(15, 23, 42, 0.95) !important; /* slate-900 */
  backdrop-filter: blur(20px);
  border-radius: 24px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 确保自定义组件中的输入文本可见 */
.p-input-inner {
  color: #f1f5f9 !important; /* slate-100 */
}

.memory-top {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.memory-text {
  font-size: 14px;
  color: #475569; /* slate-600 */
  line-height: 1.5;
  margin-bottom: 12px;
}
.memory-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.time-hint {
  font-size: 11px;
  color: #94a3b8; /* slate-400 */
}

/* 模型网格 */
.models-grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.model-config-card {
  border-radius: 12px;
  position: relative;
  overflow: hidden;
}

.status-badge {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.5);
  padding: 4px 8px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.05);
  transition: all 0.3s;
  cursor: help;
}

.status-badge:hover {
  background: rgba(255, 255, 255, 0.8);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #94a3b8; /* 离线 - slate-400 */
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8);
  transition: all 0.3s;
}

.status-dot.online {
  background-color: #0ea5e9; /* 在线 - sky-500 */
  box-shadow: 0 0 4px #0ea5e9;
}

.status-dot.warning {
  background-color: #f59e0b; /* amber-500 */
}

.status-dot.offline {
  background-color: #f43f5e; /* rose-500 */
}

.model-config-card.active-main {
  border: 2px solid var(--healing-primary);
}
.model-config-card.active-secretary {
  border: 2px solid #f59e0b; /* amber-500 */
}
.model-config-card.active-reflection {
  border: 2px solid #0284c7; /* sky-600 */
}

/* 滚动条美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.model-header h3 {
  margin: 0;
  font-size: 16px;
}

.model-body p {
  margin: 4px 0;
  font-size: 13px;
  color: #64748b; /* slate-500 */
}

.model-actions {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.utils-group {
  display: flex;
  gap: 4px;
}

/* MCP 卡片现代风格 */
.mcp-card-modern {
  border-radius: 12px;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.mcp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.mcp-title {
  font-weight: bold;
  font-size: 15px;
}
.mcp-info {
  flex: 1;
  margin-bottom: 12px;
}
.mcp-detail {
  font-size: 12px;
  color: #64748b; /* slate-500 */
  margin-top: 4px;
  word-break: break-all;
  font-family: monospace;
  background: #f1f5f9; /* slate-100 */
  padding: 4px;
  border-radius: 4px;
}
.mcp-footer {
  display: flex;
  justify-content: flex-end;
}

/* 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* 列表过渡 */
.list-enter-active,
.list-leave-active {
  transition: all 0.4s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

/* 响应式 */
@media (max-width: 768px) {
  .memory-waterfall,
  .task-waterfall {
    column-count: 1;
  }
  .glass-sidebar {
    display: none;
  } /* 移动端待办 */
}

/* 仪表盘全局编辑输入框样式 */
.dashboard-edit-textarea {
  font-size: 15px;
  line-height: 1.6;
  padding: 12px 16px;
  border-radius: 12px;
  background-color: #ffffff;
  border: 2px solid #e2e8f0; /* slate-200 */
  color: #1e293b; /* slate-800 */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transition: all 0.3s ease;
  font-family: 'Segoe UI', system-ui, sans-serif;
  width: 100%;
  outline: none;
}

.dashboard-edit-textarea:focus {
  border-color: #0ea5e9; /* sky-500 */
  box-shadow: 0 4px 16px rgba(14, 165, 233, 0.15);
}

.edit-mode {
  width: 100%;
  margin: 10px 0;
}

.edit-tools {
  margin-top: 12px;
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
/* 新记忆界面样式 */
.memory-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.badges-left {
  display: flex;
  gap: 6px;
  align-items: center;
}

.actions-right {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.importance-indicator {
  color: #f59e0b; /* amber-500 */
  font-weight: bold;
  cursor: help;
}

.access-indicator {
  color: #f43f5e; /* rose-500 */
  font-weight: bold;
  cursor: help;
}

/* --- NIT 状态样式 --- */
.nit-status-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.nit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.nit-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 16px;
  color: #1e293b; /* slate-800 */
}
.nit-metrics {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #64748b; /* slate-500 */
}
.nit-plugins-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.mini-plugin-tag {
  font-family: monospace;
}
.more-tag {
  font-size: 12px;
  color: #94a3b8; /* slate-400 */
}

/* --- 记忆仪表盘样式 --- */
.memory-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.filters {
  display: flex;
  gap: 10px;
  align-items: center;
}
.tag-cloud-area {
  margin-bottom: 20px;
  background: rgba(255, 255, 255, 0.6);
  padding: 12px 16px;
  border-radius: 12px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.tag-cloud-label {
  font-size: 13px;
  font-weight: bold;
  color: #475569; /* slate-600 */
  white-space: nowrap;
  margin-top: 4px;
}
.tag-cloud-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.cloud-tag {
  font-size: 12px !important;
}

/* 图谱模式 */
.memory-graph-container {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  padding: 20px;
  min-height: 500px;
}
.simple-graph-view {
  position: relative;
  width: 100%;
  height: 500px;
  border: 1px solid #f1f5f9; /* slate-100 */
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}
.graph-svg {
  width: 100%;
  height: 100%;
}
.graph-hint {
  position: absolute;
  bottom: 10px;
  left: 10px;
  font-size: 12px;
  color: #94a3b8; /* slate-400 */
  background: rgba(255, 255, 255, 0.8);
  padding: 8px;
  border-radius: 4px;
  pointer-events: none;
}

/* --- 过渡动画 --- */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
