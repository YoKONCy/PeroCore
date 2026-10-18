<script setup lang="ts">
import ProviderDirectory from './ProviderDirectory.vue'
defineProps<{ agentId: string; online: boolean }>()
const emit = defineEmits<{ updated: []; error: [message: string] }>()
</script>
<template>
  <ProviderDirectory
    :agent-id="agentId"
    :online="online"
    @updated="emit('updated')"
    @error="emit('error', $event)"
  />
</template>
