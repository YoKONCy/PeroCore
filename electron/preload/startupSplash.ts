import { contextBridge, ipcRenderer } from 'electron'
import type { StartupSplashAction, StartupSplashState } from '../shared/startupSplash'

// 开屏没有后端凭据、文件访问或任意频道调用能力。
contextBridge.exposeInMainWorld('startupSplash', {
  getState: (): Promise<StartupSplashState> => ipcRenderer.invoke('startup-splash:state'),
  onState: (listener: (state: StartupSplashState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: StartupSplashState) =>
      listener(state)
    ipcRenderer.on('startup-splash:changed', wrapped)
    return () => ipcRenderer.off('startup-splash:changed', wrapped)
  },
  painted: () => ipcRenderer.send('startup-splash:painted'),
  failed: () => ipcRenderer.send('startup-splash:render-failed'),
  action: (action: StartupSplashAction) => {
    if (action === 'retry' || action === 'logs' || action === 'quit')
      ipcRenderer.send('startup-splash:action', action)
  },
})
