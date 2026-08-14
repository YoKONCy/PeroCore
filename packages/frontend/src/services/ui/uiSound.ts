import { useSensoryPreferences } from '../../composables/ui/useSensoryPreferences'

export type UiSound = 'task.complete' | 'task.failed' | 'approval.required' | 'action.confirmed'

interface Tone {
  frequency: number
  offset: number
  duration: number
  gain: number
  type?: OscillatorType
}

const PATTERNS: Record<UiSound, Tone[]> = {
  'task.complete': [
    { frequency: 880, offset: 0, duration: 0.075, gain: 0.14, type: 'sine' },
    { frequency: 1320, offset: 0.065, duration: 0.16, gain: 0.11, type: 'sine' },
  ],
  'task.failed': [
    { frequency: 260, offset: 0, duration: 0.1, gain: 0.11, type: 'triangle' },
    { frequency: 190, offset: 0.09, duration: 0.15, gain: 0.09, type: 'triangle' },
  ],
  'approval.required': [
    { frequency: 660, offset: 0, duration: 0.07, gain: 0.09, type: 'sine' },
    { frequency: 880, offset: 0.11, duration: 0.1, gain: 0.08, type: 'sine' },
  ],
  'action.confirmed': [{ frequency: 1046, offset: 0, duration: 0.09, gain: 0.08, type: 'sine' }],
}

class UiSoundService {
  private context: AudioContext | null = null
  private lastPlayed = new Map<UiSound, number>()

  async play(name: UiSound): Promise<void> {
    const preferences = useSensoryPreferences()
    if (!preferences.soundEffects.value || preferences.soundVolume.value <= 0) return
    const now = performance.now()
    if (now - (this.lastPlayed.get(name) ?? 0) < 250) return
    this.lastPlayed.set(name, now)

    try {
      const context = this.getContext()
      if (context.state === 'suspended') await context.resume()
      const start = context.currentTime + 0.008
      for (const tone of PATTERNS[name])
        this.scheduleTone(context, start, tone, preferences.soundVolume.value)
    } catch {
      // 浏览器尚未获得音频播放权限时保持静默，首次用户交互后会自然恢复。
    }
  }

  unlock(): void {
    try {
      const context = this.getContext()
      if (context.state === 'suspended') void context.resume()
    } catch {
      // 不支持 Web Audio API 时保持静默。
    }
  }

  private getContext(): AudioContext {
    if (!this.context) this.context = new AudioContext({ latencyHint: 'interactive' })
    return this.context
  }

  private scheduleTone(context: AudioContext, start: number, tone: Tone, volume: number): void {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const toneStart = start + tone.offset
    const toneEnd = toneStart + tone.duration
    oscillator.type = tone.type ?? 'sine'
    oscillator.frequency.setValueAtTime(tone.frequency, toneStart)
    gain.gain.setValueAtTime(0.0001, toneStart)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain * volume), toneStart + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(toneStart)
    oscillator.stop(toneEnd + 0.01)
  }
}

export const uiSound = new UiSoundService()
