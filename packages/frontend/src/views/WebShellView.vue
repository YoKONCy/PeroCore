<script setup lang="ts">
/**
 * WebShellView — Docker/浏览器模式的外壳布局
 *
 * 在 Docker 模式下，所有页面（对话、工作、据点、仪表盘设置）
 * 通过统一的侧边栏导航在单个浏览器标签页中切换。
 *
 * Electron 版不使用此组件（有自己的窗口管理体系）。
 *
 * @see _docs_/07_DUAL_DEPLOYMENT.md
 */
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { PixelIcon, PTooltip } from '../components/pixel'

defineOptions({ name: 'WebShellView' })

/** 应用版本号 (构建时由 vite.config.ts 注入) */
const appVersion = __APP_VERSION__

const router = useRouter()
const route = useRoute()

// ── 导航菜单 ──

interface ShellNavItem {
  id: string
  path: string
  label: string
  icon: string
}

interface ShellNavGroup {
  title: string | null
  items: ShellNavItem[]
}

const navGroups: ShellNavGroup[] = [
  {
    title: null,
    items: [
      { id: 'chat', path: '/app', label: '对话', icon: 'chat' },
      { id: 'work', path: '/app/work', label: '工作模式', icon: 'layout' },
      { id: 'stronghold', path: '/app/stronghold', label: '据点', icon: 'users' },
    ],
  },
  {
    title: 'MANAGEMENT',
    items: [{ id: 'dashboard', path: '/app/dashboard', label: '仪表盘', icon: 'settings' }],
  },
]

/** 当前活跃的导航项 */
const activeNavId = computed(() => {
  const path = route.path
  const matched = navGroups
    .flatMap((g) => g.items)
    .find((item) => path === item.path || (item.path !== '/app' && path.startsWith(item.path)))
  return matched?.id ?? 'chat'
})

/** 导航到目标页面 */
function navigateTo(item: ShellNavItem) {
  router.push(item.path)
}

// ── 状态 ──

const isRefreshing = ref(false)

async function handleRefresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  setTimeout(() => {
    isRefreshing.value = false
  }, 1000)
}
</script>

<template>
  <div class="flex w-full h-full overflow-hidden bg-white">
    <!-- 侧边栏 -->
    <aside
      class="w-60 flex flex-col h-full border-r-2 border-slate-200 bg-slate-50/40 flex-shrink-0"
    >
      <!-- 品牌 -->
      <div class="px-5 pt-6 pb-4 flex items-center gap-3">
        <div
          class="w-11 h-11 flex items-center justify-center bg-gradient-to-br from-sky-300 to-sky-600 border-2 border-sky-600 text-white font-black text-lg transition-transform hover:scale-105 hover:rotate-3"
        >
          <span class="select-none">P</span>
        </div>
        <div class="flex flex-col">
          <span class="text-[9px] font-bold uppercase tracking-wider text-slate-400">
            PeroperoChat
          </span>
          <span
            class="text-base font-black bg-gradient-to-br from-slate-800 to-sky-500 bg-clip-text text-transparent"
          >
            萌动链接
          </span>
        </div>
      </div>

      <!-- 导航菜单 -->
      <nav class="flex-1 overflow-y-auto px-3 shell-scrollbar">
        <div v-for="(group, gIdx) in navGroups" :key="gIdx" class="mb-4">
          <div
            v-if="group.title"
            class="flex items-center gap-2 px-2 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-[0.15em]"
          >
            <span class="w-1 h-1 bg-slate-400 flex-shrink-0" />
            <span>{{ group.title }}</span>
            <div class="flex-1 h-px bg-slate-200" />
          </div>

          <button
            v-for="item in group.items"
            :key="item.id"
            :class="[
              'w-full flex items-center gap-3 px-3 py-2.5 text-[13px] font-bold bg-none border-2 border-transparent cursor-pointer relative transition-all mb-1',
              activeNavId === item.id
                ? 'bg-white text-sky-600 border-sky-100 shadow-sm shadow-sky-100/30 translate-x-0.5'
                : 'text-slate-500 hover:bg-white hover:text-sky-500 hover:translate-x-0.5',
            ]"
            @click="navigateTo(item)"
          >
            <div
              v-if="activeNavId === item.id"
              class="absolute left-0 top-2 bottom-2 w-[3px] bg-sky-500"
            />
            <PixelIcon :name="item.icon" size="sm" class="transition-colors" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </nav>

      <!-- 底部状态 -->
      <div class="p-3 border-t-2 border-slate-200">
        <div class="flex items-center gap-2 p-2 border border-slate-200 bg-white">
          <span class="w-2.5 h-2.5 bg-emerald-500 flex-shrink-0 shell-pulse" />
          <div class="flex-1 flex flex-col">
            <span class="text-[10px] font-bold uppercase text-slate-400">Docker</span>
            <span class="text-[10px] font-bold text-emerald-600">SYSTEM ONLINE</span>
          </div>
          <PTooltip content="刷新" placement="top">
            <button
              class="p-1.5 bg-white border-2 border-slate-200 text-slate-400 cursor-pointer transition-all hover:border-sky-300 hover:text-sky-500"
              @click="handleRefresh"
            >
              <PixelIcon name="refresh" size="xs" :animation="isRefreshing ? 'spin' : ''" />
            </button>
          </PTooltip>
        </div>
        <div
          class="mt-2 text-center text-[9px] font-bold text-slate-400 tracking-wider uppercase opacity-60"
        >
          v{{ appVersion }} · PeroCore-TS
        </div>
      </div>
    </aside>

    <!-- 主内容区：嵌套路由出口 -->
    <main class="flex-1 overflow-y-auto overflow-x-hidden shell-main-scrollbar">
      <router-view v-slot="{ Component }">
        <keep-alive :include="['DashboardView']" :max="3">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.shell-scrollbar::-webkit-scrollbar,
.shell-main-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.shell-scrollbar::-webkit-scrollbar-thumb,
.shell-main-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}

/* 在线脉冲 */
@keyframes shell-pulse-anim {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.shell-pulse {
  animation: shell-pulse-anim 2s infinite;
}
</style>
