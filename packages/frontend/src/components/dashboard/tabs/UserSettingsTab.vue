<script setup lang="ts">
import { t as __t } from '../../../i18n/index'

/**
 * UserSettingsTab — 系统设定 Tab (F1-3)
 *
 * 用户人设 (名称 + 人设描述)、外观 (主题/字体)、高级 (数据目录/日志)
 * F3: 已对接 configApi 读写。
 */
import { ref, computed, onMounted, watch } from 'vue'
import WeatherCard from '../../weather/WeatherCard.vue'
import DesktopControlSettings from '../../desktop/DesktopControlSettings.vue'
import CompletionAlertSettings from '../../notification/CompletionAlertSettings.vue'
import WholesomeModeSettings from '../WholesomeModeSettings.vue'
import { PixelIcon, PInput, PSelect, PSlider, PSwitch, PButton, PCard } from '../../pixel'
import { configApi } from '../../../api/modules/configApi'
import { useDashboardContext } from '../../../composables/dashboard'
import { useMainNav } from '../../../composables/main/useMainNav'
import {
  useSensoryPreferences,
  type MotionLevel,
} from '../../../composables/ui/useSensoryPreferences'
import { APP_BACKGROUND_PRESETS, useAppBackground } from '../../../composables/ui/useAppBackground'
import AppWallpaper from '../../layout/AppWallpaper.vue'
import { uiSound } from '../../../services/ui/uiSound'
import { logger } from '../../../lib/logger'
import { useNotificationStore } from '../../../stores'
import { appLocale, applyLanguage } from '../../../i18n'
import { LANGUAGE_OPTIONS, normalizeLocale } from '@infos/shared/i18n'
import { resolveSavedMotionLevel } from '../../../lib/sensorySettings'

const ctx = useDashboardContext()
const notif = useNotificationStore()

// ── 用户人设 ──
const ownerName = ref('主人')
const ownerPersona = ref('')
const language = ref<string>(appLocale.value)
watch(appLocale, (value, previous) => {
  if (language.value === previous) language.value = value
})

// ── 外观 ──
// 主题直接复用 app 侧边栏的 useMainNav 单例状态，不额外维护第二份偏好。
const mainNav = useMainNav()
/** PSelect 的字符串模型代理，直接读写唯一的 mainNav.theme 状态。 */
const themeBinding = computed({
  get: () => mainNav.theme.value,
  set: (value: string | number) => {
    if (value === 'light' || value === 'dark') mainNav.setTheme(value)
  },
})
const fontSize = ref(14)
const sensory = useSensoryPreferences()
const appBackground = useAppBackground()
const backgroundInput = ref<HTMLInputElement | null>(null)
const backgroundBusy = ref(false)
const backgroundSaving = ref(false)
const backgroundPreview = computed(() => appBackground.imageUrl.value)
const backgroundPreviewFailed = ref(false)
watch(backgroundPreview, () => {
  backgroundPreviewFailed.value = false
})
const backgroundFitOptions = [
  {
    get label() {
      return __t('ui.settings', '铺满窗口')
    },
    value: 'cover',
  },
  {
    get label() {
      return __t('ui.settings', '完整显示')
    },
    value: 'contain',
  },
]
const motionBinding = computed({
  get: () => sensory.motionLevel.value,
  set: (value: string | number) => {
    if (value === 'full' || value === 'reduced' || value === 'off')
      sensory.motionLevel.value = value
  },
})
const soundEffectsBinding = computed({
  get: () => sensory.soundEffects.value,
  set: (value: boolean) => {
    sensory.soundEffects.value = value
    if (value) void uiSound.play('action.confirmed')
  },
})

// ── 高级 ──
const dataDir = ref('~/.infos')
const logLevel = ref('info')
const autoSave = ref(true)
const isSaving = ref(false)
const backgroundLocked = computed(
  () =>
    !appBackground.loaded.value ||
    appBackground.busy.value ||
    backgroundBusy.value ||
    backgroundSaving.value ||
    isSaving.value,
)

