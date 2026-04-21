<template>
  <!-- 10. NapCat 终端 -->
  <div class="h-full flex flex-col p-6 overflow-hidden relative">
    <!-- 背景装饰 ✨ -->
    <div
      class="absolute -right-20 -top-20 w-80 h-80 bg-emerald-400/5 blur-[100px] rounded-full pointer-events-none"
    ></div>
    <div
      class="absolute -left-20 -bottom-20 w-80 h-80 bg-sky-400/5 blur-[100px] rounded-full pointer-events-none"
    ></div>

    <PCard
      v-if="electronMode"
      glass
      soft3d
      full-height
      class="flex-1 flex flex-col overflow-hidden !p-0 border-emerald-100/50"
    >
      <NapCatTerminal class="h-full w-full" />
    </PCard>

    <PCard v-else glass soft3d class="flex-1 border-emerald-100/50">
      <template #header>
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex items-start gap-4">
            <div class="p-3 bg-emerald-50 pixel-border-sm text-emerald-500">
              <PixelIcon name="chat" size="md" />
            </div>
            <div>
              <div class="font-bold text-slate-800 flex items-center gap-2 text-lg">
                NapCat 远程管理
                <span class="text-xs font-normal text-slate-400 font-mono">Remote Relay</span>
              </div>
              <div class="text-sm text-slate-500 mt-1 leading-relaxed">
                浏览器模式下不提供本地终端，而是通过服务器状态面板管理独立部署的 NapCat 接入。
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

      <div class="space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div class="bg-emerald-50/70 pixel-border-sm p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">WebSocket</div>
            <div class="mt-2 text-sm font-bold" :class="napCatStatus.ws_connected ? 'text-emerald-600' : 'text-rose-500'">
              {{ napCatStatus.ws_connected ? '已连接' : '未连接' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">{{ napCatStatus.connection_count }} 条连接</div>
          </div>

          <div class="bg-emerald-50/70 pixel-border-sm p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">API</div>
            <div class="mt-2 text-sm font-bold" :class="napCatStatus.api_responsive ? 'text-emerald-600' : 'text-amber-500'">
              {{ napCatStatus.api_responsive ? '心跳正常' : '未响应' }}
            </div>
            <div class="mt-1 text-xs text-slate-500">
              {{ napCatStatus.api_responsive ? `${napCatStatus.latency_ms}ms` : '等待 OneBot 响应' }}
            </div>
          </div>

          <div class="bg-emerald-50/70 pixel-border-sm p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bot</div>
            <div class="mt-2 text-sm font-bold text-emerald-600">{{ napCatStatus.bot_info?.nickname || '未识别' }}</div>
            <div class="mt-1 text-xs text-slate-500 font-mono">{{ napCatStatus.bot_info?.user_id || '等待登录信息' }}</div>
          </div>

          <div class="bg-emerald-50/70 pixel-border-sm p-4">
            <div class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secret</div>
            <div class="mt-2 text-sm font-bold" :class="napCatStatus.ws_auth_required ? 'text-amber-500' : 'text-slate-500'">
              {{ napCatStatus.ws_auth_required ? '已启用' : '未启用' }}
            </div>
            <div class="mt-1 text-xs text-slate-500 font-mono">
              {{ napCatStatus.ws_auth_required ? napCatStatus.ws_auth_query || napCatStatus.ws_auth_header : '建议生产环境启用' }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="bg-white/70 border border-emerald-100 rounded-[1.5rem] p-5 space-y-3">
            <div class="text-xs font-bold text-slate-500 uppercase tracking-widest">接入方式</div>
            <div class="text-sm text-slate-600 leading-relaxed">
              NapCat 需要以反向 WebSocket 方式连接下面的地址：
            </div>
            <div class="bg-slate-950 text-emerald-300 px-4 py-3 rounded-xl font-mono text-xs break-all">
              {{ socialWsUrl }}
            </div>
            <div class="text-sm text-slate-600 leading-relaxed">
              最近连接：<span class="font-mono text-emerald-600">{{ formatStatusTime(napCatStatus.last_connected_at) }}</span>
            </div>
            <div class="text-sm text-slate-600 leading-relaxed">
              最近事件：<span class="font-mono text-emerald-600">{{ formatStatusTime(napCatStatus.last_event_at) }}</span>
            </div>
            <div class="text-sm text-slate-600 leading-relaxed">
              当前连接 ID：
              <span class="font-mono text-emerald-600">{{ napCatStatus.connected_ids.length ? napCatStatus.connected_ids.join(', ') : '默认连接' }}</span>
            </div>
          </div>

          <div class="rounded-[1.5rem] p-5 border" :class="napCatStatus.last_error ? 'bg-rose-50 border-rose-100' : 'bg-sky-50 border-sky-100'">
            <div class="text-xs font-bold uppercase tracking-widest" :class="napCatStatus.last_error ? 'text-rose-500' : 'text-sky-500'">
              运行说明
            </div>
            <div class="mt-3 text-sm leading-relaxed" :class="napCatStatus.last_error ? 'text-rose-600' : 'text-slate-600'">
              {{ napCatStatus.last_error || '浏览器模式下不再尝试调用 Electron NapCat 终端；如需远程接入，请让 NapCat 直接连到服务器的 /api/social/ws。' }}
            </div>
          </div>
        </div>
      </div>
    </PCard>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { isElectron } from '@/utils/ipcAdapter'
import { AGENT_CONFIG_KEY } from '@/composables/dashboard/injectionKeys'
import PCard from '@/components/ui/PCard.vue'
import PButton from '@/components/ui/PButton.vue'
import PSwitch from '@/components/ui/PSwitch.vue'
import PixelIcon from '@/components/ui/PixelIcon.vue'
import NapCatTerminal from '@/components/terminal/NapCatTerminal.vue'

const electronMode = computed(() => isElectron())
const { napCatStatus, isSocialEnabled, isTogglingSocial, toggleSocial, fetchSocialStatus } =
  inject(AGENT_CONFIG_KEY)!

const socialWsUrl = computed(() => {
  if (typeof window === 'undefined') return '/api/social/ws'
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.host}/api/social/ws`
})

const formatStatusTime = (value: string | null): string => {
  if (!value) return '暂无'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}
</script>
