import { onBeforeUnmount, onMounted, readonly, ref } from 'vue'
import { isElectronRuntime } from '../../api/transport'

const media =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1200px)')
    : undefined
const mobile = ref(!isElectronRuntime() && !!media?.matches)

/** 移动布局只用于浏览器主应用，不改变 Electron 窗口及子应用布局。 */
export function useMobileLayout() {
  return { isMobile: readonly(mobile) }
}

/** 根组件统一管理视口；软键盘弹出时输入台跟随可见高度，不叠加键盘遮挡。 */
export function useMobileViewport() {
  let frame = 0
  function update() {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      mobile.value = !isElectronRuntime() && !!media?.matches
      const root = document.documentElement
      if (mobile.value) {
        root.dataset.mobile = ''
        const height = window.visualViewport?.height || window.innerHeight
        root.style.setProperty('--client-height', `${height}px`)
        root.toggleAttribute(
          'data-keyboard',
          height < 480 &&
            !!document.activeElement?.matches('input, textarea, [contenteditable="true"]'),
        )
      } else {
        delete root.dataset.mobile
        delete root.dataset.keyboard
        root.style.removeProperty('--client-height')
      }
    })
  }
  onMounted(() => {
    update()
    media?.addEventListener('change', update)
    window.addEventListener('resize', update)
    window.addEventListener('focusin', update)
    window.addEventListener('focusout', update)
    window.visualViewport?.addEventListener('resize', update)
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    media?.removeEventListener('change', update)
    window.removeEventListener('resize', update)
    window.removeEventListener('focusin', update)
    window.removeEventListener('focusout', update)
    window.visualViewport?.removeEventListener('resize', update)
    delete document.documentElement.dataset.mobile
    delete document.documentElement.dataset.keyboard
    document.documentElement.style.removeProperty('--client-height')
  })
}
