<script setup lang="ts">
import { computed, ref } from 'vue'
import type { InputSurfaceProps } from '@infos/shared'
import { PButton } from '../pixel'
import AgentRequestIdentity from '../agent/AgentRequestIdentity.vue'

const props = defineProps<{
  request: InputSurfaceProps
  loading?: boolean
}>()
const emit = defineEmits<{
  answer: [payload: { selectedOptionIds: string[]; message?: string; skipped?: boolean }]
}>()

const message = ref('')
const selected = ref<string[]>([])
const canSubmit = computed(
  () =>
    selected.value.length > 0 || (props.request.allowFreeText !== false && message.value.trim()),
)
const contextMessage = computed(() => {
  const value = props.request.context?.message
  return typeof value === 'string' ? value : ''
})

function toggleOption(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((value) => value !== id)
    : [...selected.value, id]
}

function submit(): void {
  if (!canSubmit.value) return
  emit('answer', {
    selectedOptionIds: selected.value,
    message: message.value.trim() || undefined,
  })
}
</script>

<template>
  <article class="agent-input-card">
    <header class="agent-input-card__header">
      <AgentRequestIdentity
        :agent-id="request.principalId || 'pero'"
        subtitle="回答后会继续刚才的工作"
      >
        <template #title>想问问你</template>
      </AgentRequestIdentity>
      <span class="agent-input-card__waiting">
        <i />
        等待回答
      </span>
    </header>

    <div class="agent-input-card__body">
      <p class="agent-input-card__question">{{ request.question }}</p>
      <p v-if="contextMessage" class="agent-input-card__context">{{ contextMessage }}</p>

      <div v-if="request.options?.length" class="agent-input-card__options">
        <button
          v-for="option in request.options"
          :key="option.id"
          type="button"
          :class="{ 'agent-input-card__option--selected': selected.includes(option.id) }"
          @click="toggleOption(option.id)"
        >
          <i />
          <span>
            <strong>{{ option.label }}</strong>
            <small>{{ option.description }}</small>
          </span>
        </button>
      </div>

      <textarea
        v-if="request.allowFreeText !== false"
        v-model="message"
        rows="3"
        maxlength="4000"
        placeholder="告诉我你的想法，也可以补充选项之外的信息…"
      />
    </div>

    <footer class="agent-input-card__actions">
      <PButton
        v-if="!request.required"
        size="sm"
        variant="secondary"
        :disabled="loading"
        @click="emit('answer', { selectedOptionIds: [], skipped: true })"
      >
        暂时跳过
      </PButton>
      <PButton size="sm" :disabled="loading || !canSubmit" @click="submit">
        {{ loading ? '正在告诉TA…' : '回答并继续' }}
      </PButton>
    </footer>
  </article>
</template>

<style scoped>
.agent-input-card {
  width: min(100%, 520px);
  margin: 8px 0 8px auto;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-accent-sky) 44%, var(--ui-border-subtle));
  border-left: 3px solid var(--ui-accent-sky);
  background: var(--ui-bg-elevated);
  box-shadow:
    3px 3px 0 color-mix(in srgb, var(--ui-accent-sky) 17%, transparent),
    5px 5px 0 color-mix(in srgb, var(--ui-text-primary) 5%, transparent);
  animation: agent-input-in 260ms steps(4, end) both;
}
.agent-input-card__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--ui-accent-sky) 20%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-accent-sky) 7%, var(--ui-bg-elevated));
}
.agent-input-card__waiting {
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 5px;
  color: var(--ui-accent-sky);
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;
}
.agent-input-card__waiting i {
  width: 6px;
  height: 6px;
  background: currentColor;
  animation: input-wait 1.5s steps(3, end) infinite;
}
.agent-input-card__body {
  padding: 12px;
}
.agent-input-card__question {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--ui-accent-sky) 22%, var(--ui-border-subtle));
  background: color-mix(in srgb, var(--ui-accent-sky) 5%, var(--ui-bg-primary));
  color: var(--ui-text-primary);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.55;
}
.agent-input-card__context {
  margin: 7px 2px 0;
  color: var(--ui-text-tertiary);
  font-size: 10px;
  line-height: 1.45;
}
.agent-input-card__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-top: 10px;
}
.agent-input-card__option {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 9px;
  border: 1px solid var(--ui-border-subtle);
  background: var(--ui-bg-primary);
  color: var(--ui-text-primary);
  text-align: left;
  cursor: pointer;
  transition:
    transform 120ms steps(2, end),
    border-color 120ms ease;
}
.agent-input-card__option:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--ui-accent-sky) 55%, var(--ui-border-subtle));
}
.agent-input-card__option > i {
  width: 9px;
  height: 9px;
  margin-top: 2px;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border-strong);
  background: var(--ui-bg-elevated);
}
.agent-input-card__option--selected {
  border-color: var(--ui-accent-sky);
  background: color-mix(in srgb, var(--ui-accent-sky) 8%, var(--ui-bg-primary));
}
.agent-input-card__option--selected > i {
  background: var(--ui-accent-sky);
  box-shadow: inset 0 0 0 2px var(--ui-bg-elevated);
}
.agent-input-card__option span {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.agent-input-card__option strong {
  font-size: 11px;
}
.agent-input-card__option small {
  color: var(--ui-text-tertiary);
  font-size: 9px;
  line-height: 1.35;
}
.agent-input-card textarea {
  box-sizing: border-box;
  width: 100%;
  margin-top: 10px;
  padding: 8px 10px;
  resize: vertical;
  border: 1px solid var(--ui-border-subtle);
  outline: none;
  background: var(--ui-bg-primary);
  color: var(--ui-text-primary);
  font: inherit;
  font-size: 11px;
  line-height: 1.45;
}
.agent-input-card textarea:focus {
  border-color: var(--ui-accent-sky);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-accent-sky) 13%, transparent);
}
.agent-input-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  padding: 0 12px 11px;
}
@keyframes agent-input-in {
  from {
    opacity: 0;
    transform: translateY(5px);
  }
}
@keyframes input-wait {
  50% {
    opacity: 0.35;
    transform: translateY(-1px);
  }
}
@media (max-width: 560px) {
  .agent-input-card__options {
    grid-template-columns: 1fr;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-input-card,
  .agent-input-card__waiting i {
    animation: none;
  }
  .agent-input-card__option {
    transition: none;
  }
}
</style>
