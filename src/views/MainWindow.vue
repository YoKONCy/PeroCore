<template>
  <div class="relative w-screen h-screen overflow-hidden bg-transparent">
    <!-- Custom Title Bar (Always visible, handles drag & window controls) -->
    <CustomTitleBar 
      :is-work-mode="isWorkMode" 
      :title="APP_TITLE"
      @toggle-mode="toggleMode" 
    />

    <!-- Views Container with Transition -->
    <div class="w-full h-full relative">
      <Transition name="fade-scale" mode="out-in">
        <KeepAlive>
          <component 
            :is="currentView" 
            :key="isWorkMode ? 'work' : 'chat'"
            @exit="handleWorkExit"
            @start-work="isWorkMode = true"
          />
        </KeepAlive>
      </Transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, defineAsyncComponent, onMounted } from 'vue'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { APP_TITLE } from '../config'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import ChatModeView from './ChatModeView.vue'
import WorkModeView from './WorkModeView.vue'

const isWorkMode = ref(false)
const appWindow = getCurrentWindow()

// Intercept close request to hide window instead of destroying it
onMounted(async () => {
  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault()
    await appWindow.hide()
  })
})

const currentView = computed(() => isWorkMode.value ? WorkModeView : ChatModeView)

const toggleMode = () => {
  isWorkMode.value = !isWorkMode.value
}

// Watch mode changes and broadcast to system (e.g. for PetView isolation)
watch(isWorkMode, async (newVal) => {
  await emit('work-mode-changed', { is_work_mode: newVal })
})

const handleWorkExit = (save) => {
  if (save) {
    // TODO: Handle save logic if needed, or WorkModeView handles it before emitting
    console.log("Work session finished")
  } else {
    console.log("Work session aborted")
  }
  isWorkMode.value = false
}
</script>

<style>
/* Global Transition Styles */
.fade-scale-enter-active,
.fade-scale-leave-active {
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.fade-scale-enter-from,
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

.fade-scale-enter-to,
.fade-scale-leave-from {
  opacity: 1;
  transform: scale(1);
}
</style>