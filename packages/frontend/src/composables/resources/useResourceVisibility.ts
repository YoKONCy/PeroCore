import { computed, onMounted, onBeforeUnmount, ref, type Ref } from 'vue'

/** 资源只在接近可视区域时读取，离开后暂停媒体并释放重型预览。 */
export function useResourceVisibility(root: Ref<HTMLElement | null>) {
  const visible = ref(false)
  const documentVisible = ref(document.visibilityState !== 'hidden')
  const visibilityChanged = () => {
    documentVisible.value = document.visibilityState !== 'hidden'
  }
  let observer: IntersectionObserver | undefined
  onMounted(() => {
    document.addEventListener('visibilitychange', visibilityChanged)
    if (!root.value || typeof IntersectionObserver === 'undefined') {
      visible.value = true
      return
    }
    observer = new IntersectionObserver(
      (entries) => {
        visible.value = entries.some((entry) => entry.isIntersecting)
      },
      { rootMargin: '120px 0px' },
    )
    observer.observe(root.value)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    document.removeEventListener('visibilitychange', visibilityChanged)
  })
  return computed(() => visible.value && documentVisible.value)
}
