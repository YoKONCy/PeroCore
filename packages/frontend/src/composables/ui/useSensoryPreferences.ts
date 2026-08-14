import { ref, watch } from 'vue'

export type MotionLevel = 'full' | 'reduced' | 'off'

const MOTION_KEY = 'infos.ui.motionLevel'
const SOUND_KEY = 'infos.ui.soundEffects'
const SOUND_VOLUME_KEY = 'infos.ui.soundVolume'

function initialMotionLevel(): MotionLevel {
  const saved = localStorage.getItem(MOTION_KEY)
  if (saved === 'full' || saved === 'reduced' || saved === 'off') return saved
  // 首次默认完整动效，用户可在设置中手动调整
  return 'full'
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
