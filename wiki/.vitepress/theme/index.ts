import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import { inBrowser } from 'vitepress'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ router }) {
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
