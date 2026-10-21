<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import OnboardingOverlay, { type OnboardingStep } from './OnboardingOverlay.vue'
import { getDesktopSteps } from '../../composables/launcher/onboardingScripts'
import {
  completeOnboarding,
  loadOnboardingFlow,
  onboardingStorageKey,
  ONBOARDING_CHANGED,
  type OnboardingFlow,
} from '../../composables/launcher/onboardingFlow'
import { isElectron } from '../../utils/ipcAdapter'
import { logger } from '../../lib/logger'
import { t } from '../../i18n'

const props = defineProps<{
  ready: boolean
  currentTab: string
  navigate: (tab: string) => Promise<void>
}>()
const emit = defineEmits<{ active: [value: boolean] }>()
const steps = computed(getDesktopSteps)
const visible = ref(false)
const pending = ref<OnboardingFlow | null>(null)
let runId = ''
let previousTab = 'chat'
let previousFocus: HTMLElement | null = null
let disposed = false
let starting = false
let reading = false
let readAgain = false
let finishing = false
let run: AbortController | undefined

/** 等真实页面替换加载占位；目标不存在时有上限，不会困住导览。 */
function waitForPage(tab: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    let frame = 0
    const finish = () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      observer?.disconnect()
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const inspect = () => {
      if (signal.aborted || disposed) {
        finish()
        return
      }
      const page = document.querySelector<HTMLElement>(`[data-onboarding-tab="${tab}"]`)
      if (!page || page.matches('.main-tab-loading') || page.querySelector('.main-tab-loading'))
        return
      const motion = page.closest('.surface-transition')
      if (motion && !motion.classList.contains('is-idle')) return
      const box = page.getBoundingClientRect()
      if (!box.width || !box.height) return
      observer?.disconnect()
      // 页面过渡完成后再等两次绘制，避免 Vue 已挂载但布局还没落位。
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(finish)
      })
    }
    const timer = setTimeout(finish, 12_000)
    signal.addEventListener('abort', finish, { once: true })
    const observer = new MutationObserver(inspect)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    inspect()
  })
}
async function prepare(step: OnboardingStep, _index: number, signal: AbortSignal) {
  if (signal.aborted || disposed) return
  if (step.tab) {
    await props.navigate(step.tab)
    if (signal.aborted || disposed) return
    await nextTick()
    await waitForPage(step.tab, signal)
  }
  if (signal.aborted || disposed) return
  const target = step.focusSelector ? document.querySelector<HTMLElement>(step.focusSelector) : null
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  await nextTick()
}
async function start() {
  if (
    !props.ready ||
    !document.hasFocus() ||
    !pending.value ||
    starting ||
    visible.value ||
    finishing ||
    disposed
  )
    return
  starting = true
  run?.abort()
  const controller = new AbortController()
  run = controller
  const request = pending.value
  runId = request.runId
  previousTab = props.currentTab
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  emit('active', true)
  try {
    await props.navigate('chat')
    await nextTick()
    if (document.fonts) await document.fonts.ready
    await waitForPage('chat', controller.signal)
    if (disposed || controller.signal.aborted || !props.ready) {
      emit('active', false)
      return
    }
    visible.value = true
  } catch (error) {
    emit('active', false)
    logger.warn(
      'Onboarding',
      t('logs.frontend.onboarding', '读取桌面教程进度失败，稍后重试'),
      error,
    )
  } finally {
    starting = false
    if (!disposed && pending.value && pending.value.runId !== runId) void start()
  }
}
async function reload() {
  if (!isElectron() || disposed || finishing) return
  if (reading) {
    readAgain = true
    return
  }
  reading = true
  try {
    const flow = await loadOnboardingFlow()
    if (disposed) return
    if (runId && (flow.stage !== 'desktop' || runId !== flow.runId)) {
      run?.abort()
      visible.value = false
      emit('active', false)
    }
    pending.value = flow.stage === 'desktop' ? flow : null
  } catch (error) {
    logger.warn(
      'Onboarding',
      t('logs.frontend.onboarding', '读取桌面教程进度失败，稍后重试'),
      error,
    )
  } finally {
    reading = false
  }
  if (readAgain) {
    readAgain = false
    void reload()
    return
  }
  void start()
}
async function finish() {
  if (finishing || !runId) return
  finishing = true
  run?.abort()
  visible.value = false
  pending.value = null
  emit('active', false)
  try {
    await completeOnboarding(runId)
    if (!disposed) {
      await props.navigate(previousTab)
      await nextTick()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  } finally {
    finishing = false
    if (!disposed) void reload()
  }
}
function storage(event: StorageEvent) {
  if (event.key === onboardingStorageKey()) void reload()
}
watch(
  () => props.ready,
  (ready) => {
    if (ready) void reload()
  },
)
onMounted(() => {
  window.addEventListener('storage', storage)
  window.addEventListener('focus', reload)
  window.addEventListener(ONBOARDING_CHANGED, reload)
  void reload()
})
onBeforeUnmount(() => {
  disposed = true
  run?.abort()
  window.removeEventListener('storage', storage)
  window.removeEventListener('focus', reload)
  window.removeEventListener(ONBOARDING_CHANGED, reload)
})
</script>
<template>
  <OnboardingOverlay
    v-model:visible="visible"
    :steps="steps"
    :prepare-step="prepare"
    @finish="finish"
    @skip="finish"
  />
</template>
