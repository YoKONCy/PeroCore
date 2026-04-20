<script setup lang="ts">
/**
 * LauncherView — 启动器页面 (F2-1)
 *
 * 启动流程: 连接动画 → 5 步检查列表 → 就绪 → 进入
 * v2 拆分: 容器 + useLauncher composable
 */
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { PixelIcon, PButton } from '../components/pixel'
import { useLauncher } from '../composables/launcher/useLauncher'

defineOptions({ name: 'LauncherView' })

const router = useRouter()
const {
  phase, progress, checks, allChecksOk, hasError,
  startLaunch, enterApp, retry,
} = useLauncher()

onMounted(() => { startLaunch() })

function handleEnter() {
  enterApp()
  setTimeout(() => { router.push('/chat') }, 600)
}
</script>

<template>
  <div class="launcher">
    <!-- 背景装饰 -->
    <div class="launcher-bg">
      <div class="launcher-grid" />
      <div class="launcher-glow" />
    </div>

    <!-- 主卡片 -->
    <div :class="['launcher-card', { 'launcher-card-ready': phase === 'ready' }]">
      <!-- 品牌 -->
      <div class="launcher-brand">
        <div class="launcher-logo">
          <span class="launcher-logo-letter">P</span>
        </div>
        <div class="launcher-brand-text">
          <span class="launcher-brand-sub">PEROPERO CHAT</span>
          <h1 class="launcher-brand-title">萌动链接</h1>
        </div>
      </div>

      <!-- 连接中 -->
      <div v-if="phase === 'connecting'" class="launcher-connecting">
        <PixelIcon name="refresh" size="lg" animation="spin" />
        <p class="launcher-phase-text">正在连接后端服务...</p>
        <div class="launcher-dots">
          <span class="dot dot-1" />
          <span class="dot dot-2" />
          <span class="dot dot-3" />
        </div>
      </div>

      <!-- 检查列表 -->
      <div v-if="phase === 'checking' || phase === 'ready'" class="launcher-checks">
        <div class="launcher-progress-bar">
          <div class="launcher-progress-fill" :style="{ width: progress + '%' }" />
        </div>
        <div class="check-list">
          <div v-for="item in checks" :key="item.id" class="check-item">
            <div :class="['check-icon', `check-${item.status}`]">
              <PixelIcon v-if="item.status === 'running'" name="refresh" size="xs" animation="spin" />
              <PixelIcon v-else-if="item.status === 'ok'" name="check" size="xs" />
              <PixelIcon v-else-if="item.status === 'warn'" name="alert" size="xs" />
              <PixelIcon v-else-if="item.status === 'error'" name="close" size="xs" />
              <span v-else class="check-dot-pending" />
            </div>
            <span class="check-label">{{ item.label }}</span>
            <span v-if="item.message" class="check-message">{{ item.message }}</span>
          </div>
        </div>
      </div>

      <!-- 就绪 -->
      <div v-if="phase === 'ready'" class="launcher-ready">
        <p class="launcher-ready-text">✨ 所有系统已就绪</p>
        <PButton variant="primary" class="launcher-enter-btn" @click="handleEnter">
          <PixelIcon name="chevron-right" size="xs" />
          进入 PeroperoChat
        </PButton>
      </div>

      <!-- 错误 -->
      <div v-if="hasError" class="launcher-error">
        <p class="launcher-error-text">部分服务连接失败</p>
        <PButton variant="ghost" @click="retry">
          <PixelIcon name="refresh" size="xs" />
          重试
        </PButton>
      </div>

      <!-- 进入中 -->
      <div v-if="phase === 'entering'" class="launcher-entering">
        <PixelIcon name="sparkle" size="lg" animation="bounce" />
        <p class="launcher-phase-text">欢迎回来，主人！</p>
      </div>

      <!-- 底部版本信息 -->
      <div class="launcher-footer">
        <span>v2.0.0-alpha · PeroCore-TS</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.launcher {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-bg-primary);
  position: relative; overflow: hidden;
}

/* 背景 */
.launcher-bg { position: absolute; inset: 0; pointer-events: none; }
.launcher-grid {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.04) 1px, transparent 1px);
  background-size: 32px 32px;
}
.launcher-glow {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 400px; height: 400px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.08) 0%, transparent 70%);
}

/* 主卡片 */
.launcher-card {
  position: relative; z-index: 1;
  width: 420px; padding: 40px;
  border: 3px solid var(--color-border);
  background: var(--color-bg-primary);
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.08);
  display: flex; flex-direction: column; align-items: center; gap: 32px;
  transition: all 0.5s;
}
.launcher-card-ready {
  border-color: var(--color-blue-300);
  box-shadow: 8px 8px 0 rgba(56, 189, 248, 0.12);
}

/* 品牌 */
.launcher-brand { display: flex; align-items: center; gap: 16px; }
.launcher-logo {
  width: 64px; height: 64px;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, var(--color-blue-400), var(--color-blue-600));
  border: 3px solid var(--color-blue-600);
  color: white; font-weight: 800; font-size: 28px;
  animation: float 3s ease-in-out infinite;
}
.launcher-logo-letter { user-select: none; }
.launcher-brand-text { display: flex; flex-direction: column; }
.launcher-brand-sub {
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.15em;
  color: var(--color-text-muted);
}
.launcher-brand-title {
  font-size: 24px; font-weight: 800;
  background: linear-gradient(135deg, var(--color-text-primary), var(--color-blue-500));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}

/* 连接中 */
.launcher-connecting { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.launcher-phase-text { font-size: 14px; font-weight: 700; color: var(--color-text-muted); }
.launcher-dots { display: flex; gap: 6px; }
.dot { width: 6px; height: 6px; background: var(--color-blue-400); animation: blink 1.2s ease-in-out infinite; }
.dot-2 { animation-delay: 0.2s; }
.dot-3 { animation-delay: 0.4s; }

/* 检查列表 */
.launcher-checks { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.launcher-progress-bar { width: 100%; height: 4px; background: var(--color-bg-secondary); overflow: hidden; }
.launcher-progress-fill { height: 100%; background: var(--color-blue-500); transition: width 0.4s ease; }
.check-list { display: flex; flex-direction: column; gap: 6px; }
.check-item { display: flex; align-items: center; gap: 10px; padding: 6px 8px; }
.check-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.check-pending { color: var(--color-text-muted); }
.check-running { color: var(--color-blue-500); }
.check-ok { color: var(--color-green-500, #22c55e); }
.check-warn { color: var(--color-yellow-500, #eab308); }
.check-error { color: var(--color-red-500, #ef4444); }
.check-dot-pending { width: 6px; height: 6px; background: var(--color-text-muted); opacity: 0.4; }
.check-label { font-size: 13px; font-weight: 700; color: var(--color-text-secondary); }
.check-message { margin-left: auto; font-size: 10px; font-weight: 700; color: var(--color-green-600, #16a34a); }

/* 就绪 */
.launcher-ready { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
.launcher-ready-text { font-size: 14px; font-weight: 700; color: var(--color-green-600, #16a34a); }
.launcher-enter-btn { width: 100%; justify-content: center; font-size: 15px; padding: 12px; }

/* 错误 */
.launcher-error { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.launcher-error-text { font-size: 13px; font-weight: 700; color: var(--color-red-500, #ef4444); }

/* 进入中 */
.launcher-entering { display: flex; flex-direction: column; align-items: center; gap: 12px; animation: fadeIn 0.3s ease; }

/* 底部 */
.launcher-footer {
  font-size: 10px; font-weight: 700; color: var(--color-text-muted);
  letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.5;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes blink {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
</style>
