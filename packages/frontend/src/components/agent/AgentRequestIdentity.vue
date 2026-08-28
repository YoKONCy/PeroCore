<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { getApiBaseUrl } from '../../api/transport'
import { useAgentStore } from '../../stores'

const props = withDefaults(
  defineProps<{
    agentId: string
    subtitle?: string
    tone?: 'sky' | 'approval'
  }>(),
  { subtitle: '', tone: 'sky' },
)

const agentStore = useAgentStore()
const agent = computed(() => agentStore.agents.find((item) => item.id === props.agentId))
const name = computed(() => agent.value?.name || props.agentId)
const avatarUrl = computed(() => {
  const value = agent.value?.avatarUrl
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `${getApiBaseUrl()}${value}`
})

onMounted(() => {
  if (agentStore.agents.length === 0) void agentStore.fetchAgents()
})
</script>

<template>
  <div class="agent-request-identity" :class="`agent-request-identity--${tone}`">
    <div class="agent-request-identity__avatar">
      <img v-if="avatarUrl" :src="avatarUrl" :alt="name" />
      <span v-else>{{ name.slice(0, 1).toUpperCase() }}</span>
      <i aria-hidden="true" />
    </div>
    <div class="agent-request-identity__copy">
      <strong>
        <slot name="title">{{ name }}</slot>
      </strong>
      <span>{{ subtitle }}</span>
    </div>
  </div>
</template>

<style scoped>
.agent-request-identity {
  --identity-tone: var(--ui-accent-sky, #0ea5e9);
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}
.agent-request-identity--approval {
  --identity-tone: var(--approval-tone, var(--ui-accent-primary, #db2777));
}
.agent-request-identity__avatar {
  position: relative;
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  overflow: visible;
  place-items: center;
  border: 2px solid color-mix(in srgb, var(--identity-tone) 68%, var(--ui-border-strong));
  background: color-mix(in srgb, var(--identity-tone) 12%, var(--ui-bg-elevated));
  box-shadow: 2px 2px 0 color-mix(in srgb, var(--identity-tone) 36%, var(--ui-border-strong));
  color: var(--identity-tone);
  font-weight: 900;
}
.agent-request-identity__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.agent-request-identity__avatar i {
  position: absolute;
  right: -4px;
  bottom: -4px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-bg-elevated);
  background: var(--identity-tone);
  box-shadow: 1px 1px 0 var(--ui-border-strong);
  animation: identity-breathe 1.8s steps(3, end) infinite;
}
.agent-request-identity__copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}
.agent-request-identity__copy strong {
  overflow: hidden;
  color: var(--ui-text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-request-identity__copy span {
  color: var(--ui-text-tertiary);
  font-size: 9px;
  line-height: 1.25;
}
@keyframes identity-breathe {
  50% {
    opacity: 0.45;
    transform: translateY(-1px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-request-identity__avatar i {
    animation: none;
  }
}
</style>
