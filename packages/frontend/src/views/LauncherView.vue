<script setup lang="ts">
/**
 * LauncherView — 启动器页面
 *
 * 启动流程 (还原 v1):
 *   Electron: EULA → 检查列表 → 就绪 → 新手引导 → 启动后端 → 隐藏 Launcher → 拉起 Pet3D
 *   Docker:   EULA → 检查列表 → 就绪 → 新手引导 → 跳转到 WebShell (/app)
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { PixelIcon, PButton } from '../components/pixel'
import { OnboardingOverlay } from '../components/overlays'
import { useLauncher } from '../composables/launcher/useLauncher'
import { launcherSteps } from '../composables/launcher/onboardingScripts'

defineOptions({ name: 'LauncherView' })

/** 应用版本号 (构建时由 vite.config.ts 注入) */
const appVersion = __APP_VERSION__

const router = useRouter()
const {
  phase,
  progress,
  checks,
  hasError,
  startLaunch,
  enterApp,
  retry,
  enteringText,
  showEula,
  acceptEula,
  declineEula,
  showOnboarding,
  finishOnboarding,
} = useLauncher()

onMounted(() => {
  startLaunch()
})

/**
 * 点击"启动"按钮 — 触发正确的启动流程
 *
 * Electron: enterApp() 会通过 IPC 启动后端 → 隐藏 Launcher → 拉起 Pet3D
 * Docker:   enterApp() 会直接返回 'browser'，由此处 router.push('/app') 进入 WebShell
 */
