/** 应用共用一张背景；预览与整窗使用相同的图片参数和材质参数。 */
import { computed, ref } from 'vue'
import { configApi } from '../../api/modules/configApi'
import { systemApi, type AppBackgroundSettings } from '../../api/modules/systemApi'

export const DEFAULT_APP_BACKGROUND: AppBackgroundSettings = {
  enabled: false,
  opacity: 0.95,
  blur: 0,
  brightness: 1,
  saturation: 1,
  contrast: 1,
  overlayOpacity: 0.18,
  surfaceOpacity: 0.8,
  surfaceBlur: 14,
  positionX: 50,
  positionY: 50,
  fit: 'cover',
}

export const APP_BACKGROUND_PRESETS = [
  {
    id: 'clear',
    label: '通透',
    opacity: 0.95,
    blur: 0,
    overlayOpacity: 0.08,
    surfaceOpacity: 0.68,
    surfaceBlur: 12,
  },
  {
    id: 'balanced',
    label: '均衡',
    opacity: 0.95,
    blur: 0,
    overlayOpacity: 0.18,
    surfaceOpacity: 0.8,
    surfaceBlur: 14,
  },
  {
    id: 'focus',
    label: '专注',
    opacity: 0.75,
    blur: 5,
    overlayOpacity: 0.38,
    surfaceOpacity: 0.94,
    surfaceBlur: 12,
  },
] as const

const settings = ref<AppBackgroundSettings>({ ...DEFAULT_APP_BACKGROUND })
const hasImage = ref(false)
const imageVersion = ref(Date.now())
const loaded = ref(false)
let loading: Promise<void> | null = null

function normalize(raw: unknown): AppBackgroundSettings {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const number = (key: keyof AppBackgroundSettings, min: number, max: number): number => {
    const candidate = value[key]
    return typeof candidate === 'number' && Number.isFinite(candidate)
      ? Math.min(max, Math.max(min, candidate))
      : (DEFAULT_APP_BACKGROUND[key] as number)
  }
  return {
    enabled: value.enabled === true,
    opacity: number('opacity', 0, 1),
    blur: number('blur', 0, 32),
    brightness: number('brightness', 0.6, 1.4),
    saturation: number('saturation', 0, 1.6),
    contrast: number('contrast', 0.6, 1.4),
    overlayOpacity: number('overlayOpacity', 0, 0.85),
    surfaceOpacity: number('surfaceOpacity', 0.55, 1),
    surfaceBlur: number('surfaceBlur', 0, 24),
    positionX: number('positionX', 0, 100),
    positionY: number('positionY', 0, 100),
    fit: value.fit === 'contain' ? 'contain' : 'cover',
  }
}

export function useAppBackground() {
  const imageUrl = computed(() =>
    hasImage.value ? systemApi.appBackgroundContentUrl(imageVersion.value) : '',
  )
  const style = computed(() => {
    const value = normalize(settings.value)
    const readingOpacity = Math.max(0.9, value.surfaceOpacity)
    return {
      '--app-image-opacity': String(value.opacity),
      '--app-image-blur': `${value.blur}px`,
      '--app-image-brightness': String(value.brightness),
      '--app-image-saturation': String(value.saturation),
      '--app-image-contrast': String(value.contrast),
      '--app-image-overlay': String(value.overlayOpacity),
      '--app-image-position': `${value.positionX}% ${value.positionY}%`,
      '--app-image-fit': value.fit,
      '--app-shell-opacity': String(Math.max(0.5, value.surfaceOpacity - 0.15)),
      '--app-panel-opacity': String(value.surfaceOpacity),
      '--app-reading-opacity': String(readingOpacity),
      // 工作区已有整块面板底色，正文只补足可读度，避免多层不透明度叠加。
      '--app-inset-reading-opacity': String(
        Math.max(
          0.12,
          (readingOpacity - value.surfaceOpacity) / Math.max(0.01, 1 - value.surfaceOpacity),
        ),
      ),
      '--app-material-blur': `${value.surfaceBlur}px`,
    }
  })
  const activePreset = computed(
    () =>
      APP_BACKGROUND_PRESETS.find(
        (preset) =>
          (['opacity', 'blur', 'overlayOpacity', 'surfaceOpacity', 'surfaceBlur'] as const).every(
            (key) => Math.abs(settings.value[key] - preset[key]) < 0.001,
          ) &&
          settings.value.brightness === 1 &&
          settings.value.saturation === 1 &&
          settings.value.contrast === 1,
      )?.id,
  )

  function applyPreset(id: string): void {
    const preset = APP_BACKGROUND_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const { id: _id, label: _label, ...values } = preset
    Object.assign(settings.value, values, { brightness: 1, saturation: 1, contrast: 1 })
  }

  async function load(): Promise<void> {
    if (loaded.value) return
    if (loading) return loading
    // 保留旧配置键；设置页反复打开时不覆盖尚未保存的实时调整。
    loading = (async () => {
      const response = await configApi.batch([
        'ui.chatBackground.settings',
        'ui.chatBackground.mime',
      ])
      const values = response.data ?? {}
      const raw = values['ui.chatBackground.settings']
      try {
        settings.value = normalize(typeof raw === 'string' && raw ? JSON.parse(raw) : {})
      } catch {
        settings.value = { ...DEFAULT_APP_BACKGROUND }
      }
      hasImage.value =
        typeof values['ui.chatBackground.mime'] === 'string' && !!values['ui.chatBackground.mime']
      loaded.value = true
    })()
    try {
      await loading
    } finally {
      loading = null
    }
  }

  async function save(): Promise<void> {
    await load()
    await configApi.set('ui.chatBackground.settings', JSON.stringify(normalize(settings.value)))
  }

  async function upload(blob: Blob): Promise<void> {
    await load()
    await systemApi.uploadAppBackground(blob)
    hasImage.value = true
    settings.value.enabled = true
    imageVersion.value = Math.max(Date.now(), imageVersion.value + 1)
    await save()
  }

  async function remove(): Promise<void> {
    await load()
    await systemApi.deleteAppBackground()
    hasImage.value = false
    settings.value.enabled = false
    imageVersion.value = Math.max(Date.now(), imageVersion.value + 1)
    await save()
  }

  return {
    settings,
    hasImage,
    imageUrl,
    loaded,
    style,
    activePreset,
    applyPreset,
    load,
    save,
    upload,
    remove,
  }
}
