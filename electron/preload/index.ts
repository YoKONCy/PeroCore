/**
 * @file Electron Preload 脚本
 * @description 通过 contextBridge 向渲染进程安全暴露最小化的 IPC 接口
 *              遵循 07_DUAL_DEPLOYMENT.md — contextIsolation: true
 *
 *              暴露的 API 挂载在 window.electron 上:
 *              - invoke(channel, ...args)  → 请求/响应式
 *              - send(channel, ...args)    → 单向消息
 *              - on(channel, listener)     → 监听主进程推送，返回注销函数
 *
 * @platform ELECTRON
 * @module electron/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electron', {
  /**
   * 调用主进程 (请求/响应式 IPC)
   * 对应 ipcMain.handle()
   */
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

  /**
   * 向主进程发送单向消息 (fire-and-forget)
   * 对应 ipcMain.on()
   */
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),

  /**
   * 监听主进程推送的事件
   * 返回注销函数，调用即可取消监听
   */
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    // 包装 listener，去掉 Electron event 对象，只传 payload
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args)
    ipcRenderer.on(channel, wrapped)
    // 返回注销函数
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
})
