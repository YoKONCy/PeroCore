import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { inBrowser } from 'vitepress'
import ArchitectureGraph from '../components/ArchitectureGraph.vue'
import MemoryNetworkGraph from '../components/MemoryNetworkGraph.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app, router }) {
    app.component('ArchitectureGraph', ArchitectureGraph)
    app.component('MemoryNetworkGraph', MemoryNetworkGraph)
    if (inBrowser) {
      // @ts-ignore
      if (!document.startViewTransition) return

      router.onBeforeRouteChange = (to) => {
        // @ts-ignore
        const transition = document.startViewTransition(() => {
          // The promise is resolved when the DOM is updated
        })
        
        transition.finished.then(() => {
          // Cleanup if needed
        })
      }
    }
  }
} satisfies Theme