const languageOptions = [...LANGUAGE_OPTIONS]

const themeOptions = [
  {
    get label() {
      return __t('ui.settings', '暗色模式')
    },
    value: 'dark',
  },
  {
    get label() {
      return __t('ui.settings', '亮色模式')
    },
    value: 'light',
  },
]

const motionOptions: Array<{ label: string; value: MotionLevel }> = [
  {
    get label() {
      return __t('ui.settings', '完整动效')
    },
    value: 'full',
  },
  {
    get label() {
      return __t('ui.settings', '轻量动效')
    },
    value: 'reduced',
  },
  {
    get label() {
      return __t('ui.settings', '关闭动效')
    },
    value: 'off',
  },
]

const logOptions = [
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
]

// ── 主题联动 ──
// mainNav.theme 是唯一主题状态；v-model 直接读写它，侧边栏与设定页天然同步。

/** 从后端加载配置 */
async function loadSettings() {
  try {
    const res = await configApi.batch([
      'owner.name',
      'owner.persona',
      'user.language',
      'ui.fontSize',
      'ui.motionLevel',
      'ui.animations',
      'ui.soundEffects',
      'system.dataDir',
      'system.logLevel',
      'system.autoSave',
    ])
    const d = res.data ?? {}
    if (d['owner.name']) ownerName.value = d['owner.name'] as string
    if (d['owner.persona']) ownerPersona.value = d['owner.persona'] as string
    if (d['user.language']) language.value = normalizeLocale(d['user.language'])
    if (d['ui.fontSize']) fontSize.value = Number(d['ui.fontSize'])
    sensory.motionLevel.value = resolveSavedMotionLevel(d['ui.motionLevel'], d['ui.animations'])
    if (d['ui.soundEffects'] === 'true' || d['ui.soundEffects'] === 'false')
      sensory.soundEffects.value = d['ui.soundEffects'] === 'true'
    if (d['system.dataDir']) dataDir.value = d['system.dataDir'] as string
    if (d['system.logLevel']) logLevel.value = d['system.logLevel'] as string
    if (d['system.autoSave'] !== undefined) autoSave.value = d['system.autoSave'] !== 'false'
  } catch {
    // 首次使用，保持默认值
  }
}

