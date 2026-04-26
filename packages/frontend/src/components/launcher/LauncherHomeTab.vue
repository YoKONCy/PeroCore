<script setup lang="ts">
/**
 * LauncherHomeTab — 启动器首页标签 (精确还原 v1)
 *
 * 包含：3个系统监控卡片 (CPU/内存/运行状态) + 大启动按钮
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { PixelIcon } from '../pixel'
import { systemApi } from '../../api/modules/systemApi'
import type { SystemInfo } from '../../api/modules/systemApi'

defineOptions({ name: 'LauncherHomeTab' })

const props = defineProps<{
  /** 是否正在启动中 */
  isStarting: boolean
  /** 是否已运行 */
  isRunning: boolean
  /** 当前阶段 */
  phase: string
  /** 进入文字 */
  enteringText: string
  /** 版本号 */
  appVersion: string
}>()

const emit = defineEmits<{
  (e: 'launch'): void
}>()

// 系统信息
const sysInfo = ref<SystemInfo | null>(null)
const memoryMB = ref(0)
const heapMB = ref(0)
const uptime = ref(0)
const agentCount = ref(0)
const enabledCount = ref(0)
const gatewayNodes = ref(0)

let pollTimer: ReturnType<typeof setInterval> | null = null

async function fetchSysInfo() {
  try {
    const res = await systemApi.info()
    sysInfo.value = res.data ?? null
    if (res.data) {
      memoryMB.value = res.data.runtime.memoryUsage.rss
      heapMB.value = res.data.runtime.memoryUsage.heapUsed
      uptime.value = res.data.runtime.uptime
      agentCount.value = res.data.agents.total
      enabledCount.value = res.data.agents.enabled
      gatewayNodes.value = res.data.gateway.connectedNodes
    }
  } catch {
    // 后端未就绪时静默忽略
  }
}

