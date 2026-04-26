<script setup lang="ts">
/**
 * LauncherView — 启动器控制面板 (忠实还原 v1 的完整布局)
 *
 * 布局: 侧边栏导航 + 多标签内容区
 * 标签: Home (系统监控+启动) | Agents (角色管理)
 */
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { PixelIcon } from '../components/pixel'
import { OnboardingOverlay } from '../components/overlays'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import { LauncherHomeTab, LauncherAgentsTab } from '../components/launcher'
import { useLauncher } from '../composables/launcher/useLauncher'
import { launcherSteps } from '../composables/launcher/onboardingScripts'
import { useAgentStore } from '../stores'
import { isElectron } from '../utils/ipcAdapter'
import { getApiBaseUrl } from '../api/transport'

defineOptions({ name: 'LauncherView' })

const appVersion = __APP_VERSION__
const router = useRouter()
const agentStore = useAgentStore()

const {
  phase,
  startLaunch,
  enterApp,
  enteringText,
  showEula,
  acceptEula,
  declineEula,
  triggerEula,
  showOnboarding,
  finishOnboarding,
  triggerOnboarding,
} = useLauncher()

// ── 侧边栏状态 ──
const activeTab = ref('home')
const isSidebarCollapsed = ref(false)
const isRunning = ref(false)
const isStarting = ref(false)

/** 缩放因子 (Electron 窗口适配) */
const scale = ref(1)

const navItems = [
  { id: 'home', name: '控制面板', icon: 'home' },
  { id: 'agents', name: '角色配置', icon: 'users' },
]

onMounted(() => {
  startLaunch()
  // 立即加载 Agent 列表，确保看板娘头像等 UI 不需要等到点角色配置 tab
  agentStore.fetchAgents()
})

/** 启动/停止 */
async function toggleLaunch() {
  if (isRunning.value) {
    isRunning.value = false
    return
  }
  isStarting.value = true
  const target = await enterApp()
  if (target === 'browser') {
    router.push('/app')
  }
  isStarting.value = false
  isRunning.value = true
}

/** 导航条目激活时的颜色 class (还原 v1 精确样式) */
function getNavActiveClass(id: string): string {
  if (id === 'home') return 'bg-sky-500 text-white pixel-border-sky shadow-[4px_4px_0_0_#0ea5e940]'
  if (id === 'agents')
    return 'bg-emerald-500 text-white pixel-border-emerald shadow-[4px_4px_0_0_#10b98140]'
  if (id === 'plugins')
    return 'bg-amber-500 text-white pixel-border-amber shadow-[4px_4px_0_0_#f59e0b40]'
  return 'bg-indigo-500 text-white pixel-border-indigo shadow-[4px_4px_0_0_#6366f140]'
}
</script>

