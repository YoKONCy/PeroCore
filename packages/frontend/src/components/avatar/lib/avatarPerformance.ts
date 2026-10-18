export type AvatarQuality = 'economy' | 'balanced' | 'high'

export const AVATAR_QUALITY_STORAGE_KEY = 'infos.avatar.quality'

/** 待机保留自然动作，交互与口型同步使用更高帧率。 */
export const AVATAR_QUALITY = {
  economy: { idleFps: 20, activeFps: 30, pixelRatio: 1, shadowSize: 1024 },
  balanced: { idleFps: 30, activeFps: 60, pixelRatio: 1.5, shadowSize: 2048 },
  high: { idleFps: 60, activeFps: 60, pixelRatio: 2, shadowSize: 4096 },
} as const

export function readAvatarQuality(): AvatarQuality {
  try {
    const value = localStorage.getItem(AVATAR_QUALITY_STORAGE_KEY)
    if (value === 'economy' || value === 'balanced' || value === 'high') return value
  } catch {
    // 存储不可用时使用均衡档。
  }
  return 'balanced'
}

/** 使用单一帧回调控制更新预算，避免后台定时器的秒级节流拖慢可见桌宠。 */
export function createAvatarFrameLoop(
  render: (delta: number, now: number) => void,
  frameRate: () => number,
) {
  let running = false
  let frame: number | undefined
  let previous: number | undefined
  let deadline = 0
  let revision = 0

  function schedule(): void {
    const current = revision
    frame = requestAnimationFrame((now) => tick(now, current))
  }

  function tick(now: number, current: number): void {
    // 隐藏后快速恢复时，忽略已取消但可能仍排队的旧帧。
    if (!running || current !== revision) return
    frame = undefined
    if (now + 0.5 < deadline) {
      schedule()
      return
    }
    const delta = previous === undefined ? 0 : Math.min((now - previous) / 1000, 0.1)
    previous = now
    render(delta, now)
    const interval = 1000 / Math.max(1, frameRate())
    // 保留刷新相位，避免 240 Hz 屏幕上的取整误差把 60 帧降成不均匀的跳帧。
    deadline = deadline === 0 || now - deadline >= interval ? now + interval : deadline + interval
    if (running) schedule()
  }

  return {
    start() {
      if (running) return
      running = true
      revision++
      previous = undefined
      deadline = 0
      schedule()
    },
    stop() {
      running = false
      revision++
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
      previous = undefined
    },
  }
}
