/**
 * useSensoryPreferences — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
import { ref, watch } from 'vue'
import { resolveSavedMotionLevel, type MotionLevel } from '../../lib/sensorySettings'

export type { MotionLevel } from '../../lib/sensorySettings'

const MOTION_KEY = 'infos.ui.motionLevel'
const SOUND_KEY = 'infos.ui.soundEffects'
const SOUND_VOLUME_KEY = 'infos.ui.soundVolume'

function initialMotionLevel(): MotionLevel {
  return resolveSavedMotionLevel(localStorage.getItem(MOTION_KEY), undefined)
}

function initialBoolean(key: string, fallback: boolean): boolean {
  const saved = localStorage.getItem(key)
  return saved === null ? fallback : saved === 'true'
}

const motionLevel = ref<MotionLevel>(initialMotionLevel())
const soundEffects = ref(initialBoolean(SOUND_KEY, true))
const soundVolume = ref(
  Math.min(1, Math.max(0, Number(localStorage.getItem(SOUND_VOLUME_KEY) ?? 0.45))),
)

function applyMotionLevel(level: MotionLevel): void {
  document.documentElement.dataset.motion = level
}

applyMotionLevel(motionLevel.value)

watch(motionLevel, (value) => {
  localStorage.setItem(MOTION_KEY, value)
  applyMotionLevel(value)
})
watch(soundEffects, (value) => localStorage.setItem(SOUND_KEY, String(value)))
watch(soundVolume, (value) => localStorage.setItem(SOUND_VOLUME_KEY, String(value)))

export function useSensoryPreferences() {
  return {
    motionLevel,
    soundEffects,
    soundVolume,
  }
}
