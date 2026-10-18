<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { PButton, PSelect, PDialog } from '../../pixel'
import { promptApi } from '../../../api/modules/promptApi'
const props = defineProps<{ agents: Array<{ label: string; value: string }> }>()
const scope = ref('$global'),
  values = ref<Record<string, string>>({}),
  sessions = ref<Array<{ scope: string; count: number }>>([])
const busy = ref(false),
  error = ref(''),
  confirmOpen = ref(false),
  clearAll = ref(false),
  loaded = ref(false)
let request = 0
const options = computed(() => [
  { value: '$global', label: '全局变量' },
  ...sessions.value.map((item) => {
    const parts = item.scope.split(':'),
      agent = props.agents.find((candidate) => candidate.value === parts[1])?.label ?? parts[1]
    const location =
      parts[0] === 'social' ? `${parts[2]}/${parts.at(-1)}` : parts.at(-1)?.slice(0, 8)
    return { value: item.scope, label: `${agent ?? '会话'} · ${location} · ${item.count}` }
  }),
])
async function load(next = scope.value) {
  scope.value = next
  const id = ++request
  busy.value = true
  error.value = ''
  try {
    const result = await promptApi.variables(next)
    if (id !== request) return
    if (!result.data) throw new Error('未收到变量数据')
    values.value = result.data.values
    sessions.value = result.data.sessions
    loaded.value = true
  } catch (cause) {
    if (id === request) error.value = cause instanceof Error ? cause.message : '读取变量失败'
  } finally {
    if (id === request) busy.value = false
  }
}
async function reset() {
  confirmOpen.value = false
  busy.value = true
  try {
    await promptApi.resetVariables(clearAll.value ? undefined : scope.value)
    if (clearAll.value) scope.value = '$global'
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '重置变量失败'
    busy.value = false
  }
}
onBeforeUnmount(() => {
  request++
})
</script>
<template>
  <details
    class="bindings-panel"
    @toggle="($event.target as HTMLDetailsElement).open && !loaded && load()"
  >
    <summary>持久变量</summary>
    <div class="row">
      <PSelect
        :model-value="scope"
        :options="options"
        size="sm"
        teleport
        :disabled="busy"
        @update:model-value="load(String($event))"
      />
      <PButton size="sm" variant="ghost" :disabled="busy" @click="load()">刷新</PButton>
      <PButton
        size="sm"
        variant="danger"
        :disabled="busy"
        @click="
          () => {
            clearAll = false
            confirmOpen = true
          }
        "
      >
        清空
      </PButton>
    </div>
    <p v-if="error" class="error">
      {{ error }}
      <PButton
        size="sm"
        variant="ghost"
        :disabled="busy"
        @click="
          () => {
            clearAll = true
            confirmOpen = true
          }
        "
      >
        重置全部
      </PButton>
    </p>
    <div class="st-variable-state">
      <div v-for="(value, name) in values" :key="name">
        <code>{{ name }}</code>
        <pre>{{ value }}</pre>
      </div>
      <p v-if="loaded && !Object.keys(values).length" class="muted-text">暂无变量</p>
    </div>
    <PDialog
      v-model="confirmOpen"
      title="清空变量"
      :message="
        clearAll
          ? '清空所有酒馆变量？正在生成的旧变量变更将失效。'
          : '清空所选范围的变量？正在生成的旧变量变更将失效。'
      "
      @confirm="reset"
    />
  </details>
</template>
<style scoped src="./promptManagement.css"></style>
