import { reactive } from 'vue'
import { API_BASE, getRuntimeBackendConnectionConfig } from '@/config'

type AuthSource = 'none' | 'session' | 'local' | 'window' | 'electron' | 'vite'

type HealthResponse = {
  desktop_auth_required?: boolean
  desktop_auth_header?: string
  desktop_auth_query?: string
  desktop_auth_cookie?: string
}

type AuthStatusResponse = HealthResponse & {
  authorized?: boolean
}

type ValidateOptions = {
  remember?: boolean
  source?: AuthSource
}

const SESSION_STORAGE_KEY = 'perocore.desktop_api_key.session'
const LOCAL_STORAGE_KEY = 'perocore.desktop_api_key.local'

export const desktopAuthState = reactive({
  bootstrapped: false,
  required: false,
  authorized: false,
  validating: false,
  headerName: 'x-pero-desktop-api-key',
  cookieName: 'pero_desktop_auth',
  queryName: 'api_key',
  apiKey: '',
  error: '',
  source: 'none' as AuthSource
})

let rawFetch: typeof window.fetch | null = null
let fetchInterceptorInstalled = false
let bootstrapPromise: Promise<typeof desktopAuthState> | null = null

const normalizeApiKey = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const getFetchImpl = (): typeof window.fetch => {
  if (!rawFetch) {
    rawFetch = window.fetch.bind(window)
  }
  return rawFetch
}

const clearStoredApiKey = (): void => {
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {}

  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY)
  } catch {}
}

const persistApiKey = (apiKey: string, remember: boolean): void => {
  clearStoredApiKey()
  if (!apiKey) {
    return
  }

  try {
    if (remember) {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, apiKey)
    } else {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, apiKey)
    }
  } catch {}
}

const resolveStoredApiKey = (): { apiKey: string; source: AuthSource } => {
  try {
    const sessionApiKey = normalizeApiKey(window.sessionStorage.getItem(SESSION_STORAGE_KEY))
    if (sessionApiKey) {
      return { apiKey: sessionApiKey, source: 'session' }
    }
  } catch {}

  try {
    const localApiKey = normalizeApiKey(window.localStorage.getItem(LOCAL_STORAGE_KEY))
    if (localApiKey) {
      return { apiKey: localApiKey, source: 'local' }
    }
  } catch {}

  const electronApiKey = normalizeApiKey(getRuntimeBackendConnectionConfig().apiKey || '')
  if (electronApiKey) {
    return { apiKey: electronApiKey, source: 'electron' }
  }

  const windowApiKey = normalizeApiKey((window as any).__PERO_DESKTOP_API_KEY__)
  if (windowApiKey) {
    return { apiKey: windowApiKey, source: 'window' }
  }

  const viteApiKey = normalizeApiKey((import.meta as any).env?.VITE_PERO_DESKTOP_API_KEY)
  if (viteApiKey) {
    return { apiKey: viteApiKey, source: 'vite' }
  }

  return { apiKey: '', source: 'none' }
}

const applyHealthResponse = (payload: HealthResponse | null | undefined): void => {
  desktopAuthState.required = payload?.desktop_auth_required === true
  desktopAuthState.headerName = payload?.desktop_auth_header || 'x-pero-desktop-api-key'
  desktopAuthState.cookieName = payload?.desktop_auth_cookie || 'pero_desktop_auth'
  desktopAuthState.queryName = payload?.desktop_auth_query || 'api_key'
}

const readJsonSafe = async (response: Response): Promise<any> => {
  try {
    return await response.json()
  } catch {
    return null
  }
}

const resolveUrl = (input: RequestInfo | URL): URL => {
  if (input instanceof Request) {
    return new URL(input.url, window.location.origin)
  }
  return new URL(String(input), window.location.origin)
}

const isApiRequest = (url: URL): boolean => {
  const apiBase = String(API_BASE || '')
  if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
    return url.href.startsWith(apiBase)
  }
  if (apiBase.startsWith('/')) {
    return url.pathname.startsWith(apiBase)
  }
  return url.pathname.startsWith('/api/')
}

const markUnauthorized = (message = '访问密钥无效或已失效，请重新输入'): void => {
  desktopAuthState.apiKey = ''

  if (desktopAuthState.source === 'session' || desktopAuthState.source === 'local') {
    clearStoredApiKey()
    desktopAuthState.source = 'none'
  }

  desktopAuthState.authorized = false
  desktopAuthState.error = message
}

