<script setup lang="ts">
/**
 * SocialTab — Dashboard 社交适配器管理面板
 *
 * 可扩展的社交适配器管理中心，通过顶部卡片切换不同适配器。
 * 当前仅实现 NapCat (QQ) 适配器。
 *
 * 结构:
 * - 顶部: 适配器选择卡片 (NapCat / Discord / Telegram, 后两者预留)
 * - 中部: 选中适配器的配置 + 控制面板
 * - 底部: 终端日志 (复用 SocialAdapterTerminal)
 *
 * @module packages/frontend/src/components/dashboard/tabs/SocialTab
 */
import { ref, onMounted } from 'vue'
import { PixelIcon, PButton } from '../../pixel'
import { invoke } from '../../../utils/ipcAdapter'
import { isElectron } from '../../../utils/ipcAdapter'
import { socialApi } from '../../../api/modules/socialApi'
import SocialAdapterTerminal from '../../terminal/SocialAdapterTerminal.vue'

// ── 类型 ──

interface AdapterCard {
  id: string
  name: string
  platform: string
  icon: string
  description: string
  available: boolean
}

// ── 适配器列表 ──

const adapters: AdapterCard[] = [
  {
    id: 'napcat',
    name: 'NapCat',
    platform: 'qq',
    icon: 'chat',
    description: 'QQ 机器人 (OneBot v11)',
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    platform: 'discord',
    icon: 'terminal',
    description: 'Discord Bot',
    available: false,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    platform: 'telegram',
    icon: 'flash',
    description: 'Telegram Bot',
    available: false,
  },
]

// ── 状态 ──

const selectedAdapter = ref('napcat')
const napcatInstalled = ref(false)
const napcatRunning = ref(false)
const napcatChecking = ref(false)
const napcatInstalling = ref(false)
const adapterConnected = ref(false)

/** 是否为 Electron 环境 (进程管理仅 Electron 可用) */
const canManageProcess = isElectron()

// ── 方法 ──

/** 检查 NapCat 安装状态 */
async function checkNapCat(): Promise<void> {
  napcatChecking.value = true
  try {
    const installed = await invoke('check-napcat')
    napcatInstalled.value = !!installed

    // 同时从后端 API 获取连接状态
    try {
      const res = await socialApi.getStatus()
      const qqAdapter = res.data?.adapters?.find((a) => a.platform === 'qq')
      adapterConnected.value = qqAdapter?.connected ?? false
    } catch {
      // API 不可用
    }
  } catch {
    napcatInstalled.value = false
  } finally {
    napcatChecking.value = false
  }
}

/** 安装 NapCat */
async function installNapCat(): Promise<void> {
  napcatInstalling.value = true
  try {
    const result = await invoke('install-napcat')
    if (result) {
      napcatInstalled.value = true
    }
  } catch (e) {
    console.error('NapCat 安装失败:', e)
  } finally {
    napcatInstalling.value = false
  }
}

/** 启动 NapCat */
async function startNapCat(): Promise<void> {
  try {
    await invoke('start-napcat')
    napcatRunning.value = true
  } catch (e) {
    console.error('NapCat 启动失败:', e)
  }
}

/** 停止 NapCat */
async function stopNapCat(): Promise<void> {
  try {
    await invoke('stop-napcat')
    napcatRunning.value = false
  } catch (e) {
    console.error('NapCat 停止失败:', e)
  }
}

// ── 初始化 ──

onMounted(async () => {
  if (canManageProcess) {
    await checkNapCat()
  } else {
    // Docker 模式：只检查 API 连接状态
    try {
      const res = await socialApi.getStatus()
      const qqAdapter = res.data?.adapters?.find((a) => a.platform === 'qq')
      adapterConnected.value = qqAdapter?.connected ?? false
    } catch {
      // 静默
    }
  }
})
</script>

