// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmbeddedSurfaceMotion } from './surfaceMotion'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('子应用呈现动效', () => {
  it('渲染暂停且没有完成事件时也会自动释放动效', () => {
    vi.useFakeTimers()
    const animation = { cancel: vi.fn(), onfinish: null }
    const old = Object.getOwnPropertyDescriptor(document.body, 'animate')
    const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => animation)
    Object.defineProperty(document.body, 'animate', { configurable: true, value: animate })
    const motion = createEmbeddedSurfaceMotion()
    try {
      motion.enter('full')
      expect(animate.mock.calls[0]?.[1]).toMatchObject({ fill: 'none' })
      vi.advanceTimersByTime(380)
      expect(animation.cancel).toHaveBeenCalledOnce()
    } finally {
      motion.cancel()
      if (old) Object.defineProperty(document.body, 'animate', old)
      else Reflect.deleteProperty(document.body, 'animate')
    }
  })

  it('只操作自己的淡入动画，连续激活会取消旧动画，关闭动效后不再播放', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const old = Object.getOwnPropertyDescriptor(document.body, 'animate')
    const animations: Array<{ cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }> =
      []
    const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
      const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null }
      animations.push(animation)
      return animation
    })
    Object.defineProperty(document.body, 'animate', { configurable: true, value: animate })
    const motion = createEmbeddedSurfaceMotion()
    try {
      motion.enter('full')
      expect(animate.mock.calls[0]?.[1].duration).toBe(300)
      motion.enter('reduced')
      expect(animations[0]?.cancel).toHaveBeenCalled()
      expect(animate.mock.calls[1]?.[1].duration).toBe(100)
      animations[0]?.onfinish?.()
      expect(animations[1]?.cancel).not.toHaveBeenCalled()
      motion.enter('off')
      expect(animations[1]?.cancel).toHaveBeenCalled()
      expect(animate).toHaveBeenCalledTimes(2)
    } finally {
      motion.cancel()
      if (old) Object.defineProperty(document.body, 'animate', old)
      else Reflect.deleteProperty(document.body, 'animate')
    }
  })
})
