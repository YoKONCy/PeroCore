<script setup lang="ts">
/**
 * ArcaTitleBar.vue — 界面组件
 *
 * 负责组织该界面的响应式状态、用户交互与领域数据展示。
 * 副作用在组件生命周期内建立并清理，避免跨页面残留监听器或异步状态。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

interface ElectronBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on?: (channel: string, listener: (...args: unknown[]) => void) => () => void
}

const electron = (window as unknown as { electron?: ElectronBridge }).electron
const maximized = ref(false)
const isElectron = Boolean(electron)
let unlisten: (() => void) | undefined

async function minimize() {
  await electron?.invoke('window-minimize')
}
async function toggleMaximize() {
  maximized.value = Boolean(await electron?.invoke('window-maximize'))
}
async function close() {
  await electron?.invoke('window-close')
}

onMounted(async () => {
  if (!electron) return
  maximized.value = Boolean(await electron.invoke('window-is-maximized'))
  unlisten = electron.on?.('window-maximized-state-changed', (state) => {
    maximized.value = Boolean(state)
  })
})
onBeforeUnmount(() => unlisten?.())
</script>

<template>
  <header v-if="isElectron" class="arca-titlebar">
    <div class="arca-titlebar-brand">
      <span class="arca-titlebar-glyph">✦</span>
      <strong>Arca</strong>
      <span>星页工房</span>
    </div>
    <div class="arca-window-controls">
      <button type="button" aria-label="最小化" @click="minimize">─</button>
      <button type="button" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMaximize">
        {{ maximized ? '❐' : '□' }}
      </button>
      <button class="arca-window-close" type="button" aria-label="关闭" @click="close">×</button>
    </div>
  </header>
</template>
