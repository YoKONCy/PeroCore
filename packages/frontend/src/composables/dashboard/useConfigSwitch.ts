import { onMounted, onUnmounted, ref } from 'vue'
import { configApi } from '../../api/modules/configApi'
import { useNotificationStore } from '../../stores/useNotificationStore'

/** 开关独立保存，失败时恢复实际配置，不要求额外点击保存。 */
export function useConfigSwitch(key: string, label: string) {
  const enabled = ref(true)
  const ready = ref(false)
  const saving = ref(false)
  const notify = useNotificationStore()
  let disposed = false
  onMounted(async () => {
    try {
      const result = await configApi.get<{ value: string | null }>(key)
      if (disposed) return
      enabled.value = result.data?.value !== 'false'
      ready.value = true
    } catch (error) {
      if (!disposed) notify.toast(`${label}配置加载失败：${(error as Error).message}`, 'error')
    }
  })
  onUnmounted(() => {
    disposed = true
  })

  async function setEnabled(value: boolean): Promise<void> {
    if (!ready.value || saving.value || value === enabled.value) return
    const previous = enabled.value
    saving.value = true
    enabled.value = value
    try {
      await configApi.set(key, String(value))
      if (!disposed) notify.toast(`${label}已${value ? '开启' : '关闭'}`, 'success')
    } catch (error) {
      if (!disposed) {
        enabled.value = previous
        notify.toast(`${label}保存失败：${(error as Error).message}`, 'error')
      }
    } finally {
      saving.value = false
    }
  }
  return { enabled, ready, saving, setEnabled }
}
