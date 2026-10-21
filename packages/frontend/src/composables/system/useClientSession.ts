import { ref } from 'vue'
import { clientAccessApi, type ClientSession } from '../../api/modules/clientAccessApi'
import { clearWebClientCredential, isElectronRuntime } from '../../api/transport'

const clientSession = createClientSession()

export function createClientSession() {
  const electron = isElectronRuntime()
  const session = ref<ClientSession>({ authenticated: electron, admin: electron })
  const checking = ref(false)
  const error = ref('')
  let pending: Promise<void> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryCount = 0
  let revision = 0
  let lastCheckedAt = 0
  let started = false
  let disposed = false

  function clearRetry(): void {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = undefined
  }

  function scheduleRetry(): void {
    clearRetry()
    if (disposed || navigator.onLine === false) return
    const delay = Math.min(1_000 * 2 ** Math.min(retryCount++, 5), 30_000)
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      void check()
    }, delay)
  }

  async function check(): Promise<void> {
    if (electron || disposed) return
    started = true
    if (pending) return pending
    clearRetry()
    const requestedRevision = revision
    const attempt = (async () => {
      checking.value = true
      error.value = ''
      try {
        const response = await clientAccessApi.session()
        if (disposed || requestedRevision !== revision) return
        if (typeof response.data?.authenticated !== 'boolean')
          throw new Error('服务端身份状态暂时不可用')
        session.value = response.data
        retryCount = 0
        window.dispatchEvent(
          new Event(response.data.authenticated ? 'infos:authorized' : 'infos:unauthorized'),
        )
      } catch (cause) {
        if (disposed || requestedRevision !== revision) return
        // 网络失败不代表授权失效，保留已确认身份和页面；只有服务端明确否认身份才退出。
        error.value = cause instanceof Error ? cause.message : '无法连接服务端'
        scheduleRetry()
      } finally {
        checking.value = false
        lastCheckedAt = Date.now()
      }
    })()
    pending = attempt
    try {
      await attempt
    } finally {
      if (pending === attempt) pending = undefined
    }
  }

  function handleUnauthorized(): void {
    revision++
    clearRetry()
    session.value = { authenticated: false, admin: false }
  }

  function checkOnResume(event: Event): void {
    if (!started || disposed || document.hidden || navigator.onLine === false) return
    // focus、pageshow 与 visibilitychange 常在同一时刻触发，合并身份探测。
    if (event.type !== 'online' && !error.value && Date.now() - lastCheckedAt < 5_000) return
    void check()
  }

  function dispose(): void {
    disposed = true
    revision++
    clearRetry()
    window.removeEventListener('infos:unauthorized', handleUnauthorized)
    window.removeEventListener('infos:session-check-requested', checkOnResume)
    window.removeEventListener('online', checkOnResume)
    window.removeEventListener('focus', checkOnResume)
    window.removeEventListener('pageshow', checkOnResume)
    document.removeEventListener('visibilitychange', checkOnResume)
  }

  if (typeof window !== 'undefined' && !electron) {
    window.addEventListener('infos:unauthorized', handleUnauthorized)
    window.addEventListener('infos:session-check-requested', checkOnResume)
    window.addEventListener('online', checkOnResume)
    window.addEventListener('focus', checkOnResume)
    window.addEventListener('pageshow', checkOnResume)
    document.addEventListener('visibilitychange', checkOnResume)
  }

  return { session, checking, error, check, dispose }
}

if (import.meta.hot) import.meta.hot.dispose(() => clientSession.dispose())

export function useClientSession() {
  return {
    ...clientSession,
    async logout() {
      await clientAccessApi.logout()
      clearWebClientCredential()
      // 授权和运行态一并退出；保留服务端数据，不残留前一身份的前端订阅。
      window.location.reload()
    },
  }
}