export const installDesktopAuthFetchInterceptor = (): void => {
  if (fetchInterceptorInstalled || typeof window === 'undefined') {
    return
  }

  const baseFetch = getFetchImpl()
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = resolveUrl(input)
    const shouldAttach = isApiRequest(url)

    if (!shouldAttach) {
      return baseFetch(input, init)
    }

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
    if (
      desktopAuthState.apiKey &&
      !headers.has(desktopAuthState.headerName) &&
      !headers.has('authorization')
    ) {
      headers.set(desktopAuthState.headerName, desktopAuthState.apiKey)
    }

    let response: Response
    if (input instanceof Request) {
      response = await baseFetch(new Request(input, { ...init, headers }))
    } else {
      response = await baseFetch(input, { ...init, headers })
    }
 
    if ((response.status === 401 || response.status === 403) && desktopAuthState.required) {
      markUnauthorized()
    }

    return response
  }

  fetchInterceptorInstalled = true
}

export const buildAuthenticatedWebSocketUrl = (url: string): string => {
  if (!desktopAuthState.required || !desktopAuthState.apiKey) {
    return url
  }

  const resolved = new URL(url, window.location.origin)
  resolved.searchParams.set(desktopAuthState.queryName, desktopAuthState.apiKey)
  return resolved.toString()
}

export const validateDesktopAuthKey = async (
  apiKey: string,
  options: ValidateOptions = {}
): Promise<boolean> => {
  const normalized = normalizeApiKey(apiKey)
  if (!normalized) {
    desktopAuthState.error = '请输入访问密钥'
    desktopAuthState.authorized = false
    return false
  }

  desktopAuthState.validating = true
  desktopAuthState.error = ''

  try {
    const response = await getFetchImpl()(`${String(API_BASE)}/system/auth/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ api_key: normalized })
    })

    const payload = await readJsonSafe(response)
    if (!response.ok) {
      throw new Error(payload?.detail || '访问密钥无效')
    }

    applyHealthResponse(payload)
    desktopAuthState.apiKey = normalized
    desktopAuthState.source = options.source || (options.remember ? 'local' : 'session')
    desktopAuthState.authorized = true
    desktopAuthState.bootstrapped = true

    if (desktopAuthState.source === 'local' || desktopAuthState.source === 'session') {
      persistApiKey(normalized, options.remember === true)
    }

    return true
  } catch (error: any) {
    if (options.source === 'local' || options.source === 'session') {
      clearStoredApiKey()
    }

    desktopAuthState.apiKey = ''
    desktopAuthState.authorized = false
    desktopAuthState.error = error?.message || '访问密钥无效'
    if (options.source === 'local' || options.source === 'session') {
      desktopAuthState.source = 'none'
    }
    return false
  } finally {
    desktopAuthState.validating = false
  }
}

export const bootstrapDesktopAuth = async () => {
  if (typeof window === 'undefined') {
    return desktopAuthState
  }

  if (bootstrapPromise) {
    return bootstrapPromise
  }

  installDesktopAuthFetchInterceptor()

  bootstrapPromise = (async () => {
    desktopAuthState.validating = true
    desktopAuthState.error = ''

    try {
      const response = await getFetchImpl()(`${String(API_BASE)}/system/health`)
      const payload = await readJsonSafe(response)
      applyHealthResponse(payload)

      if (!desktopAuthState.required) {
        desktopAuthState.authorized = true
        return desktopAuthState
      }

      const statusResponse = await getFetchImpl()(`${String(API_BASE)}/system/auth/status`)
      const statusPayload = (await readJsonSafe(statusResponse)) as AuthStatusResponse | null
      applyHealthResponse(statusPayload)
      if (statusPayload?.authorized) {
        desktopAuthState.authorized = true
        return desktopAuthState
      }

      const existing = resolveStoredApiKey()
      if (!existing.apiKey) {
        desktopAuthState.authorized = false
        return desktopAuthState
      }

      desktopAuthState.apiKey = existing.apiKey
      desktopAuthState.source = existing.source
      await validateDesktopAuthKey(existing.apiKey, {
        remember: existing.source === 'local',
        source: existing.source
      })
    } catch (error: any) {
      desktopAuthState.authorized = false
      desktopAuthState.error = error?.message || '无法获取后端鉴权状态'
    } finally {
      desktopAuthState.bootstrapped = true
      desktopAuthState.validating = false
    }

    return desktopAuthState
  })()

  return bootstrapPromise
}

export const clearDesktopAuth = (): void => {
  clearStoredApiKey()
  desktopAuthState.apiKey = ''
  desktopAuthState.authorized = !desktopAuthState.required
  desktopAuthState.error = ''
  desktopAuthState.source = 'none'
}
