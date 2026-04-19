/**
 * 前端应用入口
 *
 * 初始化顺序：样式 → Pinia → Router → 全局错误处理 → 挂载
 *
 * @module @perocore/frontend
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { ApiError, ERROR_UI_MAP, ErrorSeverity } from './api'
import { useNotificationStore } from './stores'

// 全局样式 (令牌 → Tailwind → 像素风组件)
import './assets/style.css'

const app = createApp(App)

// ── 全局状态管理 ──
const pinia = createPinia()
app.use(pinia)

// ── 路由 ──
app.use(router)

// ── 初始化通知 Store (Pinia 已挂载后可用) ──
const notificationStore = useNotificationStore()

// ── 全局错误处理 (05_FRONTEND_ARCHITECTURE.md §3.3) ──
app.config.errorHandler = (err) => {
  if (err instanceof ApiError) {
    const severity = ERROR_UI_MAP[err.code] ?? ErrorSeverity.TOAST

    if (severity === ErrorSeverity.SILENT) {
      console.warn(`[静默] ${err.code}: ${err.message}`)
    } else if (severity === ErrorSeverity.MODAL) {
      notificationStore.showModal(err.message, `错误: ${err.code}`, 'error')
    } else {
      notificationStore.toast(err.message, 'error')
    }
  } else {
    console.error('[未捕获错误]', err)
    notificationStore.toast('发生未知错误', 'error')
  }
}

app.mount('#app')
