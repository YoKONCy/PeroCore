<script setup lang="ts">
import { t as __t } from '../i18n'

import { computed, ref, watch } from 'vue'
import { arcaCollaborationClient } from '../services/collaboration'
import { useWorkbenchStore } from '../stores/workbench'
import ArcaIcon from './ArcaIcon.vue'

const props = defineProps<{ agentId?: string; name?: string; src?: string }>()
const store = useWorkbenchStore()
const id = computed(() => props.agentId?.replace(/^agent:/, '') ?? '')
const agent = computed(() => store.collaborationAgents.find((item) => item.id === id.value))
const name = computed(() => props.name || agent.value?.name || __t('apps.arca.ui', '协作者'))
const source = computed(
  () => props.src || arcaCollaborationClient.avatarFor(id.value, agent.value?.avatarUrl),
)
const failed = ref(false)
watch(source, () => {
  failed.value = false
})
</script>

<template>
  <span class="arca-avatar" :title="name">
    <img
      v-if="source && !failed"
      :src="source"
      :alt="name"
      draggable="false"
      @error="failed = true"
    />
    <ArcaIcon v-else :name="id === 'arca-local' ? 'sparkle' : 'person'" :size="18" />
  </span>
</template>
