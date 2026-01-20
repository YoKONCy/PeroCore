<template>
  <div class="relative w-screen h-screen overflow-hidden bg-transparent">
    <!-- Custom Title Bar (Always visible, handles drag & window controls) -->
    <CustomTitleBar 
      :is-work-mode="isWorkMode" 
      :show-mode-toggle="!isWorkMode"
      :title="APP_TITLE"
      @toggle-mode="toggleMode" 
    />

    <!-- Views Container -->
    <div class="absolute top-8 left-0 right-0 bottom-0 bg-[#1e293b] overflow-hidden">
      <Transition name="fade-slide">
        <KeepAlive>
          <component 
            :is="currentView" 
            :key="isWorkMode ? 'work' : 'chat'"
            class="w-full h-full absolute inset-0"
            :is-ready="isSessionReady"
            @exit="handleWorkExit"
            @start-work="isWorkMode = true"
          />
        </KeepAlive>
      </Transition>
    </div>
    
    <!-- Blocking Alert Dialog -->
    <CustomDialog
      v-model:visible="showErrorDialog"
      type="alert"
      title="模式冲突"
      :message="errorMessage"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, defineAsyncComponent, onMounted } from 'vue'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { APP_TITLE } from '../config'
import CustomTitleBar from '../components/layout/CustomTitleBar.vue'
import CustomDialog from '../components/ui/CustomDialog.vue'
import ChatModeView from './ChatModeView.vue'
import WorkModeView from './WorkModeView.vue'

const isWorkMode = ref(false)
const showErrorDialog = ref(false)
const isSessionReady = ref(false)
const errorMessage = ref('')
const appWindow = getCurrentWindow()

// Intercept close request to hide window instead of destroying it
onMounted(async () => {
  await appWindow.onCloseRequested(async (event) => {
    event.preventDefault()
    await appWindow.hide()
  })
})

const currentView = computed(() => isWorkMode.value ? WorkModeView : ChatModeView)

const toggleMode = async () => {
  // Check if we are trying to enter Work Mode
  if (!isWorkMode.value) {
     try {
       const API_BASE = 'http://localhost:9120'
       const configRes = await fetch(`${API_BASE}/api/config/lightweight_mode`)
       if (configRes.ok) {
           const config = await configRes.json()
           if (config.enabled) {
               console.warn("[WorkMode] Blocked by frontend pre-check: Lightweight mode enabled")
               errorMessage.value = "无法进入工作模式。检测到以下模式正在运行：轻量模式。请先关闭它们。"
               showErrorDialog.value = true
               return
           }
       }
     } catch (e) {
         console.warn("[WorkMode] Pre-check failed, letting backend handle it:", e)
     }
  }
  isWorkMode.value = !isWorkMode.value
}

// Watch mode changes and broadcast to system (e.g. for PetView isolation)
watch(isWorkMode, async (newVal) => {
  await emit('work-mode-changed', { is_work_mode: newVal })
  
  if (newVal) {
    // Entering Work Mode
    isSessionReady.value = false
    try {
       const API_BASE = 'http://localhost:9120'
       const res = await fetch(`${API_BASE}/api/ide/work_mode/enter`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ task_name: 'Coding Session' })
       })
       if (!res.ok) throw new Error("Failed to enter work session")
       const data = await res.json()
       
       if (data.message && data.message.startsWith("Error")) {
          // Blocked by backend check
          console.warn("[WorkMode] Blocked:", data.message)
          errorMessage.value = data.message.replace("Error: ", "")
          showErrorDialog.value = true
          isWorkMode.value = false // Revert state
          return
       }

       console.log("[WorkMode] Entered:", data.message)
       // Add a small delay for UI transition smoothness
       setTimeout(() => {
          isSessionReady.value = true
       }, 500)
    } catch (e) {
       console.error("[WorkMode] Failed to enter session:", e)
       // Optional: Show error via dialog or just fallback
       isSessionReady.value = true // Allow UI to show anyway? Or error state?
       // Ideally we should show error in WorkModeView, but for now let it render
    }
  } else {
    // Exiting Work Mode - Session teardown handled by handleWorkExit or Abort
    isSessionReady.value = false
  }
})

const handleWorkExit = async (save) => {
  const API_BASE = 'http://localhost:9120'
  try {
    if (save) {
      console.log("Work session finishing...")
      await fetch(`${API_BASE}/api/ide/work_mode/exit`, { method: 'POST' })
    } else {
      console.log("Work session aborting...")
      await fetch(`${API_BASE}/api/ide/work_mode/abort`, { method: 'POST' })
    }
  } catch (e) {
    console.error("Failed to sync work session exit:", e)
  }
  isWorkMode.value = false
}
</script>

<style>
/* Simultaneous Transition (Overlapping) */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.98);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.98);
}
</style>