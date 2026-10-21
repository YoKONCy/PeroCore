<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    id: string
    label: string
    description: string
    min: number
    max: number
    step?: number
    unit?: string
    disabled?: boolean
  }>(),
  { step: 1, unit: '', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const fill = computed(
  () =>
    `${Math.max(
      0,
      Math.min(100, ((props.modelValue - props.min) / (props.max - props.min)) * 100),
    )}%`,
)

/** 输入结束后约束范围和步长，空值不覆盖原配置。 */
function commit(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.value.trim() === '' || !Number.isFinite(input.valueAsNumber)) {
    input.value = String(props.modelValue)
    return
  }
  const bounded = Math.max(props.min, Math.min(props.max, input.valueAsNumber))
  const value = Math.max(
    props.min,
    Math.min(
      props.max,
      Number((props.min + Math.round((bounded - props.min) / props.step) * props.step).toFixed(4)),
    ),
  )
  input.value = String(value)
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="rag-number" :class="{ 'is-disabled': disabled }">
    <div class="rag-number-head">
      <label :id="`${id}-label`" :for="id">{{ label }}</label>
      <div class="rag-number-value">
        <input
          :id="id"
          type="number"
          :value="modelValue"
          :min="min"
          :max="max"
          :step="step"
          :disabled="disabled"
          :aria-describedby="`${id}-description`"
          @change="commit"
        />
        <span v-if="unit">{{ unit }}</span>
      </div>
    </div>
    <input
      class="rag-number-range"
      type="range"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :style="{ '--range-fill': fill }"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="`${id}-description`"
      @input="commit"
    />
    <p :id="`${id}-description`">{{ description }}</p>
  </div>
</template>

<style scoped>
.rag-number {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--ui-border-default);
  border-radius: 8px;
  background: var(--dash-panel-bg, var(--ui-bg-surface));
}
.rag-number-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.rag-number-head label {
  font-size: 13px;
  font-weight: 650;
  color: var(--ui-text-primary);
}
.rag-number-value {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  color: var(--ui-text-tertiary);
  font-size: 11px;
}
.rag-number-value input {
  width: 78px;
  padding: 6px 8px;
  border: 1px solid var(--ui-border-default);
  border-radius: 5px;
  background: var(--ui-bg-input, var(--ui-bg-surface));
  color: var(--ui-text-primary);
  font: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.rag-number-range {
  display: block;
  width: 100%;
  height: 5px;
  margin: 21px 0 15px;
  border-radius: 3px;
  appearance: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--ui-accent-purple) var(--range-fill),
    var(--ui-border-default) var(--range-fill)
  );
}
.rag-number-range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  border: 2px solid var(--ui-bg-surface);
  border-radius: 4px;
  appearance: none;
  background: var(--ui-accent-purple);
  box-shadow: 0 0 0 1px var(--ui-accent-purple);
  transition: transform 140ms ease;
}
.rag-number-range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 2px solid var(--ui-bg-surface);
  border-radius: 4px;
  background: var(--ui-accent-purple);
  box-shadow: 0 0 0 1px var(--ui-accent-purple);
}
.rag-number-range:hover::-webkit-slider-thumb {
  transform: scale(1.15);
}
.rag-number p {
  margin: 0;
  color: var(--ui-text-tertiary);
  font-size: 11px;
  line-height: 1.7;
}
.rag-number input:focus-visible {
  outline: 2px solid var(--ui-accent-purple);
  outline-offset: 4px;
}
.rag-number.is-disabled {
  opacity: 0.5;
}
.rag-number input:disabled {
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .rag-number-range::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
