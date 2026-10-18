import { app } from 'electron'

/** 改名的开发版 EXE 也会被 Electron 判为已打包，须同时识别默认应用加载器。 */
export const isPackagedRuntime = app.isPackaged && process.defaultApp !== true
export const isDevelopmentRuntime = !isPackagedRuntime
