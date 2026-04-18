import { getRuntimeBackendConnectionConfig } from '@/config'

export type RuntimeHost = 'electron-local' | 'electron-remote' | 'web'

export type RuntimeEventTransport = 'electron-ipc' | 'browser-local'

export type RuntimeCapabilities = {
  host: RuntimeHost
  eventTransport: RuntimeEventTransport
  backendLogHistory: boolean
  backendLogStream: boolean
  localServiceControl: boolean
  nativeWindowControl: boolean
}

export const getRuntimeHost = (): RuntimeHost => {
  if (typeof window === 'undefined' || !(window as any).electron) {
    return 'web'
  }

  return getRuntimeBackendConnectionConfig().mode === 'remote'
    ? 'electron-remote'
    : 'electron-local'
}

export const getRuntimeCapabilities = (): RuntimeCapabilities => {
  const host = getRuntimeHost()

  if (host === 'electron-local') {
    return {
      host,
      eventTransport: 'electron-ipc',
      backendLogHistory: true,
      backendLogStream: true,
      localServiceControl: true,
      nativeWindowControl: true
    }
  }

  if (host === 'electron-remote') {
    return {
      host,
      eventTransport: 'electron-ipc',
      backendLogHistory: false,
      backendLogStream: false,
      localServiceControl: false,
      nativeWindowControl: true
    }
  }

  return {
    host,
    eventTransport: 'browser-local',
    backendLogHistory: false,
    backendLogStream: false,
    localServiceControl: false,
    nativeWindowControl: false
  }
}
