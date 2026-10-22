/** 开屏只接收显示状态与有限操作，不开放主应用的通用 IPC。 */
export type StartupPhase = 'opening' | 'backend' | 'launcher' | 'ready' | 'failed'
export type StartupFailureKind = 'backend' | 'launcher' | 'shell'
export type StartupSplashAction = 'retry' | 'logs' | 'quit'

export interface StartupSplashState {
  revision: number
  phase: StartupPhase
  language: string
  labels: {
    loading: string
    title: string
    message: string
    retry: string
    logs: string
    quit: string
    close: string
  }
}
