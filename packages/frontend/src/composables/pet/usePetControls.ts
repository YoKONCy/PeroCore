import { onMounted, onUnmounted, ref } from 'vue'
import {
  DEFAULT_PET_CONTROLS,
  type PetControlSettings,
  type PetControlSnapshot,
} from '@infos/shared'
import { invoke, isElectron, listen } from '../../utils/ipcAdapter'

/** 设置由主进程持久化；各窗口只保留投影，不分别维护快捷键。 */
export function usePetControls() {
  const settings = ref<PetControlSettings>({ ...DEFAULT_PET_CONTROLS })
  const supported = ref(false)
  const loaded = ref(false)
  const error = ref('')
  let disposed = false
  let unlisten: (() => void) | undefined
  function apply(snapshot: PetControlSnapshot) {
    settings.value = snapshot.settings
    supported.value = snapshot.pttSupported
    error.value = snapshot.error
  }
  async function update(patch: Partial<PetControlSettings>): Promise<boolean> {
    try {
      if (!isElectron()) throw new Error('请在桌面客户端配置全局语音控制')
      apply((await invoke('pet-controls:update', patch)) as PetControlSnapshot)
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '桌宠设置保存失败'
      return false
    }
  }
  onMounted(async () => {
    try {
      if (!isElectron()) return
      const remove = await listen('pet-controls:changed', (data) => {
        if (!disposed) apply(data as PetControlSnapshot)
      })
      if (disposed) {
        remove()
        return
      }
      unlisten = remove
      const snapshot = (await invoke('pet-controls:get')) as PetControlSnapshot
      if (!disposed) apply(snapshot)
    } catch (cause) {
      if (!disposed) error.value = cause instanceof Error ? cause.message : '桌宠设置读取失败'
    } finally {
      if (!disposed) loaded.value = true
    }
  })
  onUnmounted(() => {
    disposed = true
    unlisten?.()
  })
  return { settings, supported, loaded, error, update }
}
