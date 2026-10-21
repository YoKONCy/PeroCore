<script setup lang="ts">
import { t as __t } from '../../i18n/index'

/** 角色头像的共享状态浮层；完整文本可选中、滚动，且不改变角色选择。 */
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue'
import { usePetStateStore } from '../../stores/usePetStateStore'
import PixelIcon from '../pixel/PixelIcon.vue'
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    agentId?: string
    threadId?: string
    agentName?: string
    as?: 'span' | 'button'
  }>(),
  { agentId: '', threadId: undefined, agentName: '角色', as: 'span' },
)
const stateStore = usePetStateStore()
const trigger = ref<HTMLElement | null>(null),
  card = ref<HTMLElement | null>(null)
const visible = ref(false),
  positioned = ref(false)
const position = ref({ left: 0, top: 0 })
const cardId = useId()
const state = computed(() => stateStore.stateFor(props.agentId, props.threadId))
const hasState = computed(() => stateStore.hasState(props.agentId, props.threadId))
const loading = computed(
  () => stateStore.loading[stateStore.scopeKey(props.agentId, props.threadId)],
)
const error = computed(() => stateStore.errors[stateStore.scopeKey(props.agentId, props.threadId)])
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined
let frame = 0
let disposed = false

function updatePosition(): void {
  if (!visible.value || !trigger.value || !card.value) return
  const anchor = trigger.value.getBoundingClientRect(),
    bounds = card.value.getBoundingClientRect()
  const width = document.documentElement.clientWidth || window.innerWidth
  const height = window.innerHeight,
    pad = 12,
    gap = 10
  let left = anchor.right + gap
  if (left + bounds.width > width - pad) left = anchor.left - bounds.width - gap
  if (left < pad) left = anchor.left + (anchor.width - bounds.width) / 2
  position.value = {
    left: Math.max(pad, Math.min(left, width - bounds.width - pad)),
    top: Math.max(pad, Math.min(anchor.top, height - bounds.height - pad)),
  }
  positioned.value = true
}

function queuePosition(): void {
  if (frame || !visible.value) return
  frame = requestAnimationFrame(() => {
    frame = 0
    updatePosition()
  })
}

function keepOpen(): void {
  clearTimeout(closeTimer)
}
function hide(): void {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  visible.value = false
  positioned.value = false
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('resize', queuePosition)
  window.removeEventListener('scroll', queuePosition, true)
  window.removeEventListener('keydown', escape)
  window.removeEventListener('blur', hide)
  document.removeEventListener('visibilitychange', visibilityChanged)
}
function escape(event: KeyboardEvent): void {
  if (event.key === 'Escape') hide()
}
function visibilityChanged(): void {
  if (document.hidden) hide()
}

async function show(): Promise<void> {
  clearTimeout(openTimer)
  keepOpen()
  if (!props.agentId || disposed || visible.value) return
  visible.value = true
  void stateStore.refresh(props.agentId, false, props.threadId)
  await nextTick()
  if (disposed || !visible.value || !card.value) return
  updatePosition()
  if (typeof ResizeObserver !== 'undefined') {
    observer ??= new ResizeObserver(queuePosition)
    observer.observe(card.value)
  }
  window.addEventListener('resize', queuePosition)
  window.addEventListener('scroll', queuePosition, true)
  window.addEventListener('keydown', escape)
  window.addEventListener('blur', hide)
  document.addEventListener('visibilitychange', visibilityChanged)
}
function hover(): void {
  keepOpen()
  clearTimeout(openTimer)
  openTimer = setTimeout(() => {
    void show()
  }, 180)
}
function leave(): void {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  closeTimer = setTimeout(() => {
    if (trigger.value?.matches(':focus-visible') || card.value?.contains(document.activeElement))
      return
    hide()
  }, 160)
}
function focusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  if (next instanceof Node && (trigger.value?.contains(next) || card.value?.contains(next))) return
  leave()
}

watch(() => stateStore.scopeKey(props.agentId, props.threadId), hide)
onDeactivated(hide)
onBeforeUnmount(() => {
  disposed = true
  hide()
})
</script>

