export const AGENT_NAME: string = 'Peropero'
export const AGENT_AVATAR_TEXT: string = 'P'
export const APP_TITLE: string = '萌动链接：PeroperoChat！'

type RuntimeBackendConnectionConfig = {
  mode: 'local' | 'remote'
  baseUrl: string
  apiBase: string
  wsBase: string
  configured: boolean
  apiKey?: string
}

const createDynamicString = (resolver: () => string): string =>
  ({
    toString: resolver,
    valueOf: resolver,
    [Symbol.toPrimitive]: resolver
  }) as unknown as string

const getBrowserConnectionConfig = (): RuntimeBackendConnectionConfig => {
  if (typeof window === 'undefined') {
    return {
      mode: 'local',
      baseUrl: '',
      apiBase: '',
      wsBase: '',
      configured: false,
      apiKey: ''
    }
  }

  const origin = `${window.location.protocol}//${window.location.host}`
  return {
    mode: 'local',
    baseUrl: origin,
    apiBase: '/api',
    wsBase: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`,
    configured: true,
    apiKey: ''
  }
}

export const getRuntimeBackendConnectionConfig = (): RuntimeBackendConnectionConfig => {
  if (typeof window === 'undefined') {
    return getBrowserConnectionConfig()
  }

  const electronBridge = (window as any).electron
  if (electronBridge?.getBackendConnectionConfigSync) {
    try {
      return electronBridge.getBackendConnectionConfigSync()
    } catch {
      return getBrowserConnectionConfig()
    }
  }

  return getBrowserConnectionConfig()
}

export const API_BASE: string = createDynamicString(
  () => getRuntimeBackendConnectionConfig().apiBase
)

export const WS_BASE: string = createDynamicString(
  () => getRuntimeBackendConnectionConfig().wsBase
)

export const BASE_URL: string = createDynamicString(
  () => getRuntimeBackendConnectionConfig().baseUrl
)
