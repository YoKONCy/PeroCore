<template>
  <div 
    class="h-8 w-full flex items-center justify-between select-none z-50 fixed top-0 left-0 right-0 transition-colors duration-300"
    :class="isWorkMode ? 'bg-slate-900/90 text-slate-400' : 'bg-transparent text-slate-600'"
    data-tauri-drag-region
  >
    <!-- Left: App Title / Icon (Optional) -->
    <div class="flex items-center gap-2 px-3 pointer-events-none">
      <!-- <span class="text-xs font-bold opacity-50">{{ title }}</span> -->
    </div>

    <!-- Right: Window Controls -->
    <div class="flex items-center h-full">
      <!-- Mode Switcher (Icon Only) -->
      <button 
        @click="$emit('toggle-mode')"
        class="h-full w-10 flex items-center justify-center hover:bg-black/5 active:bg-black/10 transition-colors"
        :class="isWorkMode ? 'hover:bg-white/10 text-amber-400' : 'hover:bg-black/5 text-sky-600'"
        :title="isWorkMode ? 'Switch to Chat Mode' : 'Switch to Work Mode'"
      >
        <component :is="isWorkMode ? Coffee : Briefcase" class="w-4 h-4" />
      </button>

      <!-- Minimize -->
      <button 
        @click="minimize"
        class="h-full w-10 flex items-center justify-center hover:bg-black/5 active:bg-black/10 transition-colors"
        :class="isWorkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'"
      >
        <Minus class="w-4 h-4" />
      </button>
      
      <!-- Maximize / Restore -->
      <button 
        @click="toggleMaximize"
        class="h-full w-10 flex items-center justify-center hover:bg-black/5 active:bg-black/10 transition-colors"
        :class="isWorkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'"
      >
        <component :is="isMaximized ? Copy : Square" class="w-3.5 h-3.5" />
      </button>
      
      <!-- Close -->
      <button 
        @click="close"
        class="h-full w-10 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
      >
        <X class="w-4 h-4" />
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, Copy, X, Coffee, Briefcase } from 'lucide-vue-next'
import { APP_TITLE } from '../../config'

const props = defineProps({
  isWorkMode: Boolean,
  title: {
    type: String,
    default: APP_TITLE
  }
})

const emit = defineEmits(['toggle-mode'])

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
  // Listen for resize events to update maximized state if needed? 
  // Tauri v2 might have better event handling, but for now checking on mount is basic.
  // Actually we should listen to resize event, but let's keep it simple.
})
</script>

<style scoped>
/* No additional styles needed with Tailwind */
</style>