onMounted(() => {
  fetchSysInfo()
  pollTimer = setInterval(fetchSysInfo, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

/** 格式化运行时长 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}
</script>

<template>
  <div class="h-full flex flex-col gap-6 overflow-y-auto pr-2">
    <!-- 状态卡片 (精确还原 v1 的 3 卡片: CPU/内存/运行状态) -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 shrink-0">
      <!-- CPU / Agent 卡片 (v1: pixel-border-mint) -->
      <div
        class="bg-white pixel-border-mint p-6 transition-all group pixel-hover-lift press-effect"
      >
        <div class="flex items-start justify-between mb-4">
          <div class="p-3 pixel-border-mint bg-emerald-500/10 text-emerald-500">
            <PixelIcon name="cpu" size="md" />
          </div>
          <span
            class="text-xs font-mono text-slate-400 group-hover:text-emerald-500 transition-colors"
          >
            Agent 状态
          </span>
        </div>
        <div class="text-2xl font-bold text-slate-700">
          {{ enabledCount }}
          <span class="text-base text-slate-400">/ {{ agentCount }}</span>
        </div>
        <div
          class="w-full bg-emerald-50 h-4 pixel-border-mint mt-4 overflow-hidden relative group/bar"
        >
          <div
            class="bg-emerald-400 h-full transition-all duration-500 shadow-[inset_-2px_-2px_0_0_#059669,inset_2px_2px_0_0_#a7f3d0] relative"
            :style="{ width: agentCount > 0 ? (enabledCount / agentCount) * 100 + '%' : '0%' }"
          >
            <div class="absolute inset-0 bg-white/20 animate-pixel-bg-float" />
          </div>
        </div>
      </div>

      <!-- 内存占用卡片 (v1: pixel-border-pink) -->
      <div
        class="bg-white pixel-border-pink p-6 transition-all group pixel-hover-lift press-effect"
      >
        <div class="flex items-start justify-between mb-4">
          <div class="p-3 pixel-border-pink bg-pink-500/10 text-pink-500">
            <PixelIcon name="database" size="md" />
          </div>
          <span
            class="text-xs font-mono text-slate-400 group-hover:text-pink-500 transition-colors"
          >
            内存占用
          </span>
        </div>
        <div class="text-2xl font-bold text-slate-700">{{ memoryMB }}MB</div>
        <div
          class="w-full bg-pink-50 h-4 pixel-border-pink mt-4 overflow-hidden relative group/bar"
        >
          <div
            class="bg-pink-400 h-full transition-all duration-500 shadow-[inset_-2px_-2px_0_0_#db2777,inset_2px_2px_0_0_#fbcfe8] relative"
            :style="{ width: Math.min(memoryMB / 10.24, 100) + '%' }"
          >
            <div class="absolute inset-0 bg-white/20 animate-pixel-bg-float" />
          </div>
        </div>
      </div>

      <!-- 运行状态卡片 (v1: pixel-border-yellow) -->
      <div
        class="bg-white pixel-border-yellow p-6 transition-all group md:col-span-2 lg:col-span-1 pixel-hover-lift press-effect"
      >
        <div class="flex items-start justify-between mb-4">
          <div class="p-3 pixel-border-yellow bg-amber-500/10 text-amber-500">
            <PixelIcon name="activity" size="md" />
          </div>
          <span
            class="text-xs font-mono text-slate-400 group-hover:text-amber-500 transition-colors"
          >
            运行状态
          </span>
        </div>
        <div class="text-2xl font-bold text-slate-700">
          {{ props.isRunning ? '已运行' : '待命' }}
        </div>
        <div class="flex gap-2 mt-4">
          <div
            v-for="i in 8"
            :key="i"
            :class="[
              'h-4 flex-1 pixel-border-yellow transition-all duration-300 relative overflow-hidden',
              i <= (props.isRunning ? 8 : 2)
                ? 'bg-yellow-400 shadow-[inset_-2px_-2px_0_0_#eab308,inset_2px_2px_0_0_#fef9c3]'
                : 'bg-yellow-50',
            ]"
          >
            <div
              v-if="i <= (props.isRunning ? 8 : 2)"
              class="absolute inset-0 bg-white/20 animate-pixel-bg-float"
            />
          </div>
        </div>
        <div class="text-[10px] text-slate-400 mt-2 font-mono">
          运行时间: {{ formatUptime(uptime) }} · 网关: {{ gatewayNodes }} 节点
        </div>
      </div>
    </div>

    <!-- 主要启动区域 (精确还原 v1) -->
    <div
      class="flex-1 min-h-[300px] flex flex-col items-center justify-center gap-8 bg-white/40 pixel-border-sky relative overflow-hidden"
    >
      <!-- 背景图案 (v1: 粉+金像素棋盘) -->
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
      />

      <!-- 内部小装饰 -->
      <div class="absolute top-4 left-4 text-pink-400/20 animate-pixel-float">
        <PixelIcon name="heart" class="w-6 h-6" />
      </div>
      <div class="absolute bottom-4 right-4 text-sky-400/20 animate-pixel-bounce">
        <PixelIcon name="star" class="w-6 h-6" />
      </div>

      <!-- 启动按钮 -->
      <div class="relative">
        <div
          v-if="props.isStarting"
          class="absolute inset-[-24px] pixel-border-sky border-t-transparent animate-spin"
        />
        <button
          id="btn-launch-pero"
          :disabled="props.isStarting"
          :class="[
            'relative w-32 h-32 md:w-40 md:h-40 flex flex-col items-center justify-center gap-2 transition-all duration-300 group overflow-hidden pixel-hover-lift',
            props.isRunning
              ? 'pixel-btn-red text-white hover:animate-pixel-shake'
              : 'pixel-btn-sky text-white',
          ]"
          @click="emit('launch')"
        >
          <PixelIcon name="power" class="md:w-12 md:h-12" />
          <span class="text-xs md:text-sm font-bold uppercase tracking-widest">
            {{ props.isRunning ? '停止服务' : '启动 Pero' }}
          </span>
        </button>
      </div>

      <!-- 状态文字 -->
      <div class="flex flex-col items-center gap-2 px-6">
        <h3 class="text-lg md:text-xl font-bold text-center text-slate-700">
          {{ props.isRunning ? 'PeroCore 正在运行' : '准备就绪' }}
        </h3>
        <p class="text-slate-400 text-xs md:text-sm max-w-md text-center">
          {{
            props.isRunning
              ? '所有系统在线。角色窗口已激活。'
              : '点击上方按钮初始化所有后端服务及角色窗口。'
          }}
        </p>
        <p
          v-if="phase === 'entering'"
          class="text-sm font-bold text-sky-500 mt-2 animate-pixel-float"
        >
          {{ enteringText }}
        </p>
      </div>
    </div>
  </div>
</template>
