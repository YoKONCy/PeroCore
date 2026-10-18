import { setTimeout as delay } from 'node:timers/promises'

/** 只等待短暂输入结束；明确暂停、锁屏和取消由调用者逐次检查。 */
export async function waitForDesktopIdle(
  idleMilliseconds: () => number,
  assertAvailable: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + 2_000
  for (;;) {
    signal?.throwIfAborted()
    assertAvailable()
    if (idleMilliseconds() >= 600) return
    if (Date.now() >= deadline)
      throw new Error(
        'DESKTOP_USER_BUSY: 用户仍在操作电脑，本次动作尚未发送。可继续文件、终端或内置浏览器工作；不要反复抢占桌面，需要时请等待用户空闲后重新观察。',
      )
    await delay(Math.min(100, deadline - Date.now()), undefined, { signal })
  }
}
