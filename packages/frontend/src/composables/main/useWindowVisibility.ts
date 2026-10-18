import { computed, onMounted, onUnmounted, ref } from 'vue'
import { invoke, isElectron, listen } from '../../utils/ipcAdapter'

/** 原生窗口使用宿主可见性，浏览器标签页使用 Page Visibility。 */
export function useWindowVisibility() {
  const nativeVisible = ref(true)
  const nativeKnown = ref(false)
  const nativePending = ref(isElectron())
  const documentVisible = ref(!document.hidden)
  let revision = 0
  let disposed = false
  let stop: (() => void) | undefined
  const updateDocument = () => {
    documentVisible.value = !document.hidden
  }
  onMounted(async () => {
    document.addEventListener('visibilitychange', updateDocument)
    if (!isElectron()) return
    try {
      const unlisten = await listen('window-visibility-changed', (value) => {
        if (typeof value === 'boolean') {
          revision++
          nativeVisible.value = value
          nativeKnown.value = true
        }
      })
      if (disposed) {
        unlisten()
        return
      }
      stop = unlisten
      const current = revision
      const value = await invoke('window-is-visible')
      if (!disposed && current === revision && typeof value === 'boolean') {
        nativeVisible.value = value
        nativeKnown.value = true
      }
    } catch {
      // 普通浏览器及旧宿主继续使用 Page Visibility，不阻断界面启动。
    } finally {
      nativePending.value = false
    }
  })
  onUnmounted(() => {
    disposed = true
    stop?.()
    document.removeEventListener('visibilitychange', updateDocument)
  })
  return computed(() =>
    nativeKnown.value ? nativeVisible.value : !nativePending.value && documentVisible.value,
  )
}
