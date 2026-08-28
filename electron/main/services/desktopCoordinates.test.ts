import { describe, expect, it } from 'vitest'
import {
  getPhysicalDisplayBounds,
  resolveDesktopPoint,
  type DesktopDisplayGeometry,
} from './desktopCoordinates'

const primary: DesktopDisplayGeometry = {
  id: '1',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  scaleFactor: 1,
}

const identity = (point: { x: number; y: number }) => point

describe('desktopCoordinates', () => {
  it('应把0到1000归一化坐标映射到1920x1080桌面', () => {
    expect(resolveDesktopPoint({ x: 500, y: 500 }, primary, identity)).toEqual({ x: 960, y: 540 })
    expect(resolveDesktopPoint({ x: 1000, y: 1000 }, primary, identity)).toEqual({
      x: 1919,
      y: 1079,
    })
  })

  it('应把1280x720截图坐标映射到2560x1440桌面', () => {
    const display = {
      ...primary,
      bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    }
    expect(
      resolveDesktopPoint(
        {
          x: 1279,
          y: 719,
          coordinateSpace: 'screenshot',
          screenshotWidth: 1280,
          screenshotHeight: 720,
        },
        display,
        identity,
      ),
    ).toEqual({ x: 2559, y: 1439 })
  })

  it.each([1.25, 1.5, 2])('应使用Electron DIP转换适配%倍DPI', (scaleFactor) => {
    const display = { ...primary, scaleFactor }
    const convert = (point: { x: number; y: number }) => ({
      x: point.x * scaleFactor,
      y: point.y * scaleFactor,
    })
    expect(resolveDesktopPoint({ x: 1000, y: 1000 }, display, convert)).toEqual({
      x: Math.round(1919 * scaleFactor),
      y: Math.round(1079 * scaleFactor),
    })
  })

  it('应支持位于主屏左侧的负原点显示器', () => {
    const display = {
      id: '2',
      bounds: { x: -1280, y: 0, width: 1280, height: 1024 },
      scaleFactor: 1,
    }
    expect(resolveDesktopPoint({ x: 0, y: 0 }, display, identity)).toEqual({
      x: -1280,
      y: 0,
    })
    expect(resolveDesktopPoint({ x: 1000, y: 1000 }, display, identity)).toEqual({
      x: -1,
      y: 1023,
    })
  })

  it('应计算显示器物理边界', () => {
    expect(
      getPhysicalDisplayBounds(primary, (point) => ({ x: point.x * 1.5, y: point.y * 1.5 })),
    ).toEqual({ x: 0, y: 0, width: 2880, height: 1620 })
  })

  it('应拒绝越界、缺失与非法坐标上下文', () => {
    expect(() => resolveDesktopPoint({ x: 1001, y: 0 }, primary, identity)).toThrow(
      'DESKTOP_COORDINATE_OUT_OF_RANGE',
    )
    expect(() => resolveDesktopPoint({ x: undefined, y: 0 }, primary, identity)).toThrow(
      'DESKTOP_COORDINATE_INVALID',
    )
    expect(() =>
      resolveDesktopPoint({ x: 1, y: 1, coordinateSpace: 'screenshot' }, primary, identity),
    ).toThrow('DESKTOP_COORDINATE_INVALID')
    expect(() =>
      resolveDesktopPoint(
        {
          x: 1,
          y: 1,
          coordinateSpace: 'screenshot',
          screenshotWidth: 0,
          screenshotHeight: 720,
        },
        primary,
        identity,
      ),
    ).toThrow('DESKTOP_SCREENSHOT_CONTEXT_INVALID')
  })
})
