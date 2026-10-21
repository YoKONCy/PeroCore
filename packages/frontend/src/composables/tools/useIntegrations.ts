import { t as __t } from '../../i18n/index'
import { onMounted, readonly, ref } from 'vue'
import type {
  ApiResponse,
  ExtensionToolId,
  IntegrationFeature,
  IntegrationSourceInput,
  IntegrationsView,
} from '@infos/shared'
import { integrationsApi } from '../../api/modules/integrationsApi'
import { useNotificationStore } from '../../stores'

const state = ref<IntegrationsView | null>(null)
const busy = ref(false)
const error = ref('')
let loading: Promise<void> | undefined
let revision = 0

export function useIntegrations() {
  const notify = useNotificationStore()
  async function load(): Promise<void> {
    if (busy.value) return
    if (loading) return loading
    const version = revision
    loading = (async () => {
      try {
        const response = await integrationsApi.get()
        if (version === revision) {
          if (response.data) state.value = response.data
          error.value = ''
        }
      } catch {
        if (version === revision) error.value = '工具与扩展配置暂时无法读取'
      } finally {
        loading = undefined
      }
    })()
    return loading
  }
  onMounted(() => {
    void load()
  })
  async function change(action: () => Promise<ApiResponse<IntegrationsView>>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    revision++
    error.value = ''
    try {
      const response = await action()
      if (response.data) state.value = response.data
      window.dispatchEvent(new Event('infos:integrations-changed'))
      notify.toast(response.message || __t('ui.tools', '配置已保存'), { type: 'success' })
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '配置保存失败'
      notify.toast(error.value, { type: 'error' })
      return false
    } finally {
      busy.value = false
    }
  }
  return {
    state: readonly(state),
    busy: readonly(busy),
    error: readonly(error),
    load,
    updateExtension: (
      id: ExtensionToolId,
      input: Parameters<typeof integrationsApi.extension>[1],
    ) => change(() => integrationsApi.extension(id, input)),
    updateFeature: (kind: IntegrationFeature, enabled: boolean, selectedSourceId: string | null) =>
      change(() => integrationsApi.feature(kind, { enabled, selectedSourceId })),
    saveSource: (kind: IntegrationFeature, source: IntegrationSourceInput) =>
      change(() => integrationsApi.saveSource(kind, source)),
    removeSource: (kind: IntegrationFeature, id: string) =>
      change(() => integrationsApi.removeSource(kind, id)),
  }
}