async function handleEnter() {
  const target = await enterApp()
  if (target === 'browser') {
    router.push('/app')
  }
}
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-sky-50 text-slate-800 font-sans select-text relative pixel-grid-overlay">
    <!-- ═══ 像素风浮动装饰 ═══ -->
    <div class="fixed inset-0 pointer-events-none z-10 overflow-hidden select-none">
      <!-- 浮动贴纸 -->
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
      <!-- 超大猫娘水印 -->
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sky-200/5 opacity-5 rotate-12 pointer-events-none">
        <PixelIcon name="cat" class="w-[600px] h-[600px]" />
      </div>
      <!-- 动态星星 -->
      <div
        v-for="i in 12"
        :key="'star-' + i"
        class="absolute animate-pixel-star text-amber-200/30 pointer-events-none"
        :style="{
          top: (i * 8.3) % 100 + '%',
          left: (i * 7.7 + 15) % 100 + '%',
          animationDelay: (i * 0.25) + 's'
        }"
      >
        <PixelIcon name="star" :style="{ width: 8 + (i % 4) * 3 + 'px', height: 8 + (i % 4) * 3 + 'px' }" />
      </div>
    </div>

    <!-- ═══ 主启动卡片 ═══ -->
    <div
      v-show="!showOnboarding"
      class="flex h-full w-full items-center justify-center relative z-20"
    >
      <div
        :class="[
          'w-[480px] bg-white pixel-border-sky p-10 flex flex-col items-center gap-8 transition-all duration-500 relative overflow-hidden',
          phase === 'ready' ? 'shadow-[8px_8px_0_0_#0ea5e940]' : 'shadow-[6px_6px_0_0_rgba(0,0,0,0.08)]'
        ]"
      >
        <!-- 品牌区 -->
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-xl overflow-hidden animate-pixel-float">
            <img
              src="/Logo.png"
              alt="PeroCore"
              class="w-full h-full object-cover select-none pointer-events-none"
            />
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
              PEROPERO CHAT
            </span>
            <h1 class="text-2xl font-extrabold bg-gradient-to-br from-slate-800 to-sky-500 bg-clip-text text-transparent">
              萌动链接
            </h1>
          </div>
        </div>

        <!-- ── 连接中 ── -->
        <div v-if="phase === 'connecting'" class="flex flex-col items-center gap-3">
          <PixelIcon name="refresh" size="lg" animation="spin" />
          <p class="text-sm font-bold text-slate-400">正在连接后端服务...</p>
          <div class="flex gap-1.5">
            <span class="w-1.5 h-1.5 bg-sky-hover animate-pulse" style="animation-delay: 0s" />
            <span class="w-1.5 h-1.5 bg-sky-hover animate-pulse" style="animation-delay: 0.2s" />
            <span class="w-1.5 h-1.5 bg-sky-hover animate-pulse" style="animation-delay: 0.4s" />
          </div>
        </div>

        <!-- ── 检查列表 ── -->
        <div v-if="phase === 'checking' || phase === 'ready'" class="w-full flex flex-col gap-3">
          <!-- 进度条 -->
          <div class="w-full h-1 bg-sky-50 pixel-border-sm overflow-hidden">
            <div
              class="h-full bg-sky-face transition-all duration-400"
              :style="{ width: progress + '%' }"
            />
          </div>
          <!-- 检查项 -->
          <div class="flex flex-col gap-1.5">
            <div
              v-for="item in checks"
              :key="item.id"
              class="flex items-center gap-2.5 px-2 py-1.5"
            >
              <div
                :class="[
                  'w-5 h-5 flex items-center justify-center shrink-0',
                  item.status === 'ok' ? 'text-emerald-500' :
                  item.status === 'running' ? 'text-sky-500' :
                  item.status === 'warn' ? 'text-amber-500' :
                  item.status === 'error' ? 'text-red-500' :
                  'text-slate-300'
                ]"
              >
                <PixelIcon v-if="item.status === 'running'" name="refresh" size="xs" animation="spin" />
                <PixelIcon v-else-if="item.status === 'ok'" name="check" size="xs" />
                <PixelIcon v-else-if="item.status === 'warn'" name="alert" size="xs" />
                <PixelIcon v-else-if="item.status === 'error'" name="close" size="xs" />
                <span v-else class="w-1.5 h-1.5 bg-slate-300 opacity-40" />
              </div>
              <span class="text-[13px] font-bold text-slate-500">{{ item.label }}</span>
              <span v-if="item.message" class="ml-auto text-[10px] font-bold text-emerald-500">
                {{ item.message }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── 就绪 → 启动按钮 ── -->
        <div v-if="phase === 'ready'" class="flex flex-col items-center gap-4 w-full">
          <p class="text-sm font-bold text-emerald-500 flex items-center gap-1.5">
            <PixelIcon name="sparkle" class="w-3 h-3 text-amber-400" />
            所有系统已就绪
            <PixelIcon name="sparkle" class="w-3 h-3 text-amber-400" />
          </p>
          <button
            class="w-full py-3 pixel-btn-sky text-white font-extrabold text-[15px] tracking-wider uppercase flex items-center justify-center gap-2 pixel-hover-lift press-effect"
            @click="handleEnter"
          >
            <PixelIcon name="power" size="sm" />
            启动 Pero
            <PixelIcon name="chevron-right" size="xs" />
          </button>
        </div>

        <!-- ── 错误 ── -->
        <div v-if="hasError" class="flex flex-col items-center gap-2">
          <p class="text-[13px] font-bold text-red-500">部分服务连接失败</p>
          <button
            class="px-6 py-2 pixel-btn-red text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 pixel-hover-lift press-effect"
            @click="retry"
          >
            <PixelIcon name="refresh" size="xs" />
            重试
          </button>
        </div>

        <!-- ── 进入中 ── -->
        <div v-if="phase === 'entering'" class="flex flex-col items-center gap-3">
          <PixelIcon name="sparkle" size="lg" animation="bounce" class="text-sky-500" />
          <p class="text-sm font-bold text-slate-400">{{ enteringText }}</p>
        </div>

        <!-- 底部版本 -->
        <div class="text-[10px] font-bold text-slate-300 tracking-[0.1em] uppercase opacity-50">
          v{{ appVersion }} · PeroCore-TS
        </div>
      </div>
    </div>

    <!-- ═══ EULA 弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="eula-fade">
        <div v-if="showEula" class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div class="w-[540px] bg-white pixel-border-pink p-10 flex flex-col gap-6 relative overflow-hidden animate-eula-appear">
            <!-- 背景装饰 -->
            <div class="absolute -top-4 -right-4 text-pink-100 opacity-30 rotate-12 pointer-events-none">
              <PixelIcon name="heart" size="3xl" />
            </div>

            <!-- 标题 -->
            <div class="flex items-center gap-4 relative z-10">
              <div class="w-14 h-14 flex items-center justify-center bg-pink-500 pixel-border-pink text-white animate-pixel-float">
                <PixelIcon name="shield" size="xl" />
              </div>
              <div>
                <h2 class="text-2xl font-extrabold text-slate-800 flex items-center gap-2.5">
                  用户许可协议
                  <span class="text-[9px] font-extrabold bg-pink-50 text-pink-500 px-2 py-0.5 pixel-border-pink">
                    REQUIRED
                  </span>
                </h2>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">
                  End User License Agreement
                </p>
              </div>
            </div>

            <!-- 协议正文 -->
            <div class="max-h-80 overflow-y-auto p-5 bg-pink-50/30 pixel-border-pink relative z-10">
              <div class="flex flex-col gap-3">
                <p class="text-[13px] font-bold text-pink-600 flex items-center gap-1.5 leading-relaxed">
                  <PixelIcon name="heart" size="xs" />
                  欢迎使用 萌动链接：PeroperoChat！ (以下简称"本软件")。
                </p>
                <p class="text-[13px] text-slate-500 leading-relaxed">
                  在使用本软件之前，请您务必仔细阅读并理解《最终用户许可协议》（以下简称"本协议"）。本软件是一个开源项目，我们鼓励社区共建与共享。
                </p>

                <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                  1. 开源许可与分发
                </h4>
                <p class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed">
                  本软件基于开源协议发布，您可以自由地查看、修改和分发源代码，但须遵守对应的开源许可条款。再分发时请保留原始版权声明与许可信息。
                </p>

                <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                  2. AI 生成内容免责声明
                </h4>
                <p class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed">
                  本软件作为工具平台，集成并调用第三方大语言模型（LLM）服务。所有由 AI 生成的文字、图像及其他内容均由模型自动产出，不代表开发者的观点或立场。开发者不对 AI 生成内容的准确性、合法性或适用性承担任何责任。
                </p>

                <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                  3. 隐私与数据安全
                </h4>
                <p class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed">
                  本软件高度重视您的隐私。您的对话记录、角色配置和个人数据默认仅存储在本地设备上，不会被上传至开发者的服务器。
                </p>

                <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                  4. 使用规范
                </h4>
                <p class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed">
                  您不得利用本软件从事任何违反所在地区法律法规的活动，包括但不限于生成和传播违法有害信息。请遵守社区公约，共同维护友善、健康的使用环境。
                </p>

                <h4 class="text-[13px] font-extrabold text-slate-800 mt-3 flex items-center gap-2">
                  <span class="w-1.5 h-1.5 bg-pink-400 shrink-0" />
                  5. 免责与风险提示
                </h4>
                <p class="text-[13px] text-slate-400 pl-3.5 border-l-2 border-pink-100 leading-relaxed">
                  本软件按"原样"提供，不附带任何形式的明示或暗示担保。开发者不对因使用或无法使用本软件而导致的任何直接或间接损失承担责任。
                </p>

                <p class="text-[11px] text-slate-400 pt-4 border-t-2 border-pink-100 flex items-center gap-1.5">
                  <PixelIcon name="sparkle" size="xs" />
                  点击"同意并继续"即表示您已阅读并同意上述所有条款喵~
                </p>
              </div>
            </div>

            <!-- 操作按钮 -->
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

    <!-- ═══ 新手引导 ═══ -->
    <OnboardingOverlay
      :visible="showOnboarding"
      :steps="launcherSteps"
      @finish="finishOnboarding"
      @update:visible="(v: boolean) => { if (!v) finishOnboarding() }"
    />
  </div>
</template>

<style scoped>
/* ── EULA 过渡动画 ── */
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
