import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: any[]) => ipcRenderer.send(channel, ...args),
  getBackendConnectionConfigSync: () => ipcRenderer.sendSync('get_backend_connection_config_sync'),
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  loadPeroModel: (buffer: Uint8Array, filterPatterns?: string[]) =>
    ipcRenderer.invoke('native-load-pero-model', buffer, filterPatterns),
  loadStandardModel: (buffer: Uint8Array, filterPatterns?: string[]) =>
    ipcRenderer.invoke('native-load-standard-model', buffer, filterPatterns),
  loadPeroContainer: (buffer: Uint8Array) =>
    ipcRenderer.invoke('native-load-pero-container', buffer),
  scanLocalModels: () => ipcRenderer.invoke('scan-local-models')
})
