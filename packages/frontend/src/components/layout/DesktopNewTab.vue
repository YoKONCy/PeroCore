<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { nextTick, onMounted, ref, watch } from 'vue'
import type { DesktopApplication } from '@infos/shared'
import { PixelIcon } from '../pixel'
import WeatherCard from '../weather/WeatherCard.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    applications: DesktopApplication[]
    busy: boolean
    focusRequest: number
  }>(),
  { modelValue: '' },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  browse: [value: string]
  application: [id: string]
  section: [id: string]
}>()
const input = ref<HTMLInputElement | null>(null)
const shortcuts = [
  {
    id: 'chat',
    get title() {
      return __t('ui.layout', '与助手聊聊')
    },
    detail: '回到日常对话',
    icon: 'chat',
  },
  {
    id: 'workspace',
    get title() {
      return __t('ui.layout', '工作区')
    },
    detail: '文件、终端与轻量任务',
    icon: 'code',
  },
  {
    id: 'tasks',
    get title() {
      return __t('ui.layout', '任务中心')
    },
    detail: '查看正在进行的工作',
    icon: 'list',
  },
]
async function focusAddress(): Promise<void> {
  await nextTick()
  input.value?.focus()
}
onMounted(focusAddress)
watch(() => props.focusRequest, focusAddress)
</script>

