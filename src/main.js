import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import { loader } from "@guolao/vue-monaco-editor"
import App from './App.vue'
import router from './router'
import './style.css'

// Config Monaco Editor to use Chinese
// 配置 Monaco Editor 使用中文
loader.config({
  "vs/nls": {
    availableLanguages: {
      "*": "zh-cn"
    }
  }
})

const app = createApp(App)

// Global error handler
// 全局错误处理
app.config.errorHandler = (err, instance, info) => {
  console.error('[Vue Error]', err);
  console.error('[Vue Error Info]', info);
};

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(router)
app.use(ElementPlus)
app.mount('#app')
