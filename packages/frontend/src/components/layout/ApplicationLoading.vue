<script setup lang="ts">
import { computed } from 'vue'
import { createApplicationWaitingContent } from '@infos/shared'

const props = defineProps<{
  applicationName: string
  dark: boolean
  motion: 'full' | 'reduced' | 'off'
}>()
// 直接嵌入共用 SVG，启动动画不参与窗口导航和原生视图的显示控制。
const page = computed(() =>
  createApplicationWaitingContent({
    dark: props.dark,
    applicationName: props.applicationName === 'NapCat' ? 'NapCat 管理页' : props.applicationName,
    motion: props.motion,
  }),
)
</script>

<template>
  <div class="application-loading" :class="{ 'is-dark': dark }" v-html="page" />
</template>

<style scoped>
.application-loading {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: #f5f6fa;
}
.application-loading.is-dark {
  background: #15151d;
}
</style>
