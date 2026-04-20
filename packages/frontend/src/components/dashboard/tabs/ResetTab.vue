<script setup lang="ts">
/**
 * ResetTab — 危险区域 Tab (F1-5 增强)
 *
 * 分级重置选项 + 数据导出 + 二次确认。
 */
import { ref } from 'vue'
import { PixelIcon, PButton, PInput, PDialog } from '../../pixel'

// ── 确认弹窗 ──
const isConfirmOpen = ref(false)
const confirmAction = ref<{ label: string; action: string; description: string } | null>(null)
const confirmInput = ref('')
const isProcessing = ref(false)

const dangerActions = [
  { label: '清空对话记录', action: 'clear_logs', description: '删除所有对话日志和消息历史。记忆节点和配置不受影响。', icon: 'chat', severity: 'medium' as const },
  { label: '重置全部记忆', action: 'reset_memories', description: '删除所有记忆节点、标签、图谱关系。对话记录不受影响。', icon: 'brain', severity: 'high' as const },
  { label: '恢复出厂设置', action: 'factory_reset', description: '删除所有数据：对话、记忆、配置、模型设置。应用将回到初始状态。', icon: 'alert', severity: 'critical' as const },
]

const severityColors: Record<string, string> = {
  medium: 'sev-medium',
  high: 'sev-high',
  critical: 'sev-critical',
}

function openConfirm(action: typeof dangerActions[0]) {
  confirmAction.value = action
  confirmInput.value = ''
  isConfirmOpen.value = true
}

function executeAction() {
  if (!confirmAction.value) return
  if (confirmAction.value.severity === 'critical' && confirmInput.value !== '确认删除') return
  isProcessing.value = true
  // TODO: F3 替换为真实 API
  setTimeout(() => {
    isProcessing.value = false
    isConfirmOpen.value = false
  }, 1500)
}

// 数据导出
const isExporting = ref(false)
function exportData() {
  isExporting.value = true
  // TODO: F3 替换为 configApi.export()
  setTimeout(() => { isExporting.value = false }, 1000)
}
</script>

<template>
  <div class="tab-reset">
    <div class="tab-header">
      <h2 class="tab-title tab-title-danger"><PixelIcon name="alert" size="md" /><span>危险区域</span></h2>
      <p class="tab-subtitle">DANGER ZONE</p>
    </div>

    <!-- 数据导出 (安全操作) -->
    <div class="safe-section">
      <div class="safe-section-header">
        <PixelIcon name="download" size="sm" />
        <div>
          <h3 class="safe-title">数据导出</h3>
          <p class="safe-desc">导出所有配置、记忆和对话记录为 JSON 文件</p>
        </div>
      </div>
      <PButton variant="ghost" :loading="isExporting" @click="exportData">
        <PixelIcon name="download" size="xs" />
        导出全部数据
      </PButton>
    </div>

    <!-- 危险操作列表 -->
    <div class="danger-list">
      <div v-for="action in dangerActions" :key="action.action" :class="['danger-item', severityColors[action.severity]]">
        <div class="danger-info">
          <div class="danger-icon-wrap">
            <PixelIcon :name="action.icon" size="sm" />
          </div>
          <div>
            <h4 class="danger-label">{{ action.label }}</h4>
            <p class="danger-desc">{{ action.description }}</p>
          </div>
        </div>
        <PButton variant="danger" @click="openConfirm(action)">
          {{ action.label }}
        </PButton>
      </div>
    </div>

    <!-- 确认弹窗 -->
    <PDialog v-model="isConfirmOpen" title="⚠️ 危险操作确认" width="440px">
      <template v-if="confirmAction">
        <div class="confirm-body">
          <div class="confirm-warning">
            <PixelIcon name="alert" size="md" />
            <p>你确定要 <strong>{{ confirmAction.label }}</strong> 吗？</p>
          </div>
          <p class="confirm-desc">{{ confirmAction.description }}</p>
          <p class="confirm-warning-text">⚠️ 此操作不可撤销！</p>
          <div v-if="confirmAction.severity === 'critical'" class="confirm-input-area">
            <p class="confirm-input-hint">请输入 <strong>确认删除</strong> 以继续：</p>
            <PInput v-model="confirmInput" placeholder="确认删除" />
          </div>
        </div>
      </template>
      <template #footer>
        <PButton variant="ghost" @click="isConfirmOpen = false">取消</PButton>
        <PButton
          variant="danger"
          :loading="isProcessing"
          :disabled="confirmAction?.severity === 'critical' && confirmInput !== '确认删除'"
          @click="executeAction"
        >
          确认执行
        </PButton>
      </template>
    </PDialog>
  </div>
</template>

<style scoped>
.tab-reset { padding: 32px; height: 100%; overflow-y: auto; }
.tab-header { margin-bottom: 24px; }
.tab-title { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 800; }
.tab-title-danger { color: var(--color-red-500, #ef4444); }
.tab-subtitle { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.15em; color: var(--color-text-muted); margin-top: 4px; margin-left: 36px; }

/* 安全区 */
.safe-section {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px; border: 2px solid var(--color-border); background: var(--color-bg-primary); margin-bottom: 24px;
}
.safe-section-header { display: flex; align-items: center; gap: 12px; color: var(--color-text-secondary); }
.safe-title { font-size: 14px; font-weight: 800; color: var(--color-text-primary); }
.safe-desc { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; }

/* 危险列表 */
.danger-list { display: flex; flex-direction: column; gap: 12px; }
.danger-item {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px; border: 2px solid; transition: all 0.2s;
}
.sev-medium { border-color: rgba(234,179,8,0.3); background: rgba(234,179,8,0.03); }
.sev-high { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.03); }
.sev-critical { border-color: rgba(239,68,68,0.5); background: rgba(239,68,68,0.06); }
.danger-info { display: flex; align-items: center; gap: 16px; }
.danger-icon-wrap { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(239,68,68,0.1); color: var(--color-red-500, #ef4444); }
.danger-label { font-size: 14px; font-weight: 800; color: var(--color-text-primary); }
.danger-desc { font-size: 11px; color: var(--color-text-muted); margin-top: 2px; max-width: 400px; }

/* 确认弹窗 */
.confirm-body { display: flex; flex-direction: column; gap: 16px; }
.confirm-warning { display: flex; align-items: center; gap: 12px; color: var(--color-red-500, #ef4444); font-size: 14px; font-weight: 700; }
.confirm-desc { font-size: 13px; color: var(--color-text-secondary); line-height: 1.6; }
.confirm-warning-text { font-size: 12px; font-weight: 700; color: var(--color-red-500, #ef4444); }
.confirm-input-area { display: flex; flex-direction: column; gap: 8px; }
.confirm-input-hint { font-size: 12px; color: var(--color-text-muted); }
</style>
