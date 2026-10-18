import { describe, expect, it } from 'vitest'
import {
  guideBounds,
  snapCanvasMove,
  snapCanvasResize,
  type GuideRect,
} from '../client/src/services/canvasGuides'

const rect = (id: string, x: number, y: number, width = 100, height = 100): GuideRect => ({
  id,
  x,
  y,
  width,
  height,
})

describe('画布自动标尺', () => {
  it('吸附边缘与中心，并使用不同的参考线', () => {
    const edge = snapCanvasMove(rect('拖动', 104, 200, 50, 50), [rect('参考', 0, 0)], 1)
    expect(edge.dx).toBe(-4)
    expect(edge.guides.some((guide) => guide.kind === 'edge')).toBe(true)
    const center = snapCanvasMove(rect('拖动', 74, 300, 50, 50), [rect('参考', 0, 0, 200)], 1)
    expect(center.dx).toBe(1)
    expect(center.guides.some((guide) => guide.kind === 'center')).toBe(true)
  })

  it('支持居中等间距与延续已有间距', () => {
    const between = snapCanvasMove(
      rect('拖动', 248, 0),
      [rect('左侧', 0, 0), rect('右侧', 500, 0)],
      1,
    )
    expect(between.dx).toBe(2)
    expect(
      between.guides
        .filter((guide) => guide.kind === 'spacing' && guide.axis === 'x')
        .map((guide) => guide.label),
    ).toEqual(['150', '150'])
    const extended = snapCanvasMove(
      rect('拖动', 398, 0),
      [rect('第一项', 0, 0), rect('第二项', 200, 0)],
      1,
    )
    expect(extended.dx).toBe(2)
    expect(
      extended.guides
        .filter((guide) => guide.kind === 'spacing' && guide.axis === 'x')
        .map((guide) => guide.label),
    ).toEqual(['100', '100'])
  })

  it('缩放后吸附阈值保持六个屏幕像素', () => {
    const moving = rect('拖动', 107, 200, 50, 50),
      fixed = [rect('参考', 0, 0)]
    expect(snapCanvasMove(moving, fixed, 1).dx).toBe(0)
    expect(snapCanvasMove(moving, fixed, 0.5).dx).toBe(-7)
  })

  it('多选整体保持包围盒，网格对齐支持负坐标', () => {
    const bounds = guideBounds([rect('第一项', -101, -49), rect('第二项', 99, -49)])
    expect(bounds.width).toBe(300)
    const snapped = snapCanvasMove(bounds, [], 1, true)
    expect(snapped.dx).toBe(5)
    expect(snapped.dy).toBe(1)
    expect(snapped.guides.every((guide) => guide.kind === 'grid')).toBe(true)
  })

  it('缩放卡片时显示尺寸，并吸附到相同宽高', () => {
    const resized = snapCanvasResize(
      rect('拖动', 0, 0, 197, 102),
      [rect('参考', 500, 500, 200, 100)],
      1,
    )
    expect([resized.width, resized.height]).toEqual([200, 100])
    expect(
      resized.guides.filter((guide) => guide.kind === 'size').map((guide) => guide.label),
    ).toEqual(['200', '100'])
  })
})
