/**
 * Wiki 自定义主题入口
 *
 * 扩展 VitePress 默认主题，注册全局组件和插件。
 *
 * @module packages/wiki/.vitepress/theme
 */

import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { inBrowser } from 'vitepress'
import ArchitectureGraph from '../components/ArchitectureGraph.vue'
import MemoryNetworkGraph from '../components/MemoryNetworkGraph.vue'
import BedrockDemo from '../components/BedrockDemo.vue'
import MDPGraph from '../components/MDPGraph.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    // 注册 Wiki 专用全局组件
    app.component('ArchitectureGraph', ArchitectureGraph)
    app.component('MemoryNetworkGraph', MemoryNetworkGraph)
    app.component('BedrockDemo', BedrockDemo)
    app.component('MDPGraph', MDPGraph)

    // 页面切换 View Transition (仅浏览器端)
    if (inBrowser) {
      // @ts-ignore — View Transitions API 尚未被所有 TypeScript 版本识别
      if (!document.startViewTransition) return

      router.onBeforeRouteChange = () => {
        // @ts-ignore
        const transition = document.startViewTransition(() => {
          // DOM 更新完成后 resolve
        })

        transition.finished.then(() => {
          // 过渡完成，如需清理可在此处理
        })
      }
    }
  },
} satisfies Theme
