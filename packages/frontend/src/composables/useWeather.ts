import { onMounted, onUnmounted, readonly, ref } from 'vue'
import type { WeatherStatus } from '@infos/shared'
import { apiClient } from '../api/client'
import { ApiError } from '../api/errors'

const status = ref<WeatherStatus>({
  query: '',
  snapshot: null,
  refreshing: false,
  stale: false,
  error: null,
})
const loaded = ref(false)
const saving = ref(false)
const error = ref('')
let users = 0
let revision = 0
let loading: Promise<void> | undefined
let timer: ReturnType<typeof setInterval> | undefined

async function load(): Promise<void> {
  if (saving.value) return
  if (loading) return loading
  const version = revision
  loading = (async () => {
    try {
      const response = await apiClient.get<WeatherStatus>('/system/weather')
      if (version === revision && response.data) {
        status.value = response.data
        error.value = ''
        loaded.value = true
      }
    } catch {
      if (version === revision) error.value = '天气信息暂时不可用'
    } finally {
      loading = undefined
    }
  })()
  return loading
}

function onVisible(): void {
  if (document.visibilityState === 'visible') void load()
}

export function useWeather() {
  onMounted(() => {
    users++
    void load()
    if (users === 1) {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') void load()
      }, 60_000)
      document.addEventListener('visibilitychange', onVisible)
    }
  })
  onUnmounted(() => {
    if (--users === 0) {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  })

  async function setLocation(location: string): Promise<boolean> {
    if (saving.value) return false
    saving.value = true
    revision++
    error.value = ''
    try {
      const response = await apiClient.put<WeatherStatus>('/system/weather/location', { location })
      if (response.data) status.value = response.data
      loaded.value = true
      return true
    } catch (cause) {
      error.value = cause instanceof ApiError ? cause.message : '城市未保存，请检查地点或稍后重试'
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    status: readonly(status),
    loaded: readonly(loaded),
    saving: readonly(saving),
    error: readonly(error),
    setLocation,
  }
}
