export type MotionLevel = 'full' | 'reduced' | 'off'

/** 未设置的配置可能为 null；只有明确的旧版布尔值才能覆盖默认动效。 */
export function resolveSavedMotionLevel(saved: unknown, legacy: unknown): MotionLevel {
  if (saved === 'full' || saved === 'reduced' || saved === 'off') return saved
  if (legacy === 'true') return 'full'
  if (legacy === 'false') return 'off'
  return 'full'
}
