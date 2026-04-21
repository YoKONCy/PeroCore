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
  if (!level || level <= 1) return 'risk-low'
  if (level === 2) return 'risk-medium'
  return 'risk-high'
}
</script>

<template>
  <Transition name="fade">
    <div v-if="confirmation" class="confirm-overlay">
      <div class="confirm-card">
        <!-- 标题 -->
        <div class="confirm-header">
          <div class="confirm-header-icon">
            <PixelIcon name="terminal" size="sm" />
          </div>
          <div>
            <h3 class="confirm-title">
              请求执行终端指令
              <span
                v-if="confirmation.riskInfo?.level"
                :class="['confirm-risk-badge', getRiskColor(confirmation.riskInfo.level)]"
              >
                {{ getRiskLabel(confirmation.riskInfo.level) }}
              </span>
            </h3>
            <p class="confirm-subtitle">{{ agentName }} 申请在您的系统中执行以下命令</p>
          </div>
        </div>

        <!-- 内容 -->
        <div class="confirm-body">
          <!-- 命令 -->
          <div class="confirm-code">
            <span class="confirm-code-text">{{ confirmation.command }}</span>
          </div>

          <!-- 高风险警告 -->
          <div
            v-if="confirmation.riskInfo && confirmation.riskInfo.level >= 2"
            class="confirm-warning"
          >
            <div class="confirm-warning-icon">
              <PixelIcon name="alert" size="xs" />
            </div>
            <div class="confirm-warning-text">
              <p class="confirm-warning-title">
                系统警告：{{ confirmation.riskInfo.reason ?? '敏感操作' }}
              </p>
              <p class="confirm-warning-desc">
                此指令包含可能修改系统关键配置或删除文件的操作。请务必确认指令来源和意图。
              </p>
            </div>
          </div>

          <!-- 低风险说明 -->
          <p v-else class="confirm-hint">
            说明:
            {{
              confirmation.riskInfo?.reason ??
              '请仔细检查指令内容。此操作将在您的系统终端中真实执行。'
            }}
          </p>
        </div>

        <!-- 操作按钮 -->
        <div class="confirm-actions">
          <button class="confirm-btn confirm-btn-reject" @click="emit('respond', false)">
            拒绝执行
          </button>
          <button class="confirm-btn confirm-btn-approve" @click="emit('respond', true)">
            <PixelIcon name="check" size="xs" />
            <span>{{
              confirmation.riskInfo?.level && confirmation.riskInfo.level >= 3
                ? '确认授权并执行'
                : '批准并执行'
            }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  padding: 24px;
}

.confirm-card {
  width: 100%;
  max-width: 448px;
  border: 2px solid var(--color-border);
  background: var(--color-bg-primary);
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 2px solid var(--color-border);
}
.confirm-header-icon {
  padding: 8px;
  background: var(--color-sky-100, rgba(56, 189, 248, 0.12));
  color: var(--color-sky-500);
}
.confirm-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--color-text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}
.confirm-subtitle {
  font-size: 12px;
  color: var(--color-text-muted);
}

.confirm-risk-badge {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.risk-low {
  background: var(--color-sky-500);
}
.risk-medium {
  background: var(--color-yellow-500, #eab308);
}
.risk-high {
  background: var(--color-red-face, #ef4444);
}

.confirm-body {
  padding: 24px;
}
.confirm-code {
  padding: 16px;
  background: var(--color-bg-secondary, #0f172a);
  border: 1px solid var(--color-border);
  font-family: monospace;
  font-size: 13px;
  color: var(--color-emerald-400, #4ade80);
  overflow-x: auto;
}
.confirm-code-text {
  user-select: text;
}

.confirm-warning {
  margin-top: 16px;
  padding: 12px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  border: 1px solid var(--color-red-light, #fecaca);
  background: rgba(239, 68, 68, 0.05);
}
.confirm-warning-icon {
  padding: 6px;
  flex-shrink: 0;
  background: rgba(239, 68, 68, 0.1);
  color: var(--color-red-face, #ef4444);
}
.confirm-warning-text {
  font-size: 12px;
  color: var(--color-red-shadow, #dc2626);
}
.confirm-warning-title {
  font-weight: 700;
  margin-bottom: 4px;
}
.confirm-warning-desc {
  opacity: 0.9;
  line-height: 1.5;
}

.confirm-hint {
  margin-top: 16px;
  font-size: 12px;
  text-align: center;
  color: var(--color-text-muted);
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 2px solid var(--color-border);
  background: var(--color-bg-secondary, rgba(0, 0, 0, 0.02));
}
.confirm-btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 700;
  border: 2px solid var(--color-border);
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.confirm-btn:active {
  transform: scale(0.95);
}

.confirm-btn-reject {
  background: var(--color-bg-primary);
  color: var(--color-text-secondary);
}
.confirm-btn-reject:hover {
  border-color: var(--color-sky-hover);
  color: var(--color-sky-500);
}

.confirm-btn-approve {
  background: var(--color-sky-500);
  color: white;
  border-color: var(--color-sky-shadow);
}
.confirm-btn-approve:hover {
  background: var(--color-sky-hover);
}

/* 过渡动画 */
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
