export type DesktopCoordinateSpace = 'normalized' | 'screenshot' | 'desktop'

export interface DesktopRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopDisplayGeometry {
  id: string
  bounds: DesktopRect
  scaleFactor: number
}

export interface DesktopPointInput {
  x: unknown
  y: unknown
  coordinateSpace?: unknown
  screenshotWidth?: unknown
  screenshotHeight?: unknown
}

export interface DesktopPoint {
  x: number
  y: number
}

export type DipToScreenPoint = (point: DesktopPoint) => DesktopPoint

function requireFinite(value: unknown, name: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`DESKTOP_COORDINATE_INVALID: ${name}必须是有限数字`)
  }
  return number
}

function requireRange(value: number, min: number, max: number, name: string): void {
  if (value < min || value > max) {
    throw new Error(`DESKTOP_COORDINATE_OUT_OF_RANGE: ${name}必须在${min}到${max}之间`)
  }
}

export function getPhysicalDisplayBounds(
  display: DesktopDisplayGeometry,
  dipToScreenPoint: DipToScreenPoint,
): DesktopRect {
  const topLeft = dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
  const bottomRight = dipToScreenPoint({
    x: display.bounds.x + display.bounds.width,
    y: display.bounds.y + display.bounds.height,
  })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

export function resolveDesktopPoint(
  input: DesktopPointInput,
  display: DesktopDisplayGeometry,
  dipToScreenPoint: DipToScreenPoint,
): DesktopPoint {
  const x = requireFinite(input.x, 'x')
  const y = requireFinite(input.y, 'y')
  const coordinateSpace = String(input.coordinateSpace ?? 'normalized') as DesktopCoordinateSpace

  if (!['normalized', 'screenshot', 'desktop'].includes(coordinateSpace)) {
    throw new Error(`DESKTOP_COORDINATE_SPACE_INVALID: ${coordinateSpace}`)
  }

  if (coordinateSpace === 'desktop') {
    const physicalBounds = getPhysicalDisplayBounds(display, dipToScreenPoint)
    requireRange(x, physicalBounds.x, physicalBounds.x + physicalBounds.width - 1, 'x')
    requireRange(y, physicalBounds.y, physicalBounds.y + physicalBounds.height - 1, 'y')
    return { x: Math.round(x), y: Math.round(y) }
  }

  let ratioX: number
  let ratioY: number
  if (coordinateSpace === 'normalized') {
    requireRange(x, 0, 1000, 'x')
    requireRange(y, 0, 1000, 'y')
    ratioX = x / 1000
    ratioY = y / 1000
  } else {
    const screenshotWidth = requireFinite(input.screenshotWidth, 'screenshotWidth')
    const screenshotHeight = requireFinite(input.screenshotHeight, 'screenshotHeight')
    if (screenshotWidth <= 0 || screenshotHeight <= 0) {
      throw new Error('DESKTOP_SCREENSHOT_CONTEXT_INVALID: 截图宽高必须大于0')
    }
    requireRange(x, 0, screenshotWidth - 1, 'x')
    requireRange(y, 0, screenshotHeight - 1, 'y')
    ratioX = screenshotWidth === 1 ? 0 : x / (screenshotWidth - 1)
    ratioY = screenshotHeight === 1 ? 0 : y / (screenshotHeight - 1)
  }

  const dipPoint = {
    x: display.bounds.x + ratioX * Math.max(0, display.bounds.width - 1),
    y: display.bounds.y + ratioY * Math.max(0, display.bounds.height - 1),
  }
  const point = dipToScreenPoint(dipPoint)
  return { x: Math.round(point.x), y: Math.round(point.y) }
}
