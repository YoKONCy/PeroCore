<script setup lang="ts">
/**
 * ConfirmOverlay — 指令确认遮罩
 *
 * Agent 请求执行终端指令时，弹出确认对话框。
 * 支持风险等级标签 (低/中/高/极高) 和危险操作警告。
 *
 * @props confirmation - 待确认的指令信息
 * @emits respond - 用户批准或拒绝
 */
import PixelIcon from '../pixel/PixelIcon.vue'

export interface PendingConfirmation {
  command: string
  riskInfo?: {
    /** 风险等级：0=安全 1=低 2=中 3=高 */
    level: number
    reason?: string
    highlight?: string[]
  }
}

interface Props {
  confirmation: PendingConfirmation | null
  /** Agent 名称 */
  agentName?: string
}

withDefaults(defineProps<Props>(), {
  agentName: 'Pero',
})

const emit = defineEmits<{
  respond: [approved: boolean]
}>()

/** 风险等级标签 */
function getRiskLabel(level?: number): string {
  if (!level) return ''
  const labels: Record<number, string> = { 1: '低风险', 2: '中风险', 3: '高风险' }
  return labels[level] ?? '未知风险'
}

/** 风险等级颜色 */
function getRiskColor(level?: number): string {
  if (!level || level <= 1) return 'bg-sky-500'
  if (level === 2) return 'bg-amber-500'
  return 'bg-rose-500'
}
</script>

<template>
  <Transition name="fade">
    <div
      v-if="confirmation"
      class="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-6"
    >
      <div
        class="w-full max-w-md border-2 border-slate-200 bg-white shadow-[8px_8px_0_rgba(0,0,0,0.15)] overflow-hidden"
      >
        <!-- 标题 -->
        <div class="flex items-center gap-3 px-6 py-4 border-b-2 border-slate-200">
          <div class="p-2 bg-sky-100 text-sky-500">
            <PixelIcon name="terminal" size="sm" />
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
              请求执行终端指令
              <span
                v-if="confirmation.riskInfo?.level"
                :class="[
                  'px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider',
                  getRiskColor(confirmation.riskInfo.level),
                ]"
              >
                {{ getRiskLabel(confirmation.riskInfo.level) }}
              </span>
            </h3>
            <p class="text-xs text-slate-400">{{ agentName }} 申请在您的系统中执行以下命令</p>
          </div>
        </div>

        <!-- 内容 -->
        <div class="p-6">
          <!-- 命令 -->
          <div
            class="p-4 bg-slate-900 border border-slate-200 font-mono text-[13px] text-emerald-400 overflow-x-auto"
          >
            <span class="select-text">{{ confirmation.command }}</span>
          </div>

          <!-- 高风险警告 -->
          <div
            v-if="confirmation.riskInfo && confirmation.riskInfo.level >= 2"
            class="mt-4 p-3 flex gap-3 items-start border border-rose-200 bg-rose-50/50"
          >
            <div class="p-1.5 flex-shrink-0 bg-rose-100 text-rose-500">
              <PixelIcon name="alert" size="xs" />
            </div>
            <div class="text-xs text-rose-600">
              <p class="font-bold mb-1">
                系统警告：{{ confirmation.riskInfo.reason ?? '敏感操作' }}
              </p>
              <p class="opacity-90 leading-relaxed">
                此指令包含可能修改系统关键配置或删除文件的操作。请务必确认指令来源和意图。
              </p>
            </div>
          </div>

          <!-- 低风险说明 -->
          <p v-else class="mt-4 text-xs text-center text-slate-400">
            说明:
            {{
              confirmation.riskInfo?.reason ??
              '请仔细检查指令内容。此操作将在您的系统终端中真实执行。'
            }}
          </p>
        </div>

        <!-- 操作按钮 -->
        <div class="flex justify-end gap-3 px-6 py-4 border-t-2 border-slate-200 bg-slate-50">
          <button
            class="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold border-2 border-slate-200 bg-white text-slate-500 cursor-pointer transition-all active:scale-95 hover:border-sky-300 hover:text-sky-500"
            @click="emit('respond', false)"
          >
            拒绝执行
          </button>
          <button
            class="flex items-center gap-1.5 px-4 py-2 text-[13px] font-bold border-2 border-sky-600 bg-sky-500 text-white cursor-pointer transition-all active:scale-95 hover:bg-sky-400"
            @click="emit('respond', true)"
          >
            <PixelIcon name="check" size="xs" />
            <span>
              {{
                confirmation.riskInfo?.level && confirmation.riskInfo.level >= 3
                  ? '确认授权并执行'
                  : '批准并执行'
              }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.fade-enter-active {
  transition: opacity 0.3s;
}
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
