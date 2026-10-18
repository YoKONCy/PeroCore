/// <reference lib="dom" />
/** 原生子视图在自己的渲染层淡入，不截图、不移动窗口边界，也不访问业务状态。 */
export function createEmbeddedSurfaceMotion() {
  let animation: Animation | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const cancel = () => {
    clearTimeout(deadline)
    deadline = undefined
    animation?.cancel()
    animation = undefined
  }
  function enter(value: unknown): void {
    cancel()
    const root = document.getElementById('app') ?? document.body
    const local = document.documentElement.dataset.motion
    if (!root || value === 'off' || local === 'off' || typeof root.animate !== 'function') return
    const reduced =
      value === 'reduced' ||
      local === 'reduced' ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    const duration = reduced ? 100 : 300
    const current = root.animate([{ opacity: reduced ? 0.85 : 0.65 }, { opacity: 1 }], {
      duration,
      easing: 'cubic-bezier(.16, 1, .3, 1)',
      fill: 'none',
    })
    animation = current
    current.onfinish = () => {
      if (animation === current) cancel()
    }
    // 原生标签切换可能暂停渲染；即使收不到完成事件，也必须释放透明度效果。
    deadline = setTimeout(() => {
      if (animation === current) cancel()
    }, duration + 80)
  }
  return { enter, cancel }
}
