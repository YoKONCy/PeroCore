/**
 * @file 全局快捷键
 * @description 注册/注销全局快捷键
 * @platform ELECTRON
 * @module electron/main/services/shortcuts
 */

import { petControls } from './petControls'

/** 主进程统一持有桌宠快捷键与全局按住说话生命周期。 */
export async function registerShortcuts(): Promise<void> {
  await petControls.start()
}

/** 注销所有全局快捷键 */
export function unregisterShortcuts(): void {
  petControls.stop()
}
