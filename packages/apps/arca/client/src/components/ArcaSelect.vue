<script setup lang="ts" generic="T extends string | number | null">
import { t as __t } from '../i18n'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { openDialogs } from '../services/dialogState'
import ArcaIcon from './ArcaIcon.vue'
import ArcaAvatar from './ArcaAvatar.vue'

const props = withDefaults(
  defineProps<{
    modelValue?: T
    options: readonly {
      value: T
      label: string
      disabled?: boolean
      agentId?: string
      description?: string
      fontFamily?: string
    }[]
    disabled?: boolean
    ariaLabel?: string
    placeholder?: string
  }>(),
  { modelValue: undefined, ariaLabel: undefined, placeholder: undefined },
)
const emit = defineEmits<{ 'update:modelValue': [value: T]; change: [value: T] }>()
const id = useId()
const displayPlaceholder = computed(() => props.placeholder ?? __t('apps.arca.ui', '请选择'))
const trigger = ref<HTMLButtonElement>(),
  popup = ref<HTMLElement>()
const open = ref(false),
  active = ref(-1)
const position = ref<Record<string, string>>({})
const selected = computed(() => props.options.find((option) => option.value === props.modelValue))
let typeahead = '',
  typeTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined
let disposed = false

function close(restore = false) {
  open.value = false
  typeahead = ''
  if (typeTimer) clearTimeout(typeTimer)
  if (restore && trigger.value?.isConnected && !trigger.value.closest('[inert]'))
    trigger.value.focus({ preventScroll: true })
}
function place() {
  if (!open.value || !trigger.value) return
  const bounds = trigger.value.getBoundingClientRect()
  if (!bounds.width || trigger.value.matches(':disabled') || trigger.value.closest('[inert]')) {
    close()
    return
  }
  const width = Math.min(Math.max(bounds.width, 190), window.innerWidth - 24)
  const height = Math.min(
    popup.value?.scrollHeight || props.options.length * 43 + 12,
    320,
    window.innerHeight - 24,
  )
  const below = window.innerHeight - bounds.bottom - 12
  const above = bounds.top - 12
  const upward = below < Math.min(height, 160) && above > below
  const available = Math.max(40, upward ? above : below)
  position.value = {
    left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)) + 'px',
    top:
      (upward ? Math.max(12, bounds.top - Math.min(height, available) - 5) : bounds.bottom + 5) +
      'px',
    width: width + 'px',
    maxHeight: Math.min(height, available) + 'px',
    transformOrigin: upward ? 'bottom center' : 'top center',
  }
}
async function reveal() {
  if (
    props.disabled ||
    !props.options.length ||
    trigger.value?.matches(':disabled') ||
    trigger.value?.closest('[inert]')
  )
    return
  active.value = props.options.findIndex(
    (option) => option.value === props.modelValue && !option.disabled,
  )
  if (active.value < 0) active.value = props.options.findIndex((option) => !option.disabled)
  open.value = true
  trigger.value?.focus({ preventScroll: true })
  place()
  await nextTick()
  if (!disposed && open.value) {
    place()
    await nextTick()
    if (!disposed && open.value) scrollActive()
  }
}
function scrollActive() {
  popup.value
    ?.querySelector<HTMLElement>('[data-active="true"]')
    ?.scrollIntoView({ block: 'nearest' })
}
function choose(index: number) {
  const option = props.options[index]
  if (!option || option.disabled) return
  if (props.disabled || trigger.value?.matches(':disabled') || trigger.value?.closest('[inert]')) {
    close()
    return
  }
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close(true)
}
async function keys(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    close()
    return
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault()
    event.stopPropagation()
    close(true)
    return
  }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
    if (!open.value) {
      await reveal()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      choose(active.value)
      return
    }
    const enabled = props.options
      .map((option, index) => (option.disabled ? -1 : index))
      .filter((index) => index >= 0)
    if (!enabled.length) return
    const current = enabled.indexOf(active.value)
    active.value =
      event.key === 'Home'
        ? enabled[0]!
        : event.key === 'End'
          ? enabled.at(-1)!
          : enabled[
              (current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length
            ]!
    await nextTick()
    if (!disposed) scrollActive()
  } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    event.stopPropagation()
    if (!open.value) await reveal()
    typeahead += event.key.toLocaleLowerCase()
    const index = props.options.findIndex(
      (option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(typeahead),
    )
    if (index >= 0) active.value = index
    if (typeTimer) clearTimeout(typeTimer)
    typeTimer = setTimeout(() => {
      typeahead = ''
    }, 700)
    await nextTick()
    if (!disposed) scrollActive()
  }
}
function outside(event: Event) {
  const target = event.target instanceof Node ? event.target : undefined
  if (target && !trigger.value?.contains(target) && !popup.value?.contains(target)) close()
}
function blur() {
  close()
}
watch(
  () => [props.disabled, openDialogs.value],
  () => {
    if (props.disabled || openDialogs.value) close()
  },
)
watch(
  () => props.options,
  (options, previous) => {
    if (!open.value) return
    const hovered = previous?.[active.value]?.value
    active.value = options.findIndex((option) => option.value === hovered && !option.disabled)
    if (active.value < 0)
      active.value = options.findIndex(
        (option) => option.value === props.modelValue && !option.disabled,
      )
    if (active.value < 0) active.value = options.findIndex((option) => !option.disabled)
    place()
  },
  { flush: 'post' },
)
onMounted(() => {
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
  window.addEventListener('blur', blur)
  observer = new ResizeObserver(place)
  if (trigger.value) observer.observe(trigger.value)
})
onBeforeUnmount(() => {
  disposed = true
  if (typeTimer) clearTimeout(typeTimer)
  observer?.disconnect()
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
  window.removeEventListener('blur', blur)
})
</script>

<template>
  <span class="arca-select">
    <button
      ref="trigger"
      class="arca-select-trigger"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      :aria-controls="id"
      :aria-activedescendant="open && active >= 0 ? id + '-' + active : undefined"
      :disabled="disabled || !options.length"
      @mousedown.prevent
      @click="open ? close(true) : reveal()"
      @keydown="keys"
    >
      <ArcaAvatar v-if="selected?.agentId" :agent-id="selected.agentId" :name="selected.label" />
      <span :class="{ 'select-placeholder': !selected }">
        {{ selected?.label ?? displayPlaceholder }}
      </span>
      <ArcaIcon name="chevronDown" :size="13" />
    </button>
    <Teleport to="body">
      <Transition name="select-popover">
        <div
          v-if="open"
          :id="id"
          ref="popup"
          class="arca-select-popup"
          role="listbox"
          :aria-label="ariaLabel"
          :style="position"
          @mousedown.prevent
        >
          <div
            v-for="(option, index) in options"
            :id="id + '-' + index"
            :key="String(option.value) + ':' + index"
            class="arca-select-option"
            role="option"
            :aria-selected="option.value === modelValue"
            :aria-disabled="option.disabled"
            :data-active="active === index"
            :style="{ fontFamily: option.fontFamily }"
            @pointermove="!option.disabled && (active = index)"
            @click="choose(index)"
          >
            <ArcaAvatar v-if="option.agentId" :agent-id="option.agentId" :name="option.label" />
            <span>
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
            </span>
            <ArcaIcon v-if="option.value === modelValue" name="check" :size="15" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
</template>
