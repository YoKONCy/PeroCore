// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createAvatarFrameLoop } from '../../src/components/avatar/lib/avatarPerformance'
import { disposeAvatarResources } from '../../src/components/avatar/lib/disposeAvatarResources'

let callbacks: Map<number, FrameRequestCallback>
let nextFrame: number

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  callbacks = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function frameAt(time: number): void {
  vi.advanceTimersByTime(time - performance.now())
  const current = [...callbacks.values()]
  callbacks.clear()
  for (const callback of current) callback(performance.now())
}

describe('桌宠帧预算', () => {
  it('240 Hz 刷新时，实际模型更新仍受 60 帧预算约束', () => {
    const render = vi.fn()
    const loop = createAvatarFrameLoop(render, () => 60)
    loop.start()
    for (let frame = 0; frame <= 240; frame++) frameAt((frame * 1000) / 240)
    loop.stop()
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(58)
    expect(render.mock.calls.length).toBeLessThanOrEqual(61)
  })

  it('隐藏后取消所有调度，恢复时不会把隐藏时间灌入动画', () => {
    const render = vi.fn()
    const loop = createAvatarFrameLoop(render, () => 30)
    loop.start()
    frameAt(0)
    loop.stop()
    expect(callbacks.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(render).toHaveBeenCalledTimes(1)
    loop.start()
    frameAt(60_000)
    expect(render.mock.calls.at(-1)?.[0]).toBe(0)
    loop.stop()
  })

  it('待机切换为交互帧率时不创建第二条循环', () => {
    const render = vi.fn()
    let fps = 30
    const loop = createAvatarFrameLoop(render, () => fps)
    loop.start()
    loop.start()
    for (let frame = 0; frame <= 120; frame++) frameAt((frame * 1000) / 240)
    const idleFrames = render.mock.calls.length
    fps = 60
    for (let frame = 121; frame <= 240; frame++) frameAt((frame * 1000) / 240)
    const activeFrames = render.mock.calls.length - idleFrames
    loop.stop()
    expect(idleFrames).toBeLessThanOrEqual(16)
    expect(activeFrames).toBeGreaterThan(24)
    expect(activeFrames).toBeLessThanOrEqual(31)
  })

  it('可见动画不使用容易被后台策略压到每秒一次的定时器', () => {
    const render = vi.fn()
    const loop = createAvatarFrameLoop(render, () => 30)
    loop.start()
    for (let frame = 0; frame <= 60; frame++) {
      frameAt((frame * 1000) / 60)
      expect(vi.getTimerCount()).toBe(0)
      expect(callbacks.size).toBe(1)
    }
    loop.stop()
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(29)
    expect(render.mock.calls.length).toBeLessThanOrEqual(31)
  })

  it('快速隐藏并恢复时，迟到的旧帧不能创建额外的渲染循环', () => {
    const render = vi.fn()
    const loop = createAvatarFrameLoop(render, () => 60)
    loop.start()
    const staleFrame = [...callbacks.values()][0]!
    loop.stop()
    loop.start()
    staleFrame(0)
    expect(render).not.toHaveBeenCalled()
    expect(callbacks.size).toBe(1)
    frameAt(0)
    expect(render).toHaveBeenCalledTimes(1)
    expect(callbacks.size).toBe(1)
    loop.stop()
  })
})

describe('桌宠资源回收', () => {
  it('多个网格共享的几何、材质和纹理只释放一次，并解除场景引用', () => {
    const scene = new THREE.Scene()
    const model = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const texture = new THREE.Texture()
    const material = new THREE.MeshStandardMaterial({ map: texture })
    model.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, [material]))
    scene.add(model)
    const freeGeometry = vi.spyOn(geometry, 'dispose')
    const freeMaterial = vi.spyOn(material, 'dispose')
    const freeTexture = vi.spyOn(texture, 'dispose')
    disposeAvatarResources(model)
    expect(freeGeometry).toHaveBeenCalledTimes(1)
    expect(freeMaterial).toHaveBeenCalledTimes(1)
    expect(freeTexture).toHaveBeenCalledTimes(1)
    expect(scene.children).toHaveLength(0)
    expect(model.children).toHaveLength(0)
  })
})
