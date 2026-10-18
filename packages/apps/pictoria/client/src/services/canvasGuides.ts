export interface GuideRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}
export interface CanvasGuide {
  kind: 'edge' | 'center' | 'spacing' | 'distance' | 'size' | 'grid'
  axis: 'x' | 'y'
  x1: number
  y1: number
  x2: number
  y2: number
  label?: string
}
interface Candidate {
  delta: number
  guides?: CanvasGuide[]
}
const end = (rect: GuideRect, axis: 'x' | 'y') =>
  rect[axis] + rect[axis === 'x' ? 'width' : 'height']
const middle = (rect: GuideRect, axis: 'x' | 'y') => (rect[axis] + end(rect, axis)) / 2
const anchors = (rect: GuideRect, axis: 'x' | 'y') => [
  rect[axis],
  middle(rect, axis),
  end(rect, axis),
]
const cross = (axis: 'x' | 'y') => (axis === 'x' ? 'y' : 'x')
const overlaps = (left: GuideRect, right: GuideRect, axis: 'x' | 'y') =>
  left[axis] < end(right, axis) && right[axis] < end(left, axis)

export function guideBounds(rects: GuideRect[]): GuideRect {
  const x = Math.min(...rects.map((rect) => rect.x)),
    y = Math.min(...rects.map((rect) => rect.y))
  return {
    id: '',
    x,
    y,
    width: Math.max(...rects.map((rect) => end(rect, 'x'))) - x,
    height: Math.max(...rects.map((rect) => end(rect, 'y'))) - y,
  }
}

function measure(
  axis: 'x' | 'y',
  start: number,
  finish: number,
  at: number,
  kind: 'spacing' | 'distance' | 'size',
): CanvasGuide {
  return {
    kind,
    axis,
    x1: axis === 'x' ? start : at,
    y1: axis === 'x' ? at : start,
    x2: axis === 'x' ? finish : at,
    y2: axis === 'x' ? at : finish,
    label: `${Math.round(Math.abs(finish - start))}`,
  }
}

function nearest(candidates: Candidate[], tolerance: number): Candidate | undefined {
  return candidates
    .filter((value) => Math.abs(value.delta) <= tolerance)
    .sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0]
}

/** 为同一行或列计算等间距：夹在两项之间，以及延续相邻项的间隔。 */
function spacingCandidates(moving: GuideRect, fixed: GuideRect[], axis: 'x' | 'y'): Candidate[] {
  const orthogonal = cross(axis),
    extent = moving[axis === 'x' ? 'width' : 'height']
  const peers = fixed
    .filter((rect) => overlaps(moving, rect, orthogonal))
    .sort((a, b) => a[axis] - b[axis])
  const candidates: Candidate[] = [],
    at = middle(moving, orthogonal)
  const before = peers.filter((rect) => end(rect, axis) <= middle(moving, axis)).at(-1)
  const after = peers.find((rect) => rect[axis] >= middle(moving, axis))
  if (before && after && after[axis] - end(before, axis) >= extent) {
    const gap = (after[axis] - end(before, axis) - extent) / 2,
      start = end(before, axis) + gap
    candidates.push({
      delta: start - moving[axis],
      guides: [
        measure(axis, end(before, axis), start, at, 'spacing'),
        measure(axis, start + extent, after[axis], at, 'spacing'),
      ],
    })
  }
  for (let index = 1; index < peers.length; index++) {
    const left = peers[index - 1]!,
      right = peers[index]!,
      gap = right[axis] - end(left, axis)
    if (gap < 0 || !overlaps(left, right, orthogonal)) continue
    const reference = measure(axis, end(left, axis), right[axis], at, 'spacing')
    const next = end(right, axis) + gap,
      previous = left[axis] - gap - extent
    candidates.push({
      delta: next - moving[axis],
      guides: [reference, measure(axis, end(right, axis), next, at, 'spacing')],
    })
    candidates.push({
      delta: previous - moving[axis],
      guides: [reference, measure(axis, previous + extent, left[axis], at, 'spacing')],
    })
  }
  return candidates
}

