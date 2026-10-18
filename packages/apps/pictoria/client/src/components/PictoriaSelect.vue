<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from './PictoriaIcon.vue'
import { resolutionRatio } from '../services/resolutionLabels'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    options: Array<{ value: string; label: string; disabled?: boolean }>
    disabled?: boolean
    placeholder?: string
    label?: string
    iconOnly?: boolean
    aspectRatio?: string
  }>(),
  { modelValue: undefined, aspectRatio: undefined, placeholder: '选择', label: '选择' },
)
const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
  focus: []
}>()
const trigger = ref<HTMLButtonElement | null>(null),
  menu = ref<HTMLElement | null>(null),
  open = ref(false),
  active = ref(-1)
const placement = ref({ left: 0, top: 0, width: 240, maxHeight: 240, up: false })
const id = `select-${crypto.randomUUID()}`
const optionCaption = (value: string) =>
  value.replace(/^(\d{2,5})\s*[*x×]\s*(\d{2,5})$/i, '$1 × $2')
const caption = computed(() =>
  optionCaption(
    props.options.find((option) => option.value === props.modelValue)?.label || props.placeholder,
  ),
)
const badge = computed(() =>
  props.options.some((option) => option.value === props.modelValue)
    ? resolutionRatio(props.modelValue || '', props.aspectRatio)
    : undefined,
)
const tooltip = computed(() => [caption.value, badge.value].filter(Boolean).join(' · '))
function place() {
  const box = trigger.value?.getBoundingClientRect()
  if (!box) return
  const below = window.innerHeight - box.bottom - 16,
    above = box.top - 16
  const up = below < Math.min(240, props.options.length * 38 + 12) && above > below
  const width = Math.min(window.innerWidth - 24, Math.max(box.width, props.iconOnly ? 200 : 220))
  placement.value = {
    left: Math.max(12, Math.min(window.innerWidth - width - 12, box.left)),
    top: up ? box.top - 6 : box.bottom + 6,
    width,
    maxHeight: Math.max(80, Math.min(300, up ? above : below)),
    up,
  }
}
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
async function show() {
  if (props.disabled) return
  place()
  active.value = props.options.findIndex(
    (option) => option.value === props.modelValue && !option.disabled,
  )
  if (active.value < 0) active.value = props.options.findIndex((option) => !option.disabled)
  open.value = true
  await nextTick()
  scrollActive()
}
function choose(index: number) {
  const option = props.options[index]
  if (!option || option.disabled || props.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option.value)
  close(true)
}
function scrollActive() {
  menu.value
    ?.querySelector<HTMLElement>(`[data-option="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}
function key(event: KeyboardEvent) {
  event.stopPropagation()
  if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
    event.preventDefault()
    event.stopPropagation()
  }
  if (event.key === 'Escape') {
    close(true)
    return
  }
  if (event.key === 'Tab') {
    close()
    return
  }
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) void show()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    choose(active.value)
    return
  }
  const enabled = props.options.flatMap((option, index) => (option.disabled ? [] : [index]))
  if (!enabled.length) return
  const index = enabled.indexOf(active.value)
  if (event.key === 'Home') active.value = enabled[0]!
  else if (event.key === 'End') active.value = enabled[enabled.length - 1]!
  else if (event.key === 'ArrowDown') active.value = enabled[(index + 1) % enabled.length]!
  else if (event.key === 'ArrowUp')
    active.value = enabled[(index - 1 + enabled.length) % enabled.length]!
  void nextTick(scrollActive)
}
function outside(event: PointerEvent) {
  if (!trigger.value?.contains(event.target as Node) && !menu.value?.contains(event.target as Node))
    close()
}
function blur() {
  close()
}
function scrolled(event: Event) {
  if (open.value && !(event.target instanceof Node && menu.value?.contains(event.target))) place()
}
watch(open, (value) => {
  if (value) {
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('blur', blur)
  } else cleanup()
})
watch(
  () => props.disabled,
  (value) => {
    if (value) close()
  },
)
function cleanup() {
  window.removeEventListener('pointerdown', outside, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', scrolled, true)
  window.removeEventListener('blur', blur)
}
onBeforeUnmount(cleanup)
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="pictoria-select"
    :class="{ 'is-open': open, 'icon-only': iconOnly }"
    :disabled="disabled"
    role="combobox"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="id"
    :aria-activedescendant="open && active >= 0 ? `${id}-${active}` : undefined"
    aria-haspopup="listbox"
    :title="iconOnly ? label : tooltip"
    @click="open ? close() : show()"
    @keydown="key"
    @focus="emit('focus')"
  >
    <Icon v-if="iconOnly" name="folder" :size="15" />
    <span v-else class="select-caption">
      <span>{{ caption }}</span>
      <small v-if="badge" class="select-ratio">{{ badge }}</small>
    </span>
    <Icon class="select-chevron" name="down" :size="13" />
  </button>
  <Teleport to="body">
    <Transition name="select-popover">
      <div
        v-if="open"
        :id="id"
        ref="menu"
        class="select-popover floating-panel"
        :class="{ 'opens-up': placement.up }"
        :style="{
          left: `${placement.left}px`,
          top: `${placement.top}px`,
          width: `${placement.width}px`,
          maxHeight: `${placement.maxHeight}px`,
        }"
        role="listbox"
        :aria-label="label"
        data-ui
        @keydown="key"
        @contextmenu.prevent
      >
        <button
          v-for="(option, index) in options"
          :id="`${id}-${index}`"
          :key="option.value"
          type="button"
          role="option"
          class="select-option"
          :class="{ active: index === active, chosen: option.value === modelValue }"
          :aria-selected="option.value === modelValue"
          :disabled="option.disabled"
          :data-option="index"
          tabindex="-1"
          @pointerdown.prevent
          @pointermove="active = index"
          @click="choose(index)"
        >
          <span class="select-option-label">
            <span>{{ optionCaption(option.label) }}</span>
            <small v-if="resolutionRatio(option.value, aspectRatio)" class="select-ratio">
              {{ resolutionRatio(option.value, aspectRatio) }}
            </small>
          </span>
          <Icon v-if="option.value === modelValue" name="check" :size="14" />
        </button>
        <span v-if="!options.length" class="select-empty">暂无选项</span>
      </div>
    </Transition>
  </Teleport>
</template>