<template>
  <div class="social-panel">
    <!-- 顶部：适配器选择卡片 -->
    <div class="sp-header">
      <div class="sp-header-title">
        <PixelIcon name="chat" size="sm" class="sp-title-icon" />
        <span class="sp-title-text">社交适配器</span>
        <span class="sp-badge">SOCIAL</span>
      </div>

      <div class="sp-adapter-cards">
        <button
          v-for="adapter in adapters"
          :key="adapter.id"
          :class="[
            'sp-card',
            selectedAdapter === adapter.id && 'sp-card-active',
            !adapter.available && 'sp-card-disabled',
          ]"
          :disabled="!adapter.available"
          @click="adapter.available && (selectedAdapter = adapter.id)"
        >
          <div class="sp-card-icon">
            <PixelIcon :name="adapter.icon" size="sm" />
          </div>
          <div class="sp-card-info">
            <span class="sp-card-name">{{ adapter.name }}</span>
            <span class="sp-card-desc">{{ adapter.description }}</span>
          </div>
          <div v-if="adapter.available" class="sp-card-status">
            <span
              v-if="adapter.id === 'napcat'"
              :class="['sp-status-dot', adapterConnected ? 'sp-dot-on' : 'sp-dot-off']"
            />
            <span v-else class="sp-status-dot sp-dot-off" />
          </div>
          <span v-else class="sp-card-tag">待实现</span>
        </button>
      </div>
    </div>

    <!-- 中部：NapCat 配置面板 (仅 Electron) -->
    <div v-if="selectedAdapter === 'napcat' && canManageProcess" class="sp-config">
      <div class="sp-config-row">
        <!-- 安装状态 -->
        <div class="sp-config-block">
          <div class="sp-block-header">
            <PixelIcon name="download" size="xs" />
            <span>进程管理</span>
          </div>
          <div class="sp-block-body">
            <div class="sp-status-line">
              <span class="sp-label">安装状态</span>
              <span :class="['sp-value', napcatInstalled ? 'sp-ok' : 'sp-na']">
                {{ napcatChecking ? '检查中...' : napcatInstalled ? '已安装' : '未安装' }}
              </span>
            </div>
            <div class="sp-status-line">
              <span class="sp-label">连接状态</span>
              <span :class="['sp-value', adapterConnected ? 'sp-ok' : 'sp-na']">
                {{ adapterConnected ? '已连接' : '未连接' }}
              </span>
            </div>
            <div class="sp-actions">
              <PButton
                v-if="!napcatInstalled"
                size="sm"
                :disabled="napcatInstalling || napcatChecking"
                @click="installNapCat"
              >
                <PixelIcon name="download" size="xs" />
                {{ napcatInstalling ? '安装中...' : '一键安装' }}
              </PButton>
              <template v-else>
                <PButton v-if="!napcatRunning" size="sm" variant="primary" @click="startNapCat">
                  <PixelIcon name="flash" size="xs" />
                  启动
                </PButton>
                <PButton v-else size="sm" variant="ghost" @click="stopNapCat">
                  <PixelIcon name="alert" size="xs" />
                  停止
                </PButton>
              </template>
              <PButton size="sm" variant="ghost" :disabled="napcatChecking" @click="checkNapCat">
                <PixelIcon name="refresh" size="xs" />
              </PButton>
            </div>
          </div>
        </div>

        <!-- 连接信息 -->
        <div class="sp-config-block">
          <div class="sp-block-header">
            <PixelIcon name="settings" size="xs" />
            <span>连接配置</span>
          </div>
          <div class="sp-block-body">
            <div class="sp-status-line">
              <span class="sp-label">WS 端点</span>
              <span class="sp-value sp-mono">ws://127.0.0.1:9120/api/social/ws</span>
            </div>
            <div class="sp-status-line">
              <span class="sp-label">协议</span>
              <span class="sp-value">OneBot v11 (反向 WS)</span>
            </div>
            <div class="sp-hint">请在 NapCat 配置中将反向 WS 地址设置为上述端点</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Docker 模式提示 -->
    <div v-if="selectedAdapter === 'napcat' && !canManageProcess" class="sp-config">
      <div class="sp-config-row">
        <div class="sp-config-block sp-full">
          <div class="sp-block-header">
            <PixelIcon name="terminal" size="xs" />
            <span>Docker 模式</span>
          </div>
          <div class="sp-block-body">
            <div class="sp-status-line">
              <span class="sp-label">WS 端点</span>
              <span class="sp-value sp-mono">ws://&lt;host&gt;:9120/api/social/ws</span>
            </div>
            <div class="sp-status-line">
              <span class="sp-label">连接状态</span>
              <span :class="['sp-value', adapterConnected ? 'sp-ok' : 'sp-na']">
                {{ adapterConnected ? '已连接' : '等待外部 NapCat 连接...' }}
              </span>
            </div>
            <div class="sp-hint">
              Docker 模式下请在外部独立运行 NapCat，并配置反向 WS 连接到后端容器
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部：终端日志 -->
    <div class="sp-terminal">
      <SocialAdapterTerminal />
    </div>
  </div>
