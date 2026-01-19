<template>
  <div 
    class="h-8 w-full flex items-center justify-between select-none z-50 fixed top-0 left-0 right-0 transition-colors duration-300"
    :class="transparent ? 'bg-transparent' : 'bg-slate-900/50 backdrop-blur-sm'"
    data-tauri-drag-region
  >
    <!-- Left: App Title / Icon -->
    <div class="flex items-center gap-3 px-4 pointer-events-none text-slate-400">
      <div class="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></div>
      <span class="text-xs font-medium tracking-wide font-mono opacity-80">{{ title }}</span>
    </div>

    <!-- Right: Window Controls -->
    <div class="flex items-center h-full">
      <!-- Minimize -->
      <button 
        @click="minimize"
        class="h-full w-12 flex items-center justify-center hover:bg-slate-800/50 text-slate-400 hover:text-white transition-all duration-200 group"
      >
        <Minus class="w-4 h-4 group-hover:scale-110 transition-transform" />
      </button>
      
      <!-- Maximize / Restore -->
      <button 
        @click="toggleMaximize"
        class="h-full w-12 flex items-center justify-center hover:bg-slate-800/50 text-slate-400 hover:text-white transition-all duration-200 group"
      >
        <component :is="isMaximized ? Copy : Square" class="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
      </button>
      
      <!-- Close -->
      <button 
        @click="close"
        class="h-full w-12 flex items-center justify-center hover:bg-red-500 text-slate-400 hover:text-white transition-all duration-200 group"
      >
        <X class="w-4 h-4 group-hover:scale-110 transition-transform" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, Copy, X } from 'lucide-vue-next'
import { APP_TITLE } from '../../config'

const props = defineProps({
  title: {
    type: String,
    default: APP_TITLE
  },
  transparent: {
    type: Boolean,
    default: true
  }
})

const appWindow = getCurrentWindow()
const isMaximized = ref(false)

const minimize = () => appWindow.minimize()
const toggleMaximize = async () => {
  if (await appWindow.isMaximized()) {
    appWindow.unmaximize()
    isMaximized.value = false
  } else {
    appWindow.maximize()
    isMaximized.value = true
  }
}
const close = () => appWindow.close()

onMounted(async () => {
  isMaximized.value = await appWindow.isMaximized()
  // Listen for resize events to update maximized state if needed
  await appWindow.onResized(async () => {
      isMaximized.value = await appWindow.isMaximized()
  })
})
</script>

<style scoped>
/* No additional styles needed with Tailwind */
</style>