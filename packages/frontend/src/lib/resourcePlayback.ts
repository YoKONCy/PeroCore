/** 小窗、放大预览和滚动回收共用近期播放位置，不写入会话或持久存储。 */
const positions = new Map<string, number>()

export function mediaPosition(source: string): number {
  return positions.get(source) ?? 0
}

export function rememberMediaPosition(source: string, position: number): void {
  if (!source || !Number.isFinite(position)) return
  positions.delete(source)
  positions.set(source, Math.max(0, position))
  if (positions.size > 32) positions.delete(positions.keys().next().value!)
}

export function restoreMediaPosition(element: HTMLMediaElement | null, source: string): void {
  if (element && Number.isFinite(element.duration))
    element.currentTime = Math.min(mediaPosition(source), Math.max(0, element.duration - 0.1))
}

export function trackMediaPosition(element: HTMLMediaElement | null, source: string): void {
  if (element && element.readyState >= 1)
    rememberMediaPosition(source, element.ended ? 0 : element.currentTime)
}
