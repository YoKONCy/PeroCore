import type { MemoryBackgroundPolicy } from '@infos/shared'

/** 关闭时中止在途任务；重新开启使用新信号，旧任务不能因开关恢复而继续写入。 */
export class MemoryBackgroundControl implements MemoryBackgroundPolicy {
  private active = true
  private controller = new AbortController()

  get enabled(): boolean {
    return this.active
  }
  get signal(): AbortSignal {
    return this.controller.signal
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.active) return
    this.active = enabled
    if (enabled) this.controller = new AbortController()
    else this.controller.abort(new Error('长记忆后台任务已关闭'))
  }
}
