/**
 * main — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useWorkbenchStore } from './stores/workbench'
import './styles/tokens.css'
import './styles/workbench.css'
import './styles/finish.css'
import './styles/controls.css'
import './styles/settings.css'
import './styles/book.css'
import './styles/light.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
useWorkbenchStore().applyTheme()
app.mount('#app')
