<script setup lang="ts">
/**
 * McpPanel — MCP 服务管理面板
 *
 * 接收 useMcpConfig 提供的数据，渲染 MCP 服务列表、操作按钮。
 * 由 McpTab 组件编排使用。
 */
import { PixelIcon, PButton, PCard, PEmpty } from '../../pixel'
import type { McpServerView } from '../../../composables/dashboard/useMcpConfig'

const props = defineProps<{
  servers: McpServerView[]
  isLoading: boolean
  expandedId: number | null
  statusMeta: Record<string, { label: string; dotClass: string; badgeClass: string }>
}>()

const emit = defineEmits<{
  (e: 'toggle-expand', id: number): void
  (e: 'toggle-enabled', id: number): void
  (e: 'reconnect', id: number): void
  (e: 'remove', id: number): void
}>()

/** 安全获取状态 meta */
const STATUS_FALLBACK = {
  label: '未知',
  dotClass: 'bg-slate-400',
  badgeClass: 'text-slate-400 border-slate-300 bg-slate-50',
}
function getStatusMeta(status: string) {
  return props.statusMeta[status] ?? STATUS_FALLBACK
}
</script>

<template>
  <!-- 加载状态 -->
  <div v-if="isLoading && servers.length === 0" class="flex-1 flex items-center justify-center">
    <div class="flex flex-col items-center gap-3 text-slate-400">
      <PixelIcon name="loader" size="lg" />
      <span class="text-sm font-bold">正在加载 MCP 配置...</span>
    </div>
  </div>

  <!-- 空状态 -->
  <div v-else-if="servers.length === 0" class="flex-1 flex items-center justify-center">
    <PEmpty description="还没有配置 MCP 服务" />
  </div>

  <!-- 服务列表 -->
  <div v-else class="flex-1 overflow-y-auto flex flex-col gap-2 mcp-scrollbar">
    <PCard
      v-for="srv in servers"
      :key="srv.id"
      pixel
      hoverable
      padding="sm"
      class="cursor-pointer"
      @click="emit('toggle-expand', srv.id)"
    >
      <div class="flex items-center gap-3">
        <div :class="['w-2 h-2 flex-shrink-0 rounded-full', getStatusMeta(srv.status).dotClass]" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-black text-slate-800">{{ srv.name }}</h4>
            <span
              :class="[
                'text-[9px] font-bold px-1.5 py-0.5 border',
                getStatusMeta(srv.status).badgeClass,
              ]"
            >
              {{ getStatusMeta(srv.status).label }}
            </span>
            <span
              class="text-[9px] font-bold text-slate-400 px-1.5 py-0.5 bg-slate-50 border border-slate-200"
            >
              {{ (srv.type ?? 'stdio').toUpperCase() }}
            </span>
            <span
              v-if="!srv.enabled"
              class="text-[9px] font-bold text-orange-400 px-1.5 py-0.5 bg-orange-50 border border-orange-200"
            >
              已禁用
            </span>
          </div>
          <p class="text-[11px] text-slate-400 font-mono mt-1 truncate">
            {{ srv.type === 'stdio' ? srv.command : srv.url }}
            <span v-if="srv.args && srv.args.length > 0" class="ml-1 text-slate-300">
              {{ srv.args.join(' ') }}
            </span>
          </p>
          <p v-if="srv.error" class="text-[11px] text-red-400 font-mono mt-1 truncate">
            ⚠ {{ srv.error }}
          </p>
        </div>
        <div class="flex gap-1 flex-shrink-0">
          <PButton
            variant="ghost"
            size="sm"
            title="切换启用/禁用"
            @click.stop="emit('toggle-enabled', srv.id)"
          >
            <PixelIcon name="eye" size="xs" />
          </PButton>
          <PButton
            variant="ghost"
            size="sm"
            title="重新连接"
            :disabled="!srv.enabled"
            @click.stop="emit('reconnect', srv.id)"
          >
            <PixelIcon name="refresh" size="xs" />
          </PButton>
          <PButton variant="ghost" size="sm" title="删除" @click.stop="emit('remove', srv.id)">
            <PixelIcon name="trash" size="xs" />
          </PButton>
        </div>
      </div>

      <!-- 工具列表 (展开) -->
      <div
        v-if="expandedId === srv.id && srv.tools.length > 0"
        class="mt-3 pt-3 border-t border-slate-100"
      >
        <h5 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 font-pixel">
          可用工具 ({{ srv.tools.length }})
        </h5>
        <div
          v-for="tool in srv.tools"
          :key="tool.name"
          class="flex justify-between items-center px-2 py-1.5 border border-slate-200 mb-1"
        >
          <span class="text-xs font-bold text-sky-600 font-mono">{{ tool.name }}</span>
          <span class="text-[11px] text-slate-400 truncate ml-3">{{ tool.description }}</span>
        </div>
      </div>

      <!-- 无工具提示 -->
      <div
        v-if="expandedId === srv.id && srv.tools.length === 0 && srv.status === 'connected'"
        class="mt-3 pt-3 border-t border-slate-100"
      >
        <p class="text-[11px] text-slate-400 italic">该服务未暴露任何工具</p>
      </div>
    </PCard>
  </div>
</template>

<style scoped>
/* 像素风滚动条 */
.mcp-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.mcp-scrollbar::-webkit-scrollbar-thumb {
  background: #bae6fd;
  border-radius: 0;
}
</style>