async function handleBackgroundFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || backgroundLocked.value || appBackground.selectedPreset.value === 'default') return
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    notif.toast(__t('ui.settings', '仅支持 PNG、JPEG 或 WebP 图片'), {
      type: 'warning',
      get title() {
        return __t('ui.settings', '应用背景')
      },
    })
    return
  }
  if (file.size > 15 * 1024 * 1024) {
    notif.toast(__t('ui.settings', '图片不能超过 15MB'), {
      type: 'warning',
      get title() {
        return __t('ui.settings', '应用背景')
      },
    })
    return
  }
  backgroundBusy.value = true
  try {
    await appBackground.upload(file)
    notif.toast(__t('ui.settings', '图片已保存到当前背景预设'), {
      type: 'success',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  } catch (error) {
    logger.error('UserSettings', __t('logs.frontend.settings', '背景上传失败'), error)
    notif.toast(__t('ui.settings', '背景上传失败'), {
      type: 'error',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  } finally {
    backgroundBusy.value = false
  }
}

async function saveBackgroundSettings(): Promise<void> {
  if (backgroundLocked.value) return
  backgroundSaving.value = true
  try {
    await appBackground.save()
    void uiSound.play('action.confirmed')
    notif.toast(__t('ui.settings', '当前背景预设已保存'), {
      type: 'success',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  } catch (error) {
    logger.error('UserSettings', __t('logs.frontend.settings', '背景设置保存失败'), error)
    notif.toast(__t('ui.settings', '背景设置保存失败'), {
      type: 'error',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  } finally {
    backgroundSaving.value = false
  }
}

async function removeBackground(): Promise<void> {
  if (backgroundLocked.value) return
  backgroundBusy.value = true
  try {
    await appBackground.remove()
  } catch (error) {
    logger.error('UserSettings', __t('logs.frontend.settings', '背景删除失败'), error)
    notif.toast(__t('ui.settings', '背景删除失败'), {
      type: 'error',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  } finally {
    backgroundBusy.value = false
  }
}

async function switchBackgroundPreset(id: string): Promise<void> {
  if (backgroundLocked.value || id === appBackground.selectedPreset.value) return
  try {
    await appBackground.selectPreset(id)
    void uiSound.play('action.confirmed')
  } catch (error) {
    logger.error('UserSettings', __t('logs.frontend.settings', '背景预设切换失败'), error)
    notif.toast(__t('ui.settings', '背景预设切换失败，当前调整已保留，请稍后重试'), {
      type: 'error',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  }
}

/** 保存配置到后端 */
async function handleSave() {
  isSaving.value = true
  try {
    const pairs: Array<[string, string]> = [
      ['owner.name', ownerName.value],
      ['owner.persona', ownerPersona.value],
      ['user.language', language.value],
      ['ui.theme', mainNav.theme.value],
      ['ui.fontSize', String(fontSize.value)],
      ['ui.motionLevel', sensory.motionLevel.value],
      ['ui.animations', String(sensory.motionLevel.value !== 'off')],
      ['ui.soundEffects', String(sensory.soundEffects.value)],
      ['system.logLevel', logLevel.value],
      ['system.autoSave', String(autoSave.value)],
    ]
    await Promise.all([...pairs.map(([k, v]) => configApi.set(k, v)), appBackground.save()])
    applyLanguage(language.value)
    void uiSound.play('action.confirmed')
    notif.toast(__t('ui.settings', '设置已保存'), {
      type: 'success',
      get title() {
        return __t('ui.settings', '系统设定')
      },
    })
  } catch (e) {
    logger.error('UserSettings', __t('logs.frontend.settings', '保存失败'), e)
    notif.toast(__t('ui.settings', '保存失败，请稍后重试'), {
      type: 'error',
      get title() {
        return __t('ui.settings', '系统设定')
      },
    })
  } finally {
    isSaving.value = false
  }
}

// 监听全局刷新
watch(
  () => ctx.refreshKey.value,
  () => loadSettings(),
)

onMounted(() => {
  void Promise.all([loadSettings(), appBackground.load()]).catch((error) => {
    logger.warn('UserSettings', __t('logs.frontend.settings', '应用背景配置加载失败'), error)
    notif.toast(__t('ui.settings', '背景配置加载失败，请稍后重试'), {
      type: 'warning',
      get title() {
        return __t('ui.settings', '外观设置')
      },
    })
  })
})
</script>

<template>
  <div class="user-settings-tab p-8 h-full overflow-y-auto settings-scrollbar">
    <div class="mb-6 flex-shrink-0 relative group/header">
      <!-- 背景氛围光晕 -->
      <div
        class="absolute -right-20 -top-10 w-40 h-40 bg-sky-400/5 blur-[60px] rounded-full pointer-events-none group-hover/header:bg-sky-400/15 transition-all duration-1000"
      />
      <h2
        class="flex items-center gap-3 text-2xl font-black text-[var(--ui-text-primary)] font-pixel"
      >
        <span
          class="group-hover/header:scale-110 group-hover/header:-rotate-6 transition-transform duration-500"
        >
          <PixelIcon name="settings" size="md" />
        </span>
        <span>{{ __t('ui.settings', '系统设定') }}</span>
        <span class="opacity-0 group-hover/header:opacity-100 transition-opacity duration-500">
          <PixelIcon name="paw" size="xs" />
        </span>
      </h2>
      <p
        class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1 ml-9 font-pixel"
      >
        SYSTEM SETTINGS
      </p>
    </div>

    <div class="flex flex-col gap-6 pr-1">
      <WholesomeModeSettings />
      <!-- 用户人设 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-[var(--ui-text-primary)] font-pixel mb-5 pb-3 border-b border-[var(--ui-border-subtle)]"
        >
          <PixelIcon name="user" size="sm" />
          {{ __t('ui.settings', '用户人设') }}
        </h3>
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-slate-500">
                {{ __t('ui.settings', '你的名字') }}
              </label>
              <PInput v-model="ownerName" :placeholder="__t('ui.settings', '你的名字')" />
              <p class="text-[10px] text-slate-400">
                {{ __t('ui.settings', '助手会记住你的名字') }}
              </p>
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-slate-500">
                {{ __t('ui.settings', '语言') }}
              </label>
              <PSelect v-model="language" :options="languageOptions" />
            </div>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">
              {{ __t('ui.settings', '人设描述') }}
            </label>
            <textarea
              v-model="ownerPersona"
              rows="5"
              class="w-full p-3 bg-[var(--dash-input-bg)] border-2 border-[var(--dash-input-border)] text-sm text-[var(--ui-text-secondary)] resize-y focus:border-[var(--ui-accent-sky)] focus:outline-none transition-colors"
              :placeholder="__t('ui.settings', '介绍你的称呼、兴趣和偏好…')"
            />
            <p class="text-[10px] text-slate-400">
              {{ __t('ui.settings', '助手会在对话中参考这些信息。') }}
            </p>
          </div>
        </div>
      </PCard>

      <!-- 默认城市与天气预览 -->
      <WeatherCard settings />
      <DesktopControlSettings />
      <CompletionAlertSettings />

      <!-- 外观设置 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-slate-800 font-pixel mb-5 pb-3 border-b border-slate-100"
        >
          <PixelIcon name="eye" size="sm" />
          {{ __t('ui.settings', '外观设置') }}
        </h3>
        <div class="flex flex-col gap-4">
          <!-- 主题：与 app 侧边栏深色/浅色按钮实时联动 -->
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">{{ __t('ui.settings', '主题') }}</label>
            <PSelect v-model="themeBinding" :options="themeOptions" />
            <p class="text-[10px] text-slate-400">
              {{ __t('ui.settings', '与侧边栏的深色/浅色切换按钮实时联动') }}
            </p>
          </div>

          <div
            class="app-background-settings flex flex-col gap-4 border-t border-[var(--ui-border-subtle)] pt-4"
          >
            <div class="app-background-heading flex items-center justify-between gap-4">
              <div>
                <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                  {{ __t('ui.settings', '应用背景') }}
                </label>
                <p class="text-[10px] text-[var(--ui-text-tertiary)]">
                  {{ __t('ui.settings', 'PNG / JPEG / WebP，最大 15MB') }}
                </p>
              </div>
              <div class="app-background-actions">
                <input
                  ref="backgroundInput"
                  class="hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  @change="handleBackgroundFile"
                />
                <PButton
                  v-if="appBackground.selectedPreset.value !== 'default'"
                  size="sm"
                  variant="primary"
                  :loading="backgroundSaving"
                  :disabled="backgroundLocked"
                  @click="saveBackgroundSettings"
                >
                  <PixelIcon name="save" size="xs" />
                  {{ __t('ui.settings', '保存预设') }}
                </PButton>
                <PButton
                  v-if="appBackground.selectedPreset.value !== 'default'"
                  size="sm"
                  variant="secondary"
                  :loading="backgroundBusy"
                  :disabled="backgroundLocked"
                  @click="backgroundInput?.click()"
                >
                  {{
                    appBackground.hasImage.value
                      ? __t('ui.settings', '更换图片')
                      : __t('ui.settings', '上传图片')
                  }}
                </PButton>
                <PButton
                  v-if="appBackground.hasImage.value"
                  size="sm"
                  variant="ghost"
                  :disabled="backgroundLocked"
                  @click="removeBackground"
                >
                  {{ __t('ui.settings', '删除图片') }}
                </PButton>
              </div>
            </div>
            <div
              class="app-background-slots"
              role="group"
              :aria-label="__t('ui.settings', '背景预设')"
            >
              <button
                type="button"
                class="app-background-slot"
                :aria-pressed="appBackground.selectedPreset.value === 'default'"
                :disabled="backgroundLocked"
                @click="switchBackgroundPreset('default')"
              >
                <strong>{{ __t('ui.settings', 'infOS 默认') }}</strong>
                <small>{{ __t('ui.settings', '使用默认页面材质') }}</small>
              </button>
              <button
                v-for="preset in appBackground.presets.value"
                :key="preset.id"
                type="button"
                class="app-background-slot"
                :aria-pressed="appBackground.selectedPreset.value === preset.id"
                :disabled="backgroundLocked"
                @click="switchBackgroundPreset(preset.id)"
              >
                <strong>{{ preset.label }}</strong>
                <small>
                  {{
                    preset.hasImage
                      ? __t('ui.settings', '已设置图片')
                      : __t('ui.settings', '可上传图片')
                  }}
                </small>
              </button>
            </div>
            <p class="text-[10px] text-[var(--ui-text-tertiary)]">
              {{ __t('ui.settings', '切换预设时自动保存当前调整。') }}
              <template v-if="appBackground.selectedPreset.value === 'default'">
                {{ __t('ui.settings', '选择预设 1、2 或 3 后即可上传图片。') }}
              </template>
            </p>
            <div
              v-if="backgroundPreview"
              class="app-background-preview"
              :data-app-background="
                appBackground.settings.value.enabled && !backgroundPreviewFailed
                  ? 'active'
                  : undefined
              "
              :style="appBackground.style.value"
            >
              <AppWallpaper
                v-if="appBackground.settings.value.enabled"
                :src="backgroundPreview"
                @ready="backgroundPreviewFailed = false"
                @error="backgroundPreviewFailed = true"
              />
              <div class="app-background-preview__window">
                <div class="app-background-preview__titlebar">
                  <span class="app-background-preview__tab">PeroperoChat</span>
                  <span aria-hidden="true">＋</span>
                </div>
                <aside class="app-background-preview__sidebar">
                  <span class="app-background-preview__avatar" />
                  <span class="app-background-preview__line is-short" />
                  <span class="app-background-preview__line" />
                  <span class="app-background-preview__line" />
                </aside>
                <div class="app-background-preview__conversation">
                  <div class="app-background-preview__header">
                    {{ __t('ui.settings', '应用背景实时预览') }}
                  </div>
                  <div class="app-background-preview__messages">
                    <div class="app-background-preview__bubble is-agent">
                      {{ __t('ui.settings', '背景连贯，文字清晰') }}
                    </div>
                    <div class="app-background-preview__bubble is-user">
                      {{ __t('ui.settings', '就这样，刚刚好') }}
                    </div>
                  </div>
                  <div class="app-background-preview__input">CHAR OPS...</div>
                </div>
              </div>
            </div>
            <p
              v-if="backgroundPreviewFailed"
              role="status"
              class="text-xs text-[var(--ui-text-secondary)]"
            >
              {{ __t('ui.settings', '背景暂时无法读取，请更换图片') }}
            </p>
            <div
              v-if="appBackground.hasImage.value"
              class="flex flex-col gap-4"
              :inert="backgroundLocked"
            >
              <label
                class="flex items-center justify-between text-xs font-bold text-[var(--ui-text-secondary)]"
              >
                {{ __t('ui.settings', '启用背景') }}
                <PSwitch v-model="appBackground.settings.value.enabled" />
              </label>
              <div
                class="app-background-presets"
                role="group"
                :aria-label="__t('ui.settings', '背景材质')"
              >
                <span>{{ __t('ui.settings', '材质') }}</span>
                <PButton
                  v-for="preset in APP_BACKGROUND_PRESETS"
                  :key="preset.id"
                  size="sm"
                  :variant="
                    appBackground.activePreset.value === preset.id ? 'primary' : 'secondary'
                  "
                  :aria-pressed="appBackground.activePreset.value === preset.id"
                  @click="appBackground.applyPreset(preset.id)"
                >
                  {{ preset.label }}
                </PButton>
              </div>
              <details class="app-background-details">
                <summary>{{ __t('ui.settings', '细调背景') }}</summary>
                <div class="app-background-controls">
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片可见度') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.opacity"
                      :min="0.1"
                      :max="1"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片模糊') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.blur"
                      :min="0"
                      :max="32"
                      :step="1"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片亮度') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.brightness"
                      :min="0.6"
                      :max="1.4"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片饱和度') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.saturation"
                      :min="0"
                      :max="1.6"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片对比度') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.contrast"
                      :min="0.6"
                      :max="1.4"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '主题遮罩') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.overlayOpacity"
                      :min="0"
                      :max="0.85"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '面板不透明度') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.surfaceOpacity"
                      :min="0.55"
                      :max="1"
                      :step="0.05"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '面板毛玻璃') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.surfaceBlur"
                      :min="0"
                      :max="24"
                      :step="1"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '图片填充') }}
                    </label>
                    <PSelect
                      v-model="appBackground.settings.value.fit"
                      :options="backgroundFitOptions"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '水平位置') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.positionX"
                      :min="0"
                      :max="100"
                      :step="1"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                      {{ __t('ui.settings', '垂直位置') }}
                    </label>
                    <PSlider
                      v-model="appBackground.settings.value.positionY"
                      :min="0"
                      :max="100"
                      :step="1"
                    />
                  </div>
                </div>
              </details>
            </div>
          </div>

          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5 opacity-50 pointer-events-none">
              <label class="text-xs font-bold text-slate-500">
                {{ __t('ui.settings', '字体大小 (') }}{{ fontSize }}px)
              </label>
              <PSlider v-model="fontSize" :min="12" :max="20" :step="1" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                {{ __t('ui.settings', '动态效果') }}
              </label>
              <PSelect v-model="motionBinding" :options="motionOptions" />
              <p class="text-[10px] text-[var(--ui-text-tertiary)]">
                {{ __t('ui.settings', '选择界面动效强度') }}
              </p>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <label class="text-xs font-bold text-[var(--ui-text-secondary)]">
                  {{ __t('ui.settings', '关键事件音效') }}
                </label>
                <p class="text-[10px] text-[var(--ui-text-tertiary)]">
                  {{ __t('ui.settings', '任务完成、失败、审批和重要确认使用客户端合成音') }}
                </p>
              </div>
              <PSwitch v-model="soundEffectsBinding" />
            </div>
          </div>
        </div>
      </PCard>

      <!-- 高级设置 -->
      <PCard pixel padding="lg" overflow-visible>
        <h3
          class="flex items-center gap-2 text-sm font-black text-slate-800 font-pixel mb-5 pb-3 border-b border-slate-100"
        >
          <PixelIcon name="settings" size="sm" />
          {{ __t('ui.settings', '高级') }}
        </h3>
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">
              {{ __t('ui.settings', '数据目录') }}
            </label>
            <PInput v-model="dataDir" disabled />
            <p class="text-[10px] text-slate-400">{{ __t('ui.settings', '重启后生效') }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-bold text-slate-500">
              {{ __t('ui.settings', '日志级别') }}
            </label>
            <PSelect v-model="logLevel" :options="logOptions" />
          </div>
          <div class="flex items-center justify-between">
            <div class="flex flex-col gap-0.5">
              <label class="text-xs font-bold text-slate-500">
                {{ __t('ui.settings', '自动保存') }}
              </label>
              <p class="text-[10px] text-slate-400">
                {{ __t('ui.settings', '每次修改后自动保存配置') }}
              </p>
            </div>
            <PSwitch v-model="autoSave" />
          </div>
        </div>
      </PCard>

      <div class="pt-2 flex justify-end">
        <PButton
          variant="primary"
          :loading="isSaving"
          :disabled="backgroundLocked"
          @click="handleSave"
        >
          {{ __t('ui.settings', '保存设置') }}
        </PButton>
      </div>
    </div>
  </div>
</template>

<style scoped src="./userSettingsTab.css"></style>
