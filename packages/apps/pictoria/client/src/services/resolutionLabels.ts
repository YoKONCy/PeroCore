const ratios = [
  [1, 1],
  [4, 3],
  [3, 4],
  [16, 9],
  [9, 16],
  [3, 2],
  [2, 3],
  [21, 9],
  [9, 21],
  [4, 5],
  [5, 4],
  [2, 1],
  [1, 2],
] as const
/** 模型尺寸常按像素块取整，接近常用比例时明确标为近似值。 */
export function resolutionRatio(value: string, aspectRatio?: string): string | undefined {
  const match = /^(\d{2,5})\s*[*x×]\s*(\d{2,5})$/i.exec(value)
  if (match) {
    const width = Number(match[1]),
      height = Number(match[2])
    if (!width || !height) return undefined
    const ratio = width / height
    const closest = [...ratios].sort(
      (a, b) => Math.abs(a[0] / a[1] - ratio) - Math.abs(b[0] / b[1] - ratio),
    )[0]!
    if (Math.abs(closest[0] / closest[1] / ratio - 1) < 0.015)
      return `${width * closest[1] === height * closest[0] ? '' : '≈'}${closest[0]}:${closest[1]}`
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
    const divisor = gcd(width, height)
    return `${width / divisor}:${height / divisor}`
  }
  if (/^[124]k$/i.test(value)) {
    if (aspectRatio === 'auto') return '自动比例'
    if (aspectRatio && /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspectRatio)) return aspectRatio
  }
  return undefined
}
