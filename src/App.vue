<template>
  <div class="app-container h-full w-full">
    <div class="main-content h-full w-full">
      <div v-if="!desktopAuthState.bootstrapped" class="auth-loading-shell">
        <div class="auth-loading-card">
          <div class="auth-loading-spinner"></div>
          <p>正在检查服务端鉴权状态...</p>
        </div>
      </div>
      <AuthGate
        v-else-if="desktopAuthState.required && !desktopAuthState.authorized"
        :busy="desktopAuthState.validating"
        :error="desktopAuthState.error"
        :header-name="desktopAuthState.headerName"
        @unlock="handleUnlock"
      />
      <router-view v-else v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
      <NotificationManager />
    </div>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { bootstrapDesktopAuth, desktopAuthState, validateDesktopAuthKey } from './api/runtimeAuth'
import AuthGate from './components/auth/AuthGate.vue'
import NotificationManager from './components/ui/NotificationManager.vue'
import { gatewayClient } from './api/gateway'

console.log('[App] App.vue 已初始化')

let gatewayInitialized = false
let gatewayListenersRegistered = false

const ensureGatewayReady = () => {
  if (!desktopAuthState.bootstrapped) return
  if (desktopAuthState.required && !desktopAuthState.authorized) {
    if (gatewayInitialized) {
      gatewayClient.disconnect()
      gatewayInitialized = false
    }
    return
  }

  if (!gatewayListenersRegistered) {
    gatewayListenersRegistered = true

    gatewayClient.on('action:system_error', (payload) => {
      console.warn('[Gateway] 收到系统错误广播:', payload)
      if (window.$notify) {
        const msg = payload.message || payload.payload || JSON.stringify(payload)
        const title = payload.title || '系统提示'
        const type = payload.type || 'error'
        window.$notify(msg, type, title, 10000)
      }
    })

    gatewayClient.on('action:mod_notification', (payload) => {
      console.log('[Gateway] 收到 MOD 通知:', payload)
      if (window.$notify) {
        const params = payload.params || payload
        const title = params.title || 'MOD 通知'
        const body = params.body || ''
        const level = params.level || 'info'
        const duration = parseInt(params.duration || '5000', 10)
        window.$notify(body, level, title, duration)
      }
    })
  }

  if (!gatewayInitialized) {
    gatewayInitialized = true
    gatewayClient.connect()
  }
}

const handleUnlock = async (apiKey, remember) => {
  const ok = await validateDesktopAuthKey(apiKey, { remember })
  if (ok) {
    ensureGatewayReady()
  }
}

watch(
  () => [desktopAuthState.bootstrapped, desktopAuthState.required, desktopAuthState.authorized],
  () => {
    ensureGatewayReady()
  }
)

onMounted(async () => {
  await bootstrapDesktopAuth()
  ensureGatewayReady()
})

// 全局 JS 错误捕获
window.addEventListener('error', (event) => {
  if (window.$notify) {
    window.$notify(event.message, 'error', '前端异常')
  } else {
    console.error('通知系统未就绪:', event.message)
  }
})

window.addEventListener('unhandledrejection', (event) => {
  if (window.$notify) {
    // Promise 错误通常在 reason 中
    const msg = event.reason ? event.reason.message || String(event.reason) : '未知 Promise 错误'
    window.$notify(msg, 'error', '未捕获的 Promise 异常')
  }
})

// 监听后端系统错误
if (window.electron && window.electron.on) {
  window.electron.on('system-error', (errorMsg) => {
    console.error('[系统错误]', errorMsg)
    if (window.$notify) {
      // 格式化错误信息，使其更易读
      let displayMsg = errorMsg
      if (errorMsg.includes('Traceback')) {
        displayMsg = '后端核心发生崩溃，请检查日志。'
      }
      window.$notify(displayMsg, 'error', '系统核心错误', 10000)
    }
  })
}
</script>

<style>
body,
html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: transparent !important;
}

#app {
  width: 100%;
  height: 100%;
  background: transparent !important;
}

.auth-loading-shell {
  display: flex;
  height: 100%;
  width: 100%;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(20, 16, 31, 0.98), rgba(12, 10, 18, 1));
}

.auth-loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: #f8f4ff;
}

.auth-loading-spinner {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 3px solid rgba(255, 255, 255, 0.12);
  border-top-color: #ec4899;
  animation: auth-spin 0.8s linear infinite;
}

@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