function alignmentGuides(
  moving: GuideRect,
  fixed: GuideRect[],
  axis: 'x' | 'y',
  scale: number,
): CanvasGuide[] {
  const orthogonal = cross(axis),
    result: CanvasGuide[] = []
  for (const rect of fixed) {
    for (const [index, value] of anchors(moving, axis).entries()) {
      for (const [otherIndex, other] of anchors(rect, axis).entries()) {
        if (Math.abs(value - other) > 0.5 / scale) continue
        const start = Math.min(moving[orthogonal], rect[orthogonal]) - 12 / scale
        const finish = Math.max(end(moving, orthogonal), end(rect, orthogonal)) + 12 / scale
        result.push({
          kind: index === 1 || otherIndex === 1 ? 'center' : 'edge',
          axis,
          x1: axis === 'x' ? value : start,
          y1: axis === 'x' ? start : value,
          x2: axis === 'x' ? value : finish,
          y2: axis === 'x' ? finish : value,
        })
      }
    }
  }
  return result.slice(0, 12)
}

/** 阈值使用屏幕像素，缩放后仍保持一致的吸附手感；多选按整体包围盒移动。 */
export function snapCanvasMove(moving: GuideRect, fixed: GuideRect[], scale: number, grid = false) {
  const result = { ...moving },
    guides: CanvasGuide[] = []
  for (const axis of ['x', 'y'] as const) {
    const candidates = fixed.flatMap((rect) =>
      anchors(rect, axis).flatMap((value) =>
        anchors(result, axis).map((anchor) => ({ delta: value - anchor })),
      ),
    )
    const alignment = nearest(candidates, 6 / scale)
    const spacing = nearest(spacingCandidates(result, fixed, axis), 6 / scale)
    const selected =
      alignment && (!spacing || Math.abs(alignment.delta) <= Math.abs(spacing.delta))
        ? alignment
        : spacing
    if (selected) {
      result[axis] += selected.delta
      guides.push(...(selected.guides || []))
    } else if (grid) {
      result[axis] = Math.round(result[axis] / 24) * 24
      const orthogonal = cross(axis)
      guides.push({
        kind: 'grid',
        axis,
        x1: axis === 'x' ? result.x : result.x - 16 / scale,
        y1: axis === 'x' ? result.y - 16 / scale : result.y,
        x2: axis === 'x' ? result.x : end(result, orthogonal) + 16 / scale,
        y2: axis === 'x' ? end(result, orthogonal) + 16 / scale : result.y,
      })
    }
  }
  for (const axis of ['x', 'y'] as const) {
    guides.push(...alignmentGuides(result, fixed, axis, scale))
    const orthogonal = cross(axis),
      peers = fixed.filter((rect) => overlaps(result, rect, orthogonal))
    const before = peers
      .filter((rect) => end(rect, axis) <= result[axis])
      .sort((a, b) => end(b, axis) - end(a, axis))[0]
    const after = peers
      .filter((rect) => rect[axis] >= end(result, axis))
      .sort((a, b) => a[axis] - b[axis])[0]
    // 等间距已标注时不重复绘制普通距离。
    if (!guides.some((guide) => guide.kind === 'spacing' && guide.axis === axis)) {
      const at = middle(result, orthogonal)
      if (before) guides.push(measure(axis, end(before, axis), result[axis], at, 'distance'))
      if (after) guides.push(measure(axis, end(result, axis), after[axis], at, 'distance'))
    }
  }
  return { dx: result.x - moving.x, dy: result.y - moving.y, guides }
}

/** 缩放卡片时同时支持边界对齐与同宽、同高标尺。 */
export function snapCanvasResize(moving: GuideRect, fixed: GuideRect[], scale: number) {
  const result = { ...moving },
    guides: CanvasGuide[] = []
  for (const axis of ['x', 'y'] as const) {
    const dimension = axis === 'x' ? 'width' : 'height',
      minimum = axis === 'x' ? 160 : 100
    const candidates: Candidate[] = fixed.flatMap((rect) => [
      ...anchors(rect, axis).map((value) => ({ delta: value - end(result, axis) })),
      { delta: rect[dimension] - result[dimension] },
    ])
    const selected = nearest(
      candidates.filter(
        (value) =>
          result[dimension] + value.delta >= minimum && result[dimension] + value.delta <= 1600,
      ),
      6 / scale,
    )
    if (selected) result[dimension] += selected.delta
    guides.push(...alignmentGuides(result, fixed, axis, scale))
    guides.push(
      measure(axis, result[axis], end(result, axis), end(result, cross(axis)) + 18 / scale, 'size'),
    )
  }
  return { width: result.width, height: result.height, guides }
}
