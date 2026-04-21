/**
 * @file 全局应用事件总线
 * @description 用于协调 Electron 主进程中各服务之间的通信
 *              例如: 后端崩溃 → 连锁停止 Gateway / NapCat
 * @module electron/main/events
 */

import { EventEmitter } from 'node:events'

/** 全局事件总线，仅在主进程中使用 */
export const appEvents = new EventEmitter()