<template>
  <!-- ═══ 背景纹理 (v1: 独立 fixed 层) ═══ -->
  <div
    class="fixed inset-0 opacity-[0.03] pointer-events-none z-0 animate-pixel-bg-float"
    style="background-image: url('https://www.transparenttextures.com/patterns/cubes.png')"
  />

  <!-- ═══ 像素装饰贴纸 (v1: 独立 fixed 层, 11个图标 + 12星星 + 15气泡) ═══ -->
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
    <!-- 超大猫娘水印 -->
    <div
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sky-200/5 opacity-[0.05] rotate-12 pointer-events-none"
    >
      <PixelIcon name="cat" class="w-[600px] h-[600px]" />
    </div>

    <!-- 动态星星 -->
    <div
      v-for="i in 12"
      :key="'star-' + i"
      class="absolute animate-pixel-star text-amber-200/30 pointer-events-none"
      :style="{
        top: ((i * 8.3) % 100) + '%',
        left: ((i * 7.7 + 15) % 100) + '%',
        animationDelay: i * 0.25 + 's',
      }"
    >
      <PixelIcon
        name="star"
        :style="{ width: 8 + (i % 4) * 3 + 'px', height: 8 + (i % 4) * 3 + 'px' }"
      />
    </div>
    <!-- 动态气泡 -->
    <div
      v-for="i in 15"
      :key="'bubble-' + i"
      class="absolute animate-pixel-bubble text-sky-200/20 pointer-events-none"
      :style="{
        bottom: '-20px',
        left: ((i * 6.7) % 100) + '%',
        animationDelay: i * 0.33 + 's',
      }"
    >
      <PixelIcon
        name="circle"
        :style="{ width: 4 + (i % 3) * 3 + 'px', height: 4 + (i % 3) * 3 + 'px' }"
      />
    </div>
  </div>

  <!-- ═══ 主容器 (v1 精确还原) ═══ -->
  <div
    class="h-screen w-screen overflow-hidden text-slate-800 font-sans select-text relative pixel-grid-overlay"
    style="background-color: var(--launcher-bg, #f0f9ff)"
  >
    <!-- 自定义标题栏 (Electron frameless 窗口) -->
    <CustomTitleBar v-if="isElectron()" :transparent="true" />

    <!-- 新手引导 -->
    <OnboardingOverlay
      :visible="showOnboarding"
      :steps="launcherSteps"
      @finish="finishOnboarding"
      @update:visible="
        (v: boolean) => {
          if (!v) finishOnboarding()
        }
      "
    />

    <!-- ═══ 主体布局: 侧边栏 + 内容区 ═══ -->
    <div
      class="flex h-full w-full pixel-grid-overlay"
      :style="{
        zoom: scale,
        paddingTop: isElectron() ? `${32 / scale}px` : '0px',
      }"
    >
      <!-- ── 侧边导航栏 ── -->
      <aside
        id="nav-sidebar"
        :class="[
          'bg-white pixel-border-sky flex flex-col transition-all duration-300 relative z-20 select-none',
          isSidebarCollapsed ? 'w-20' : 'w-64',
        ]"
      >
        <div class="p-6 mb-6 flex items-center justify-between">
          <div v-if="!isSidebarCollapsed" class="flex items-center gap-3">
            <div
              class="w-8 h-8 pixel-border-sky bg-sky-500 flex items-center justify-center text-white pixel-hover-lift overflow-hidden"
            >
              <PixelIcon name="cat" size="sm" />
            </div>
            <span class="font-bold tracking-tight text-lg text-sky-600">启动器</span>
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
                ? getNavActiveClass(item.id)
                : 'text-slate-500 hover:bg-sky-50 hover:text-sky-600',
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
            <span v-if="!isSidebarCollapsed" class="font-bold text-sm z-10 tracking-wide">
              {{ item.name }}
            </span>
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
            class="w-12 h-12 pixel-border-sky flex items-center justify-center mb-2 group cursor-pointer transition-colors duration-300 relative overflow-hidden"
            :class="[
              isRunning
                ? 'bg-emerald-100 text-emerald-500 animate-pixel-bounce'
                : 'bg-sky-100 text-sky-500 animate-pixel-float',
            ]"
          >
            <!-- 有头像时显示 active agent 头像 -->
            <img
              v-if="agentStore.currentAgent?.avatarUrl"
              :src="`${getApiBaseUrl()}${agentStore.currentAgent.avatarUrl}`"
              :alt="agentStore.currentAgent.name"
              class="w-full h-full object-cover"
            />
            <!-- 无头像回退猫图标 -->
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
            {{ agentStore.currentAgent?.name ?? 'Mascot' }}
            <PixelIcon name="sparkle" class="w-2 h-2 text-amber-400" />
          </div>
        </div>
      </aside>

      <!-- ── 主内容区 ── -->
      <div class="flex-1 flex flex-col relative overflow-hidden bg-transparent">
        <!-- 顶部标题栏 -->
        <header
          class="h-20 flex items-center justify-between px-10 border-b-2 border-sky-600 bg-white z-10 select-none"
        >
          <div>
            <h1 class="text-2xl font-bold text-slate-800 tracking-tight">PeroperoChat Launcher</h1>
            <p class="text-xs text-slate-400 mt-1 font-mono tracking-wider flex items-center gap-2">
              <PixelIcon name="mood-happy" class="w-2.5 h-2.5 text-sky-500 animate-pixel-float" />
              版本 {{ appVersion }} · 系统就绪
            </p>
          </div>
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-4 bg-white px-5 py-2.5 pixel-border-sky">
              <div class="flex items-center gap-2 group cursor-help">
                <div
                  :class="[
                    'w-3 h-3 pixel-border-mint transition-colors duration-500 animate-pixel-float',
                    phase === 'ready' || isRunning
                      ? 'bg-emerald-500'
                      : phase === 'checking'
                        ? 'bg-amber-400'
                        : 'bg-slate-300',
                  ]"
                />
                <span
                  class="text-xs font-medium text-slate-500 uppercase tracking-tight group-hover:text-emerald-500 transition-colors"
                >
                  核心服务
                </span>
              </div>
            </div>
            <!-- 重新触发 EULA / 引导 -->
            <button
              class="w-8 h-8 pixel-border-pink flex items-center justify-center bg-pink-50 text-pink-400 hover:bg-pink-100 hover:text-pink-600 transition-all duration-200 hover:scale-110 active:scale-95"
              title="重新查看用户协议"
              @click="triggerEula"
            >
              <PixelIcon name="shield" size="sm" />
            </button>
            <button
              class="w-8 h-8 pixel-border-sky flex items-center justify-center bg-sky-50 text-sky-400 hover:bg-sky-100 hover:text-sky-600 transition-all duration-200 hover:scale-110 active:scale-95"
              title="重新开始新手引导"
              @click="triggerOnboarding"
            >
              <PixelIcon name="book" size="sm" />
            </button>
          </div>
        </header>

        <!-- 内容区域 -->
        <main class="flex-1 overflow-hidden p-8">
          <LauncherHomeTab
            v-if="activeTab === 'home'"
            :is-starting="isStarting"
            :is-running="isRunning"
            :phase="phase"
            :entering-text="enteringText"
            :app-version="appVersion"
            @launch="toggleLaunch"
          />
          <LauncherAgentsTab v-if="activeTab === 'agents'" />
        </main>
      </div>
    </div>
  </div>

  <!-- ═══ EULA 弹窗 ═══ -->
  <Teleport to="body">
    <Transition name="eula-fade">
      <div
        v-if="showEula"
        class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
      >
        <div
          class="w-[540px] bg-white pixel-border-pink p-10 flex flex-col gap-6 relative overflow-hidden animate-eula-appear"
        >
          <div
            class="absolute -top-4 -right-4 text-pink-100 opacity-30 rotate-12 pointer-events-none"
          >
            <PixelIcon name="heart" size="3xl" />
          </div>

          <div class="flex items-center gap-4 relative z-10">
            <div
              class="w-14 h-14 flex items-center justify-center bg-pink-500 pixel-border-pink text-white animate-pixel-float"
            >
              <PixelIcon name="shield" size="xl" />
            </div>
            <div>
              <h2 class="text-2xl font-extrabold text-slate-800 flex items-center gap-2.5">
                用户许可协议
                <span
                  class="text-[9px] font-extrabold bg-pink-50 text-pink-500 px-2 py-0.5 pixel-border-pink"
                >
                  REQUIRED
                </span>
              </h2>
              <p class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">
                End User License Agreement
              </p>
            </div>
          </div>

          <div class="max-h-80 overflow-y-auto p-5 bg-pink-50/30 pixel-border-pink relative z-10">
            <div class="flex flex-col gap-3">
              <p
                class="text-[13px] font-bold text-pink-600 flex items-center gap-1.5 leading-relaxed"
              >
                <PixelIcon name="heart" size="xs" />
                欢迎使用 萌动链接：PeroperoChat！ (以下简称"本软件")。
              </p>
              <p class="text-[13px] text-slate-500 leading-relaxed">
                在使用本软件之前，请您务必仔细阅读并理解《最终用户许可协议》。
              </p>
              <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                1. 开源许可与分发
              </h4>
              <p
                class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed"
              >
                本软件基于开源协议发布，您可以自由查看、修改和分发源代码，但须遵守对应的开源许可条款。
              </p>
              <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                2. AI 生成内容免责声明
              </h4>
              <p
                class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed"
              >
                所有由 AI 生成的内容均由模型自动产出，不代表开发者观点。
              </p>
              <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                3. 隐私与数据安全
              </h4>
              <p
                class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed"
              >
                您的数据默认仅存储在本地设备上，不会被上传至开发者服务器。
              </p>
              <p
                class="text-[11px] text-slate-400 pt-4 border-t-2 border-pink-100 flex items-center gap-1.5"
              >
                <PixelIcon name="sparkle" size="xs" />
                点击"同意并继续"即表示您已阅读并同意上述所有条款喵~
              </p>
            </div>
          </div>

          <div class="flex gap-3 relative z-10">
            <button
              class="flex-1 py-3 px-6 bg-slate-50 border-3 border-slate-200 text-slate-400 font-extrabold text-xs tracking-[0.1em] cursor-pointer transition-all hover:bg-slate-100 hover:text-slate-500 press-effect"
              @click="declineEula"
            >
              拒绝并退出
            </button>
            <button
              class="flex-[2] py-3 px-6 pixel-btn-pink text-white font-extrabold text-sm tracking-[0.15em] cursor-pointer flex items-center justify-center gap-2 pixel-hover-lift press-effect"
              @click="acceptEula"
            >
              <PixelIcon name="check" size="xs" />
              同意并继续
              <PixelIcon name="chevron-right" size="xs" />
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.eula-fade-enter-active,
.eula-fade-leave-active {
  transition: opacity 0.3s;
}
.eula-fade-enter-from,
.eula-fade-leave-to {
  opacity: 0;
}
@keyframes eula-appear {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
.animate-eula-appear {
  animation: eula-appear 0.3s ease;
}
</style>
