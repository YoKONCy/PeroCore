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
      <div class="confirm-dialog pixel-border-moe">
        <!-- 标题 -->
        <div class="confirm-header">
          <div class="confirm-icon pixel-border-moe">
            <PixelIcon name="terminal" size="sm" />
          </div>
          <div>
            <h3 class="confirm-title">
              请求执行终端指令
              <span
                v-if="confirmation.riskInfo?.level"
                :class="[
                  'confirm-risk-badge pixel-border-moe',
                  getRiskColor(confirmation.riskInfo.level),
                ]"
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
          <div class="confirm-code pixel-border-moe">
            <span class="select-text">{{ confirmation.command }}</span>
          </div>

          <!-- 高风险警告 -->
          <div
            v-if="confirmation.riskInfo && confirmation.riskInfo.level >= 2"
            class="confirm-warning pixel-border-moe"
          >
            <div class="confirm-warning-icon pixel-border-moe">
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
          <p v-else class="confirm-tip">
            说明:
            {{
              confirmation.riskInfo?.reason ??
              '请仔细检查指令内容。此操作将在您的系统终端中真实执行。'
            }}
          </p>
        </div>

        <!-- 操作按钮 -->
        <div class="confirm-actions">
          <button
            class="confirm-btn confirm-reject pixel-border-moe"
            @click="emit('respond', false)"
          >
            拒绝执行
          </button>
          <button
            class="confirm-btn confirm-approve pixel-border-moe"
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
.confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(45, 27, 30, 0.42);
  backdrop-filter: blur(6px);
}

.confirm-dialog {
  width: 100%;
  max-width: 448px;
  overflow: hidden;
  background: rgba(255, 252, 249, 0.96);
  box-shadow: 10px 10px 0 rgba(249, 168, 212, 0.24);
}

.confirm-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(45, 27, 30, 0.08);
  background: rgba(249, 168, 212, 0.08);
}

.confirm-icon {
  padding: 8px;
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.16);
}

.confirm-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-moe-cocoa);
  font-size: 14px;
  font-weight: 900;
}

.confirm-subtitle {
  margin-top: 4px;
  color: rgba(45, 27, 30, 0.44);
  font-size: 12px;
  font-weight: 700;
}

.confirm-risk-badge {
  padding: 2px 8px;
  color: white;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.risk-low {
  background: var(--color-moe-sky);
}

.risk-medium {
  background: var(--color-moe-yellow);
  color: var(--color-moe-cocoa);
}

.risk-high {
  background: var(--color-red-face);
}

.confirm-body {
  padding: 24px;
}

.confirm-code {
  overflow-x: auto;
  padding: 16px;
  background: rgba(45, 27, 30, 0.92);
  color: #86efac;
  font-family: monospace;
  font-size: 13px;
}

.confirm-warning {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-top: 16px;
  padding: 12px;
  background: rgba(254, 226, 226, 0.72);
}

.confirm-warning-icon {
  flex-shrink: 0;
  padding: 6px;
  color: var(--color-red-face);
  background: rgba(254, 202, 202, 0.72);
}

.confirm-warning-text {
  color: var(--color-red-outline);
  font-size: 12px;
}

.confirm-warning-title {
  margin-bottom: 4px;
  font-weight: 900;
}

.confirm-warning-desc {
  line-height: 1.6;
  opacity: 0.9;
}

.confirm-tip {
  margin-top: 16px;
  text-align: center;
  color: rgba(45, 27, 30, 0.44);
  font-size: 12px;
  font-weight: 700;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid rgba(45, 27, 30, 0.08);
  background: rgba(255, 255, 255, 0.34);
}

.confirm-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 900;
  transition: all 0.16s ease;
}

.confirm-btn:active {
  transform: translate(1px, 1px);
}

.confirm-reject {
  background: rgba(255, 255, 255, 0.68);
  color: rgba(45, 27, 30, 0.62);
}

.confirm-reject:hover {
  color: var(--color-moe-pink);
  background: rgba(249, 168, 212, 0.08);
}

.confirm-approve {
  background: var(--color-moe-pink);
  color: white;
}

.confirm-approve:hover {
  background: #f472b6;
  transform: translateY(-1px);
}

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
