<script setup lang="ts">
import { t as __t } from '../../i18n/index'

import { computed, onActivated, ref, watch } from 'vue'
import type { PlanStep, TaskPlan } from '@infos/shared'
import PixelIcon from '../pixel/PixelIcon.vue'

const props = withDefaults(defineProps<{ plan: TaskPlan; dismissible?: boolean }>(), {
  dismissible: true,
})
const emit = defineEmits<{ dismiss: []; openTask: [id: string] }>()
const expanded = ref(true)
const bodyId = computed(() => `todo-steps-${props.plan.id}`)
const done = computed(() => props.plan.steps.filter((step) => step.status === 'completed').length)
const progress = computed(() => done.value / Math.max(1, props.plan.steps.length))
const current = computed(() =>
  props.plan.status === 'completed'
    ? __t('ui.chat', '事项已完成')
    : ((
        props.plan.steps.find((step) => step.status === 'in_progress') ??
        props.plan.steps.find((step) => step.status === 'blocked') ??
        props.plan.steps.find((step) => step.status === 'pending')
      )?.title ?? ''),
)
const labels: Record<string, string> = {
  get pending() {
    return __t('ui.chat', '未完成')
  },
  get in_progress() {
    return __t('ui.chat', '进行中')
  },
  get queued() {
    return __t('ui.chat', '排队中')
  },
  get running() {
    return __t('ui.chat', '进行中')
  },
  get paused() {
    return __t('ui.chat', '已暂停')
  },
  get waiting_input() {
    return __t('ui.chat', '等你回应')
  },
  get waiting() {
    return __t('ui.chat', '等待中')
  },
  get blocked() {
    return __t('ui.chat', '受阻')
  },
  get failed() {
    return __t('ui.chat', '失败')
  },
  get cancelled() {
    return __t('ui.chat', '已取消')
  },
  get completed() {
    return __t('ui.chat', '已完成')
  },
}
function label(step: PlanStep) {
  if (step.task) return labels[step.task.status] ?? ''
  if (step.schedule)
    return step.schedule.status === 'failed'
      ? __t('ui.chat', '安排失败')
      : step.schedule.status === 'cancelled'
        ? __t('ui.chat', '已取消')
        : __t('ui.chat', '已安排')
  return step.status === 'in_progress'
    ? __t('ui.chat', '进行中')
    : step.status === 'blocked'
      ? __t('ui.chat', '受阻')
      : ''
}
function toggle() {
  expanded.value = !expanded.value
  try {
    localStorage.setItem(`infos:todo:${props.plan.id}`, expanded.value ? 'open' : 'closed')
  } catch {
    /* 偏好不可写时保持本次状态。 */
  }
}
function restoreFold() {
  try {
    const saved = localStorage.getItem(`infos:todo:${props.plan.id}`)
    expanded.value = saved ? saved === 'open' : props.plan.status !== 'completed'
  } catch {
    expanded.value = props.plan.status !== 'completed'
  }
}
watch(() => props.plan.id, restoreFold, { immediate: true })
onActivated(restoreFold)
watch(
  () => props.plan.status,
  (status, previous) => {
    if (status === 'completed' && previous !== 'completed') {
      expanded.value = false
      try {
        localStorage.setItem(`infos:todo:${props.plan.id}`, 'closed')
      } catch {
        /* 本次收起仍生效。 */
      }
    }
  },
)
</script>

<template>
  <section
    class="todo-plan"
    :class="{ 'todo-plan--complete': plan.status === 'completed' }"
    :aria-label="__t('ui.chat', '行动计划')"
  >
    <div class="todo-plan__heading">
      <button
        class="todo-plan__toggle"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        @click="toggle"
      >
        <svg class="todo-plan__glyph" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path
            d="M1 2h4v4H1V2zm1 1v2h2V3H2zm5 0h8v2H7V3zM1 9h4v4H1V9zm1 1v2h2v-2H2zm5 0h8v2H7v-2z"
          />
        </svg>
        <span class="todo-plan__title" :title="plan.title">{{ plan.title }}</span>
        <span class="todo-plan__count" aria-live="polite" aria-atomic="true">
          <Transition name="todo-count" mode="out-in">
            <span :key="`${done}/${plan.steps.length}`">{{ done }}/{{ plan.steps.length }}</span>
          </Transition>
        </span>
        <PixelIcon
          name="chevron-down"
          size="xs"
          class="todo-plan__chevron"
          :class="{ 'is-open': expanded }"
        />
      </button>
      <button
        v-if="dismissible && plan.status === 'completed'"
        class="todo-plan__dismiss"
        type="button"
        :title="__t('ui.chat', '收起已完成计划')"
        :aria-label="__t('ui.chat', '收起已完成计划')"
        @click="emit('dismiss')"
      >
        <PixelIcon name="close" size="xs" />
      </button>
    </div>
    <div
      class="todo-plan__track"
      role="progressbar"
      :aria-valuenow="done"
      :aria-valuemax="plan.steps.length"
      :aria-valuemin="0"
      :aria-label="__t('ui.chat', '{0}项完成，共{1}项', [done, plan.steps.length])"
    >
      <span :style="{ transform: `scaleX(${progress})` }" />
    </div>
    <Transition name="todo-detail">
      <div v-if="expanded" :id="bodyId" class="todo-plan__body">
        <div class="todo-plan__body-clip">
          <TransitionGroup name="todo-item" tag="ol" class="todo-plan__steps">
            <li
              v-for="step in plan.steps"
              :key="step.id"
              class="todo-plan__step"
              :class="`is-${step.status}`"
            >
              <component
                :is="step.task ? 'button' : 'div'"
                :type="step.task ? 'button' : undefined"
                class="todo-plan__row"
                :title="step.title"
                @click="step.task && emit('openTask', step.task.id)"
              >
                <Transition name="todo-mark" mode="out-in">
                  <span
                    :key="step.status"
                    class="todo-plan__mark"
                    :class="`is-${step.status}`"
                    aria-hidden="true"
                  >
                    <svg v-if="step.status === 'completed'" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M1 5h2v2h2V5h2V3h2V1h2v4H9v2H7v2H5v2H3V9H1z" />
                    </svg>
                    <span v-else-if="step.status === 'blocked'">!</span>
                  </span>
                </Transition>
                <span class="todo-plan__step-title">
                  <Transition name="todo-copy" mode="out-in">
                    <span :key="step.title">{{ step.title }}</span>
                  </Transition>
                </span>
                <span v-if="label(step)" class="todo-plan__state">{{ label(step) }}</span>
                <PixelIcon v-if="step.task" name="chevron-right" size="xs" />
                <span class="sr-only">
                  {{
                    labels[step.status] ??
                    (step.status === 'pending' ? __t('ui.chat', '未完成') : '')
                  }}
                </span>
              </component>
            </li>
          </TransitionGroup>
        </div>
      </div>
    </Transition>
    <Transition name="todo-detail">
      <div v-if="!expanded" class="todo-plan__summary">
        <div>
          <span class="todo-plan__summary-dot" />
          <Transition name="todo-copy" mode="out-in">
            <span :key="current" :title="current">{{ current }}</span>
          </Transition>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped src="./todo-plan.css" />