<template>
  <component
    :is="as"
    ref="trigger"
    v-bind="$attrs"
    class="agent-state-trigger"
    :tabindex="agentId ? 0 : undefined"
    :aria-describedby="visible ? cardId : undefined"
    @mouseenter="hover"
    @mouseleave="leave"
    @focusin="show"
    @focusout="focusOut"
  >
    <slot />
    <Teleport to="body">
      <Transition name="agent-state-popover">
        <section
          v-if="visible"
          :id="cardId"
          ref="card"
          class="agent-state-card"
          role="tooltip"
          :style="{
            left: `${position.left}px`,
            top: `${position.top}px`,
            visibility: positioned ? 'visible' : 'hidden',
          }"
          @mouseenter="keepOpen"
          @mouseleave="leave"
          @focusin="keepOpen"
          @focusout="focusOut"
        >
          <header class="agent-state-card__header">
            <PixelIcon name="sparkle" size="xs" />
            <strong>{{ agentName }}</strong>
            <span>{{ __t('ui.agent', '当前状态') }}</span>
          </header>
          <p v-if="loading && !hasState" class="agent-state-card__notice" role="status">
            {{ __t('ui.agent', '正在读取角色状态…') }}
          </p>
          <dl v-if="hasState" class="agent-state-card__fields">
            <div>
              <dt>{{ __t('ui.agent', '心情') }}</dt>
              <dd>{{ state.mood || __t('ui.agent', '暂无心情记录') }}</dd>
            </div>
            <div>
              <dt>{{ __t('ui.agent', '外在表现 · Vibe') }}</dt>
              <dd>{{ state.vibe || __t('ui.agent', '暂无外在表现记录') }}</dd>
            </div>
            <div>
              <dt>{{ __t('ui.agent', '内心想法') }}</dt>
              <dd>{{ state.mind || __t('ui.agent', '暂无内心想法记录') }}</dd>
            </div>
          </dl>
          <footer v-if="error" class="agent-state-card__notice" role="status">
            <span>{{ hasState ? __t('ui.agent', '刷新失败，当前显示已缓存的状态') : error }}</span>
            <button type="button" :disabled="loading" @click="stateStore.refresh(agentId, true)">
              {{ loading ? __t('ui.agent', '读取中…') : __t('ui.agent', '重试') }}
            </button>
          </footer>
        </section>
      </Transition>
    </Teleport>
  </component>
</template>

<style scoped>
.agent-state-trigger {
  display: inline-flex;
  vertical-align: middle;
}
.agent-state-trigger:focus-visible {
  outline: 2px solid var(--ui-accent-sky);
  outline-offset: 4px;
}
.agent-state-card {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: min(360px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 24px));
  padding: 14px 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--ui-border-default);
  border-top: 2px solid var(--ui-accent-sky);
  border-radius: var(--ui-radius-lg, 12px);
  background: var(--ui-bg-elevated);
  color: var(--ui-text-primary);
  box-shadow: var(--ui-shadow-lg);
  font: 12px/1.7 var(--ui-font-sans);
  text-align: left;
  user-select: text;
}
.agent-state-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ui-border-subtle);
}
.agent-state-card__header strong {
  min-width: 0;
  overflow-wrap: anywhere;
}
.agent-state-card__header > span:last-child {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--ui-text-tertiary);
  font-size: 10px;
}
.agent-state-card__fields {
  display: grid;
  gap: 12px;
  margin: 12px 0 0;
}
.agent-state-card__fields dt {
  margin-bottom: 3px;
  color: var(--ui-accent-sky);
  font-size: 10px;
  font-weight: 700;
}
.agent-state-card__fields dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.agent-state-card__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0 0;
  color: var(--ui-text-tertiary);
}
.agent-state-card__notice button {
  flex-shrink: 0;
  padding: 3px 8px;
  border: 1px solid var(--ui-border-default);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg-surface);
  color: var(--ui-accent-sky);
  cursor: pointer;
}
.agent-state-popover-enter-active,
.agent-state-popover-leave-active {
  transition: opacity 0.12s ease;
}
.agent-state-popover-enter-from,
.agent-state-popover-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .agent-state-popover-enter-active,
  .agent-state-popover-leave-active {
    transition: none;
  }
}
</style>