<template>
  <section class="desktop-new-page" :aria-label="__t('ui.layout', '新标签页')">
    <div class="desktop-new-content">
      <div class="desktop-new-brand">
        <PixelIcon name="sparkle" size="lg" />
        <span class="font-pixel">{{ __t('ui.layout', '新的灵感，从这里开始') }}</span>
      </div>
      <h1>{{ __t('ui.layout', '打开网页，或继续手边的工作') }}</h1>
      <form class="desktop-new-search" @submit.prevent="emit('browse', modelValue)">
        <PixelIcon name="search" size="md" />
        <input
          ref="input"
          :value="modelValue"
          :disabled="busy"
          :aria-label="__t('ui.layout', '输入网址或搜索内容')"
          :placeholder="__t('ui.layout', '输入网址或搜索内容…')"
          autocomplete="off"
          spellcheck="false"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <button
          type="submit"
          :disabled="busy || !modelValue.trim()"
          :aria-label="__t('ui.layout', '打开网页或搜索')"
        >
          <PixelIcon
            :name="busy ? 'refresh' : 'chevron-right'"
            size="sm"
            :animation="busy ? 'spin' : ''"
          />
        </button>
      </form>
      <div class="desktop-new-hint">
        <span>
          <kbd>Ctrl + T</kbd>
          {{ __t('ui.layout', '新建') }}
        </span>
        <span>
          <kbd>Ctrl + Tab</kbd>
          {{ __t('ui.layout', '切换') }}
        </span>
        <span>
          <kbd>Ctrl + W</kbd>
          {{ __t('ui.layout', '关闭') }}
        </span>
      </div>
      <div class="desktop-weather"><WeatherCard /></div>

      <div class="desktop-launch-group">
        <h2>{{ __t('ui.layout', '迷你游戏') }}</h2>
        <div class="desktop-launch-grid">
          <button
            class="desktop-launch-card"
            type="button"
            :disabled="busy"
            @click="emit('application', 'infos.tarot')"
          >
            <span class="desktop-launch-icon"><PixelIcon name="star" size="lg" /></span>
            <span>
              <strong>{{ __t('ui.layout', '塔罗牌') }}</strong>
              <small>{{ __t('ui.layout', '来试试今天的运势吧！') }}</small>
            </span>
            <PixelIcon name="chevron-right" size="xs" />
          </button>
        </div>
      </div>

      <div v-if="applications.length" class="desktop-launch-group">
        <h2>{{ __t('ui.layout', '应用') }}</h2>
        <div class="desktop-launch-grid">
          <button
            v-for="application in applications"
            :key="application.id"
            class="desktop-launch-card"
            type="button"
            :disabled="busy"
            @click="emit('application', application.id)"
          >
            <span class="desktop-launch-icon">
              <PixelIcon :name="application.icon" size="lg" />
            </span>
            <span>
              <strong>{{ application.title }}</strong>
              <small>{{ application.description }}</small>
            </span>
            <PixelIcon name="chevron-right" size="xs" />
          </button>
        </div>
      </div>
      <div class="desktop-launch-group">
        <h2>{{ __t('ui.layout', '继续工作') }}</h2>
        <div class="desktop-launch-grid">
          <button
            v-for="shortcut in shortcuts"
            :key="shortcut.id"
            class="desktop-launch-card desktop-shortcut"
            type="button"
            @click="emit('section', shortcut.id)"
          >
            <span class="desktop-launch-icon"><PixelIcon :name="shortcut.icon" size="md" /></span>
            <span>
              <strong>{{ shortcut.title }}</strong>
              <small>{{ shortcut.detail }}</small>
            </span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.desktop-new-page {
  --new-edge: color-mix(in srgb, var(--ui-accent-purple) 14%, var(--ui-border-default));
  --new-highlight: color-mix(in srgb, white 16%, transparent);
  --new-shade: color-mix(in srgb, var(--ui-text-primary) 7%, transparent);
  --new-side: color-mix(in srgb, var(--ui-border-strong) 45%, var(--ui-bg-canvas));
  --new-face: color-mix(in srgb, var(--ui-bg-surface) 96%, var(--ui-accent-sky));
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 28px;
  background: var(--ui-bg-canvas);
}
.desktop-new-content {
  flex-shrink: 0;
  width: min(780px, 100%);
  margin-block: auto;
}
.desktop-weather {
  max-width: 380px;
  margin-bottom: 28px;
}
.desktop-new-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ui-accent-purple);
  font-size: 13px;
}
h1 {
  margin: 16px 0 26px;
  color: var(--ui-text-primary);
  font: 400 clamp(22px, 3vw, 30px)/1.5 var(--ui-font-pixel);
  text-wrap: balance;
}
/* 细边框和短侧面表达像素层次，凹下的输入面与凸起的操作面区分。 */
.desktop-new-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 18px;
  border: 1px solid var(--new-edge);
  border-radius: 0;
  background: var(--ui-bg-surface-soft);
  color: var(--ui-text-secondary);
  box-shadow:
    inset 1px 1px var(--new-shade),
    inset -1px -1px var(--new-highlight),
    2px 2px 0 var(--new-side);
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-fast) var(--ui-ease-standard);
}
.desktop-new-search::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 18px;
  width: 24px;
  height: 2px;
  background: var(--ui-accent-purple);
  pointer-events: none;
}
.desktop-new-search:focus-within {
  border-color: color-mix(in srgb, var(--ui-accent-purple) 65%, var(--ui-border-default));
  box-shadow:
    inset 1px 1px var(--new-shade),
    inset -1px -1px var(--new-highlight),
    2px 2px 0 color-mix(in srgb, var(--ui-accent-purple) 22%, var(--ui-bg-canvas));
}
.desktop-new-search input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: 0;
  border-radius: 0;
  outline: 0;
  background: transparent;
  color: var(--ui-text-primary);
  caret-color: var(--ui-accent-purple);
  font: 14px var(--ui-font-sans);
}
.desktop-new-search input::placeholder {
  color: var(--ui-text-secondary);
  opacity: 0.75;
}
.desktop-new-search button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 32px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-purple) 32%, var(--ui-border-default));
  border-radius: 0;
  background: color-mix(in srgb, var(--ui-accent-purple) 12%, var(--ui-bg-surface));
  color: var(--ui-accent-purple);
  box-shadow:
    inset 1px 1px var(--new-highlight),
    inset -1px -1px var(--new-shade),
    2px 2px 0 var(--new-side);
  cursor: pointer;
  transition:
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-instant) steps(2, end),
    transform var(--ui-duration-instant) steps(2, end);
}
.desktop-new-search button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ui-accent-purple) 20%, var(--ui-bg-surface));
}
.desktop-new-search button:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow: inset 1px 1px var(--new-shade);
}
.desktop-new-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  margin: 14px 0 32px;
  color: var(--ui-text-secondary);
  font: 11px var(--ui-font-pixel);
}
.desktop-new-hint > span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.desktop-new-hint kbd {
  padding: 2px 5px;
  border: 1px solid var(--ui-border-subtle);
  border-radius: 0;
  background: var(--ui-bg-surface-soft);
  box-shadow: 0 1px 0 var(--ui-border-default);
  font: 10px var(--ui-font-pixel);
}
.desktop-launch-group + .desktop-launch-group {
  margin-top: 28px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 12px;
  color: var(--ui-text-secondary);
  font: 12px var(--ui-font-pixel);
}
h2::before {
  content: '';
  width: 4px;
  height: 4px;
  flex-shrink: 0;
  background: var(--ui-accent-purple);
  box-shadow: 2px 2px 0 var(--ui-accent-purple-soft);
}
.desktop-launch-group:last-child h2::before {
  background: var(--ui-accent-sky);
}
.desktop-launch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(210px, 100%), 1fr));
  gap: 14px;
}
.desktop-launch-card {
  --launch-accent: var(--ui-accent-purple);
  position: relative;
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
  min-height: 80px;
  padding: 16px;
  border: 1px solid var(--new-edge);
  border-radius: 0;
  background:
    linear-gradient(180deg, color-mix(in srgb, white 3%, transparent), transparent 48%),
    var(--new-face);
  box-shadow:
    inset 1px 1px var(--new-highlight),
    inset -1px -1px var(--new-shade),
    2px 2px 0 var(--new-side);
  text-align: left;
  color: var(--ui-text-primary);
  cursor: pointer;
  transition:
    border-color var(--ui-duration-fast) var(--ui-ease-standard),
    background-color var(--ui-duration-fast) var(--ui-ease-standard),
    box-shadow var(--ui-duration-instant) steps(2, end),
    transform var(--ui-duration-instant) steps(2, end);
}
.desktop-launch-card::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 16px;
  width: 16px;
  height: 2px;
  background: color-mix(in srgb, var(--launch-accent) 55%, transparent);
  pointer-events: none;
}
.desktop-launch-card:hover:not(:disabled),
.desktop-launch-card:focus-visible {
  border-color: color-mix(in srgb, var(--launch-accent) 50%, var(--ui-border-default));
  transform: translateY(-1px);
  box-shadow:
    inset 1px 1px var(--new-highlight),
    inset -1px -1px var(--new-shade),
    2px 3px 0 var(--new-side);
}
.desktop-launch-card:active:not(:disabled) {
  transform: translate(1px, 1px);
  box-shadow:
    inset 1px 1px var(--new-shade),
    1px 1px 0 var(--new-side);
}
.desktop-launch-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--launch-accent) 26%, var(--ui-border-default));
  border-radius: 0;
  background: color-mix(in srgb, var(--launch-accent) 10%, var(--ui-bg-surface));
  box-shadow:
    inset 1px 1px var(--new-highlight),
    inset -1px -2px color-mix(in srgb, var(--launch-accent) 12%, transparent),
    2px 2px 0 color-mix(in srgb, var(--launch-accent) 18%, var(--ui-bg-canvas));
  color: var(--launch-accent);
}
.desktop-launch-card > span:nth-child(2) {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.desktop-launch-card strong {
  display: block;
  font: 400 14px/1.4 var(--ui-font-pixel);
}
.desktop-launch-card small {
  display: block;
  margin-top: 5px;
  font: 11px/1.6 var(--ui-font-sans);
  color: var(--ui-text-secondary);
}
.desktop-shortcut {
  --launch-accent: var(--ui-accent-sky);
}
.desktop-weather :deep(.weather-card) {
  border: 1px solid var(--new-edge);
  border-radius: 0;
  background: var(--new-face);
  box-shadow:
    inset 1px 1px var(--new-highlight),
    inset -1px -1px var(--new-shade),
    2px 2px 0 var(--new-side);
}
button:disabled {
  cursor: default;
  opacity: 0.55;
  transform: none;
}
button:focus-visible {
  outline: 1px solid var(--ui-accent-purple);
  outline-offset: 3px;
}
@media (max-width: 560px) {
  .desktop-new-page {
    padding: 28px 18px;
  }
  .desktop-launch-card {
    min-height: 72px;
    padding: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .desktop-launch-card,
  .desktop-new-search button {
    transition: none;
  }
}
</style>
