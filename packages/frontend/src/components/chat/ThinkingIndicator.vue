<script setup lang="ts">
/**
 * ThinkingIndicator.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import RunPulse from './RunPulse.vue'

interface Props {
  name?: string
  label?: string
}

withDefaults(defineProps<Props>(), {
  name: '助手',
  label: '',
})
</script>

<template>
  <RunPulse state="thinking" :name="name" :label="label" />
</template>