</template>

<style scoped>
/* ── 根容器 ── */
.social-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, #f8fafc 0%, #f0f9ff 100%);
}

/* ── 头部 ── */
.sp-header {
  padding: 20px 24px 12px;
  flex-shrink: 0;
}

.sp-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.sp-title-icon {
  color: var(--color-sky-500, #0ea5e9);
}

.sp-title-text {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
  letter-spacing: 0.02em;
}

.sp-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  background: rgba(14, 165, 233, 0.1);
  color: var(--color-sky-500, #0ea5e9);
  border: 1px solid rgba(14, 165, 233, 0.2);
  letter-spacing: 0.1em;
}

/* ── 适配器卡片 ── */
.sp-adapter-cards {
  display: flex;
  gap: 10px;
}

.sp-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: white;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  cursor: pointer;
  transition: all 0.2s;
  min-width: 180px;
  position: relative;
}

.sp-card:hover:not(.sp-card-disabled) {
  border-color: var(--color-sky-300, #7dd3fc);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.1);
}

.sp-card-active {
  border-color: var(--color-sky-400, #38bdf8) !important;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.15);
}

.sp-card-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.sp-card-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-sky-50, #f0f9ff);
  border: 1px solid var(--color-sky-100, #e0f2fe);
  color: var(--color-sky-500, #0ea5e9);
  flex-shrink: 0;
}

.sp-card-active .sp-card-icon {
  background: var(--color-sky-400, #38bdf8);
  color: white;
  border-color: var(--color-sky-400, #38bdf8);
}

.sp-card-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sp-card-name {
  font-size: 12px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
}

.sp-card-desc {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
}

.sp-card-status {
  margin-left: auto;
}

.sp-status-dot {
  display: block;
  width: 8px;
  height: 8px;
}

.sp-dot-on {
  background: var(--emerald-face, #34d399);
  animation: sp-pulse 2s ease-in-out infinite;
}

.sp-dot-off {
  background: var(--text-muted, #94a3b8);
}

.sp-card-tag {
  margin-left: auto;
  font-size: 9px;
  font-weight: 700;
  color: var(--text-muted, #94a3b8);
  background: var(--color-sky-50, #f0f9ff);
  padding: 1px 6px;
  border: 1px solid var(--color-sky-100, #e0f2fe);
}

/* ── 配置区 ── */
.sp-config {
  padding: 0 24px 12px;
  flex-shrink: 0;
}

.sp-config-row {
  display: flex;
  gap: 12px;
}

.sp-config-block {
  flex: 1;
  background: white;
  border: 2px solid var(--color-sky-100, #e0f2fe);
  overflow: hidden;
}

.sp-config-block.sp-full {
  flex: unset;
  width: 100%;
}

.sp-block-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-sky-50, #f0f9ff);
  border-bottom: 1px solid var(--color-sky-100, #e0f2fe);
  font-size: 11px;
  font-weight: 800;
  color: var(--text-primary, #1e293b);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sp-block-header :deep(.pixel-icon) {
  color: var(--color-sky-500, #0ea5e9);
}

.sp-block-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sp-status-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
}

.sp-label {
  color: var(--text-muted, #94a3b8);
  font-weight: 600;
}

.sp-value {
  font-weight: 700;
  color: var(--text-primary, #1e293b);
}

.sp-value.sp-ok {
  color: var(--emerald-face, #34d399);
}

.sp-value.sp-na {
  color: var(--text-muted, #94a3b8);
}

.sp-value.sp-mono {
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 10px;
  background: var(--color-sky-50, #f0f9ff);
  padding: 1px 6px;
  border: 1px solid var(--color-sky-100, #e0f2fe);
}

.sp-hint {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
  padding: 4px 0 0;
  border-top: 1px dashed var(--color-sky-100, #e0f2fe);
  margin-top: 2px;
}

.sp-actions {
  display: flex;
  gap: 6px;
  margin-top: 4px;
}

/* ── 终端区 ── */
.sp-terminal {
  flex: 1;
  overflow: hidden;
  margin: 0 24px 16px;
  border: 2px solid var(--color-sky-100, #e0f2fe);
}

/* ── 动画 ── */
@keyframes sp-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
</style>
