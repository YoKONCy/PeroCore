import { onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { useWorkbenchStore } from '../stores/workbench'

export interface WorkspaceActions {
  rename(): void
  save(): Promise<void>
  prepareExit(keepDraft: boolean): Promise<void>
  resume(): void
  canKeepDraft(): boolean
  hasPendingInput(): boolean
}

/** 页面只登记交互入口，文稿数据仍由工作区与编辑会话管理。 */
export const workspaceActions = shallowRef<WorkspaceActions>()

/** 前台事务结束前阻止停止，计数避免页面切换时互相覆盖忙碌状态。 */
export function useApplicationBusy(busy: Readonly<Ref<boolean>>): void {
  const store = useWorkbenchStore()
  let registered = false
  const release = () => {
    if (registered) {
      store.foregroundOperations--
      registered = false
    }
  }
  watch(
    busy,
    (value) => {
      if (value && !registered) {
        store.foregroundOperations++
        registered = true
      } else if (!value) release()
    },
    { immediate: true, flush: 'sync' },
  )
  onBeforeUnmount(release)
}
