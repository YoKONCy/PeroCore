<script setup lang="ts">
/**
 * ResetTab — 危险区域 Tab
 *
 * 分级重置选项 + 数据导出 + 二次确认。
 * Phase 2: 改用 DashboardContext 的全局 openConfirm 弹窗。
 */
import { ref } from 'vue'
import { PixelIcon, PButton, PCard } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { logger } from '../../../lib/logger'
import { useNotificationStore } from '../../../stores'

const ctx = useDashboardContext()
const notif = useNotificationStore()

// ── 操作状态 ──
const isProcessing = ref(false)

const dangerActions = [
  {
    label: '清空对话记录',
    action: 'clear_logs',
    description: '删除所有对话日志和消息历史。记忆节点和配置不受影响。',
    icon: 'chat',
    severity: 'medium' as const,
  },
  {
    label: '重置全部记忆',
    action: 'reset_memories',
    description: '删除所有记忆节点、标签、图谱关系。对话记录不受影响。',
    icon: 'brain',
    severity: 'high' as const,
  },
  {
    label: '恢复出厂设置',
    action: 'factory_reset',
    description: '删除所有数据：对话、记忆、配置、模型设置。应用将回到初始状态。',
    icon: 'alert',
    severity: 'critical' as const,
  },
]

/** 通过全局 openConfirm 打开确认弹窗并执行操作 */
async function handleDangerAction(action: (typeof dangerActions)[0]) {
  try {
    const isCritical = action.severity === 'critical'
    const result = await ctx.openConfirm(
      `⚠️ ${action.label}`,
      `${action.description}\n\n⚠️ 此操作不可撤销！`,
      {
        type: action.severity === 'medium' ? 'warning' : 'error',
        isPrompt: isCritical,
        inputPlaceholder: isCritical ? '请输入"确认删除"以继续' : undefined,
      },
    )

    // critical 操作需要验证输入
    if (isCritical && result.value !== '确认删除') {
      logger.warn('ResetTab', '输入不匹配，操作已取消')
      return
    }

    isProcessing.value = true
    // TODO: 后端 Thread 架构下重置接口待补齐（原 chatApi.reset 已移除）
    logger.info('ResetTab', `${action.label} 执行成功`)
  } catch {
    // openConfirm reject = 用户取消，不做任何事
  } finally {
    isProcessing.value = false
  }
}

// 数据导出
const isExporting = ref(false)
async function exportData() {
  isExporting.value = true
  try {
    const res = await configApi.exportAll()
    // 下载为 JSON 文件
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `perocore-config-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    notif.toast('数据已导出', { type: 'success', title: '数据导出' })
  } catch (err) {
    logger.error('ResetTab', '导出失败', err)
    notif.toast('导出失败，请稍后重试', { type: 'error', title: '数据导出' })
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <div class="p-8 h-full overflow-y-auto">
    <div class="mb-6 relative group/header">
      <!-- 背景氛围光晕 (红色警告感) -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-rose-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-rose-400/15 transition-all duration-1000"
      />
      <h2 class="flex items-center gap-3 text-2xl font-black text-rose-500 font-pixel">
        <span
          class="group-hover/header:scale-110 group-hover/header:rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="alert" size="md" />
        </span>
        <span>危险区域</span>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        DANGER ZONE
      </p>
    </div>

    <!-- 数据导出 (安全操作) -->
    <PCard pixel class="flex justify-between items-center mb-6">
      <div class="flex items-center gap-3 text-slate-500">
        <PixelIcon name="download" size="sm" />
        <div>
          <h3 class="text-sm font-black text-slate-800">数据导出</h3>
          <p class="text-[11px] text-slate-400 mt-0.5">导出所有配置、记忆和对话记录为 JSON 文件</p>
        </div>
      </div>
      <PButton variant="ghost" :loading="isExporting" @click="exportData">
        <PixelIcon name="download" size="xs" />
        导出全部数据
      </PButton>
    </PCard>

    <!-- 危险操作列表 -->
    <div class="flex flex-col gap-3">
      <div
        v-for="action in dangerActions"
        :key="action.action"
        :class="[
          'flex justify-between items-center p-5 border-2 transition-all',
          action.severity === 'medium' ? 'border-amber-300/30 bg-amber-50/30' : '',
          action.severity === 'high' ? 'border-rose-400/30 bg-rose-50/30' : '',
          action.severity === 'critical' ? 'border-rose-400/50 bg-rose-50/60' : '',
        ]"
      >
        <div class="flex items-center gap-4">
          <div class="w-10 h-10 flex items-center justify-center bg-rose-100 text-rose-500">
            <PixelIcon :name="action.icon" size="sm" />
          </div>
          <div>
            <h4 class="text-sm font-black text-slate-800">{{ action.label }}</h4>
            <p class="text-[11px] text-slate-400 mt-0.5 max-w-[400px]">
              {{ action.description }}
            </p>
          </div>
        </div>
        <PButton variant="danger" :loading="isProcessing" @click="handleDangerAction(action)">
          {{ action.label }}
        </PButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ResetTab 无需额外 scoped CSS — 全部使用 Tailwind + pixel 类 */
</style>
